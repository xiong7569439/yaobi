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
let scanTimer = null;
let isScanning = false;
let lastLearnTime = 0;
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

    // Step 4: 价格追踪 — 记录新告警 + 检查待处理的追踪记录
    try {
      tracker.recordAlerts(result.alerts);
      await tracker.checkPending();
    } catch (e) {
      console.error('[Scanner] 追踪模块异常:', e.message);
    }

    // Step 5: 学习调度 — 每完成10条或每6小时触发一次
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
 * 启动定时扫描
 */
function start() {
  console.log(`[Scanner] 启动定时扫描, 间隔 ${SCAN_INTERVAL / 1000}s (${SCAN_INTERVAL / 60000}min)`);
  // 延迟5秒后执行首次扫描
  setTimeout(() => {
    runScan();
  }, 5000);
  // 设置定时器
  scanTimer = setInterval(runScan, SCAN_INTERVAL);
}

/**
 * 停止定时扫描
 */
function stop() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
    console.log('[Scanner] 定时扫描已停止');
  }
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
  getNextScanTime,
  SCAN_INTERVAL,
};
