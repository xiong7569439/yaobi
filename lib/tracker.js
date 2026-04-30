/**
 * 价格追踪模块 (本地版)
 * 告警产生后记录 P₀，在 1h/4h/24h 后检查价格并计算回报率
 * v2: 增加场景标签, 为后续经验检索做准备
 */
const fs = require('fs');
const path = require('path');
const okxFetcher = require('./okx-fetcher');
const scene = require('./scene');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRACKING_FILE = path.join(DATA_DIR, 'tracking.json');
const MAX_TRACKING = 500;

// 检查点时间偏移 (毫秒)
const CHECKPOINTS = {
  t1h:  1 * 60 * 60 * 1000,   // 1小时
  t4h:  4 * 60 * 60 * 1000,   // 4小时
  t24h: 24 * 60 * 60 * 1000,  // 24小时
};
// 允许的检查窗口 (提前/延后都可以检查)
const CHECK_WINDOW = 10 * 60 * 1000; // 10分钟窗口

// 内存缓存
let trackingRecords = [];

/**
 * 从磁盘加载追踪记录
 */
function loadTracking() {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      trackingRecords = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[Tracker] 加载追踪数据失败:', e.message);
    trackingRecords = [];
  }
  console.log(`[Tracker] 加载 ${trackingRecords.length} 条追踪记录`);
}

/**
 * 保存追踪记录到磁盘
 */
function saveTracking() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TRACKING_FILE, JSON.stringify(trackingRecords.slice(0, MAX_TRACKING), null, 2));
  } catch (e) {
    console.error('[Tracker] 保存追踪数据失败:', e.message);
  }
}

/**
 * 记录新的告警追踪任务
 * @param {Array} alerts - 本次扫描产生的告警列表
 * @param {Object} marketContext - 本轮扫描的大盘背景, 用于场景标签
 */
function recordAlerts(alerts, marketContext = null) {
  if (!alerts || alerts.length === 0) return;

  const now = Date.now();
  let newCount = 0;

  for (const alert of alerts) {
    // 避免同一代币在短时间内重复记录 (30分钟内)
    const recent = trackingRecords.find(
      r => r.symbol === alert.symbol && (now - r.alertTime) < 30 * 60 * 1000
    );
    if (recent) continue;

    const record = {
      id: `${alert.symbol}-${now}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: alert.symbol,
      instId: alert.instId,
      alertTime: now,
      p0: alert.last || null,
      direction: alert.direction,
      totalScore: alert.totalScore,
      level: alert.level,
      scores: { ...alert.scores },
      change24hPct: alert.change24hPct,
      fundingRate: alert.fundingRate,
      oiChangePct: alert.oiChangePct,
      volumeMultiplier: alert.volumeMultiplier || null,
      // 场景标签 - 用于后续相似场景经验检索
      scene: scene.tagSnapshot({
        change24hPct: alert.change24hPct,
        fundingRate: alert.fundingRate,
        oiChangePct: alert.oiChangePct,
        volumeMultiplier: alert.volumeMultiplier,
        marketContext: marketContext,
      }),
      marketSnapshot: marketContext ? {
        btcChange: marketContext.btc?.change24hPct ?? null,
        ethChange: marketContext.eth?.change24hPct ?? null,
      } : null,
      reasoning: Array.isArray(alert.reasons) ? alert.reasons.join('|') : '',
      directionReasons: Array.isArray(alert.directionReasons) ? alert.directionReasons.join('|') : '',
      // 追踪字段 (待填充)
      p1h: null,
      p4h: null,
      p24h: null,
      return1h: null,
      return4h: null,
      return24h: null,
      checkTimes: {
        t1h: now + CHECKPOINTS.t1h,
        t4h: now + CHECKPOINTS.t4h,
        t24h: now + CHECKPOINTS.t24h,
      },
      checkedAt: {
        t1h: null,
        t4h: null,
        t24h: null,
      },
      status: 'pending', // pending → partial → complete
    };

    trackingRecords.unshift(record);
    newCount++;
  }

  // 裁剪
  if (trackingRecords.length > MAX_TRACKING) {
    trackingRecords = trackingRecords.slice(0, MAX_TRACKING);
  }

  if (newCount > 0) {
    saveTracking();
    console.log(`[Tracker] 新增 ${newCount} 条追踪记录, 总计 ${trackingRecords.length} 条`);
  }
}

/**
 * 检查所有待处理的追踪记录，获取价格并计算回报率
 * 在每次扫描时调用
 */
async function checkPending() {
  const now = Date.now();
  const pendingRecords = trackingRecords.filter(r => r.status !== 'complete');

  if (pendingRecords.length === 0) return;

  // 收集需要查价的 symbol 列表
  const symbolsToCheck = new Set();
  for (const record of pendingRecords) {
    for (const [key, offset] of Object.entries(CHECKPOINTS)) {
      const targetTime = record.alertTime + offset;
      // 只在检查窗口内执行 (目标时间 ± CHECK_WINDOW)
      if (!record.checkedAt[key] && now >= targetTime - CHECK_WINDOW) {
        symbolsToCheck.add(record.symbol);
      }
    }
  }

  if (symbolsToCheck.size === 0) return;

  // 批量获取当前价格
  let priceMap = {};
  try {
    const tickers = okxFetcher.getSpotTickers();
    if (Array.isArray(tickers)) {
      for (const t of tickers) {
        const sym = (t.instId || '').split('-')[0];
        if (sym && symbolsToCheck.has(sym)) {
          priceMap[sym] = parseFloat(t.last);
        }
      }
    }
  } catch (e) {
    console.error('[Tracker] 获取价格失败:', e.message);
    return;
  }

  // 更新追踪记录
  let updated = 0;
  for (const record of pendingRecords) {
    const currentPrice = priceMap[record.symbol];
    if (!currentPrice || !record.p0) continue;

    let changed = false;

    for (const [key, offset] of Object.entries(CHECKPOINTS)) {
      const targetTime = record.alertTime + offset;
      const priceKey = key.replace('t', 'p');     // t1h → p1h
      const returnKey = key.replace('t', 'return'); // t1h → return1h

      if (!record.checkedAt[key] && now >= targetTime - CHECK_WINDOW) {
        record[priceKey] = currentPrice;
        record[returnKey] = ((currentPrice - record.p0) / record.p0) * 100;
        record[returnKey] = Math.round(record[returnKey] * 100) / 100;
        record.checkedAt[key] = now;
        changed = true;
      }
    }

    if (changed) {
      // 更新状态
      const checks = Object.values(record.checkedAt).filter(Boolean);
      if (checks.length >= 3) {
        record.status = 'complete';
      } else if (checks.length > 0) {
        record.status = 'partial';
      }
      updated++;
    }
  }

  if (updated > 0) {
    saveTracking();
    console.log(`[Tracker] 更新 ${updated} 条追踪记录`);
  }
}

/**
 * 获取所有追踪记录
 */
function getTracking(opts = {}) {
  let result = [...trackingRecords];
  if (opts.status) result = result.filter(r => r.status === opts.status);
  if (opts.symbol) result = result.filter(r => r.symbol.includes(opts.symbol.toUpperCase()));
  if (opts.limit) result = result.slice(0, opts.limit);
  return result;
}

/**
 * 获取已完成追踪的记录 (用于学习分析)
 */
function getCompletedRecords() {
  return trackingRecords.filter(r => r.status === 'complete');
}

/**
 * 获取追踪统计摘要
 */
function getTrackingStats() {
  const total = trackingRecords.length;
  const pending = trackingRecords.filter(r => r.status === 'pending').length;
  const partial = trackingRecords.filter(r => r.status === 'partial').length;
  const complete = trackingRecords.filter(r => r.status === 'complete').length;

  const completed = trackingRecords.filter(r => r.return24h != null);
  const avgReturn24h = completed.length > 0
    ? completed.reduce((sum, r) => sum + r.return24h, 0) / completed.length
    : null;
  const avgReturn1h = completed.filter(r => r.return1h != null).length > 0
    ? completed.filter(r => r.return1h != null).reduce((sum, r) => sum + r.return1h, 0) / completed.filter(r => r.return1h != null).length
    : null;

  return { total, pending, partial, complete, avgReturn1h, avgReturn24h };
}

// 初始化
loadTracking();

module.exports = {
  recordAlerts,
  checkPending,
  getTracking,
  getCompletedRecords,
  getTrackingStats,
  CHECKPOINTS,
};
