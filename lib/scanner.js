/**
 * 定时扫描调度器
 * 每5分钟触发一次全量扫描
 */
const okxFetcher = require('./okx-fetcher');
const analyzer = require('./analyzer');
const store = require('./store');
const tracker = require('./tracker');
const learner = require('./learner');

const SCAN_INTERVAL = 5 * 60 * 1000; // 5分钟
const LEARN_INTERVAL = 6 * 60 * 60 * 1000; // 6小时强制学习
const PENDING_CHECK_INTERVAL = 2 * 60 * 1000; // 2分钟 独立检查 pending追踪
const REVIEW_INTERVAL = 4 * 60 * 60 * 1000; // 4小时 定时复盘
let scanTimer = null;
let pendingTimer = null;
let reviewTimer = null;
let isScanning = false;
let lastLearnTime = 0;
let lastReviewTime = 0;
let lastReviewResult = null;
let completedSinceLearn = 0;

/**
 * 执行一次完整扫描
 */
async function runScan() {
  if (isScanning) {
    console.log('[Scanner] 上一次扫描尚未完成，跳过');
    return null;
  }

  isScanning = true;
  store.updateStatus({ isScanning: true });
  store.broadcastSSE({ type: 'scan_start', data: { time: Date.now() } });
  const startTime = Date.now();

  try {
    console.log('\n' + '='.repeat(60));
    console.log(`[Scanner] 开始扫描 - ${new Date().toLocaleString('zh-CN')}`);
    console.log('='.repeat(60));

    // Step 1: 获取 OKX 数据 (已完全替代 Surf)
    const okxData = await okxFetcher.fullScan();

    // Step 2: 分析
    const result = analyzer.analyze(okxData);

    // 存储大盘背景
    store.setMarketContext(result.marketContext);

    // Step 3: 存储结果 + 更新提醒计数
    store.setLatestScan(result);
    if (result.alerts.length > 0) {
      store.addAlerts(result.alerts);
      // 更新每个代币的提醒次数
      for (const alert of result.alerts) {
        store.incrementAlertCount(alert.symbol);
        alert.alertCount = store.getAlertCount(alert.symbol);
      }
      console.log(`[Scanner] 发现 ${result.alerts.length} 个妖币告警!`);
      for (const alert of result.alerts) {
        console.log(`  🔥 ${alert.symbol} - 评分: ${alert.totalScore} [${alert.level}] - ${alert.reasons.join(', ')}`);
      }
    }

    // Step 4: 标记降温告警 — 对比最新分数与已存储告警
    store.markCooledAlerts(result.allScores);

    // Step 5: 价格追踪 — 记录新告警(含场景标签) + 检查待处理的追踪记录
    try {
      tracker.recordAlerts(result.alerts, result.marketContext);
      await tracker.checkPending();
    } catch (e) {
      console.error('[Scanner] 追踪模块异常:', e.message);
    }

    // Step 6: 学习调度 — 每完成10条或每6小时触发一次
    try {
      const completed = tracker.getCompletedRecords();
      const newCompleted = completed.length - completedSinceLearn;
      const timeSinceLearn = Date.now() - lastLearnTime;

      if ((newCompleted >= 10 || timeSinceLearn >= LEARN_INTERVAL) && completed.length > 0) {
        console.log(`[Scanner] 触发学习分析 (新完成${newCompleted}条, 距上次${Math.round(timeSinceLearn/3600000)}h)`);
        learner.analyze(completed, store.getAlertCounts());
        lastLearnTime = Date.now();
        completedSinceLearn = completed.length;
      }
    } catch (e) {
      console.error('[Scanner] 学习模块异常:', e.message);
    }

    const duration = Date.now() - startTime;
    const scanLog = {
      duration,
      alertCount: result.alerts.length,
      watchlistCount: result.watchlist.length,
      totalAnalyzed: result.allScores.length,
      okxDataAvailable: {
        topGainers: !!okxData.topGainers,
        oiChanges: !!okxData.oiChanges,
        news: !!okxData.news,
        sentimentRank: !!okxData.sentimentRank,
      },
    };
    store.addScanLog(scanLog);
    store.updateStatus({
      isScanning: false,
      lastScanTime: Date.now(),
      lastScanDuration: duration,
      totalScans: store.getStatus().totalScans + 1,
    });

    store.broadcastSSE({
      type: 'scan_complete',
      data: {
        duration,
        alertCount: result.alerts.length,
        alerts: result.alerts,
        watchlist: result.watchlist.slice(0, 5),
        topScores: result.allScores.slice(0, 10),
        marketContext: result.marketContext,
      },
    });

    console.log(`[Scanner] 扫描完成, 耗时 ${(duration / 1000).toFixed(1)}s`);
    console.log('='.repeat(60) + '\n');

    return result;
  } catch (err) {
    console.error('[Scanner] 扫描异常:', err.message);
    const errInfo = { message: err.message, time: Date.now() };
    store.updateStatus({
      isScanning: false,
      errors: [...(store.getStatus().errors || []).slice(0, 9), errInfo],
    });
    store.broadcastSSE({ type: 'scan_error', data: errInfo });
    return null;
  } finally {
    isScanning = false;
  }
}

/**
 * 独立检查 pending 追踪 - 不依赖完整扫描, 更高频 2min/次
 * 让到期的 1h/4h/24h 回收更及时被回填, pending 更快成熟
 */
async function runPendingCheck() {
  try {
    await tracker.checkPending();
  } catch (e) {
    console.error('[Scanner] pending 独立检查异常:', e.message);
  }
}

/**
 * 定时复盘 - 每 4h 跑一次 runReview(), 让新完成的追踪转化为经验
 * 失败不影响主流程 (捕获并记录)
 */
async function runPeriodicReview() {
  try {
    const { runReview } = require('../scripts/review');
    const r = await runReview({ useLLM: false, force: false, verbose: false });
    lastReviewTime = Date.now();
    lastReviewResult = r;
    if (r.newCount > 0) {
      console.log(`[Review] 定时复盘完成 +${r.newCount}条 总计${r.total}条 (胜${r.wins}负${r.losses})`);
      store.broadcastSSE({
        type: 'review_update',
        data: { newCount: r.newCount, total: r.total, wins: r.wins, losses: r.losses, time: lastReviewTime },
      });
    }
  } catch (e) {
    console.error('[Scanner] 定时复盘异常:', e.message);
  }
}

/**
 * 启动定时扫描
 */
function start() {
  console.log(`[Scanner] 启动定时扫描, 间隔 ${SCAN_INTERVAL / 1000}s (${SCAN_INTERVAL / 60000}min)`);
  console.log(`[Scanner] pending 独立检查间隔 ${PENDING_CHECK_INTERVAL / 60000}min, 定时复盘间隔 ${REVIEW_INTERVAL / 3600000}h`);
  // 延迟5秒后执行首次扫描
  setTimeout(() => {
    runScan();
  }, 5000);
  // 扫描定时器
  scanTimer = setInterval(runScan, SCAN_INTERVAL);
  // 独立 pending 检查定时器 (不与扫描耦合, 避免扫描卡顿影响追踪)
  pendingTimer = setInterval(runPendingCheck, PENDING_CHECK_INTERVAL);
  // 定时复盘 - 延迟 2min 后首次运行 (避免与启动时的扫描抢资源)
  setTimeout(runPeriodicReview, 2 * 60 * 1000);
  reviewTimer = setInterval(runPeriodicReview, REVIEW_INTERVAL);
}

/**
 * 停止定时扫描
 */
function stop() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; }
  if (reviewTimer) { clearInterval(reviewTimer); reviewTimer = null; }
  console.log('[Scanner] 所有定时器已停止');
}

/**
 * 获取下次扫描时间 (毫秒时间戳)
 */
function getNextScanTime() {
  const lastScan = store.getStatus().lastScanTime;
  if (!lastScan) return Date.now() + 5000;
  return lastScan + SCAN_INTERVAL;
}

module.exports = {
  start,
  stop,
  runScan,
  runPeriodicReview,
  runPendingCheck,
  getNextScanTime,
  getLastReview: () => ({ lastReviewTime, lastReviewResult }),
  SCAN_INTERVAL,
  PENDING_CHECK_INTERVAL,
  REVIEW_INTERVAL,
};
