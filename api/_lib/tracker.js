/**
 * 价格追踪模块 (Vercel Serverless 版)
 * 使用 /tmp 临时文件存储，通过 OKX HTTP API 获取价格
 */
const fs = require('fs');
const path = require('path');
const okxHttp = require('./okx-http');

const TMP_DIR = '/tmp';
const TRACKING_FILE = path.join(TMP_DIR, 'yaobi-tracking.json');
const MAX_TRACKING = 300;

const CHECKPOINTS = {
  t1h:  1 * 60 * 60 * 1000,
  t4h:  4 * 60 * 60 * 1000,
  t24h: 24 * 60 * 60 * 1000,
};
const CHECK_WINDOW = 10 * 60 * 1000;

function readJSON(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {}
  return null;
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data));
  } catch (e) {
    console.error('[Tracker] 写入失败:', e.message);
  }
}

function getTrackingRecords() {
  return readJSON(TRACKING_FILE) || [];
}

/**
 * 记录新的告警追踪任务
 */
function recordAlerts(alerts) {
  if (!alerts || alerts.length === 0) return;

  const records = getTrackingRecords();
  const now = Date.now();
  let newCount = 0;

  for (const alert of alerts) {
    const recent = records.find(
      r => r.symbol === alert.symbol && (now - r.alertTime) < 30 * 60 * 1000
    );
    if (recent) continue;

    records.unshift({
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
      p1h: null, p4h: null, p24h: null,
      return1h: null, return4h: null, return24h: null,
      checkTimes: {
        t1h: now + CHECKPOINTS.t1h,
        t4h: now + CHECKPOINTS.t4h,
        t24h: now + CHECKPOINTS.t24h,
      },
      checkedAt: { t1h: null, t4h: null, t24h: null },
      status: 'pending',
    });
    newCount++;
  }

  writeJSON(TRACKING_FILE, records.slice(0, MAX_TRACKING));
  if (newCount > 0) {
    console.log(`[Tracker] 新增 ${newCount} 条追踪记录`);
  }
}

/**
 * 检查所有待处理的追踪记录
 */
async function checkPending() {
  const records = getTrackingRecords();
  const now = Date.now();
  const pendingRecords = records.filter(r => r.status !== 'complete');

  if (pendingRecords.length === 0) return;

  const symbolsToCheck = new Set();
  for (const record of pendingRecords) {
    for (const [key, offset] of Object.entries(CHECKPOINTS)) {
      const targetTime = record.alertTime + offset;
      if (!record.checkedAt[key] && now >= targetTime - CHECK_WINDOW) {
        symbolsToCheck.add(record.symbol);
      }
    }
  }

  if (symbolsToCheck.size === 0) return;

  // 通过 OKX HTTP API 获取价格
  let priceMap = {};
  try {
    const tickers = await okxHttp.getSpotTickers();
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

  let updated = 0;
  for (const record of pendingRecords) {
    const currentPrice = priceMap[record.symbol];
    if (!currentPrice || !record.p0) continue;

    let changed = false;
    for (const [key, offset] of Object.entries(CHECKPOINTS)) {
      const targetTime = record.alertTime + offset;
      const priceKey = key.replace('t', 'p');
      const returnKey = key.replace('t', 'return');

      if (!record.checkedAt[key] && now >= targetTime - CHECK_WINDOW) {
        record[priceKey] = currentPrice;
        record[returnKey] = Math.round(((currentPrice - record.p0) / record.p0) * 10000) / 100;
        record.checkedAt[key] = now;
        changed = true;
      }
    }

    if (changed) {
      const checks = Object.values(record.checkedAt).filter(Boolean);
      record.status = checks.length >= 3 ? 'complete' : 'partial';
      updated++;
    }
  }

  if (updated > 0) {
    writeJSON(TRACKING_FILE, records.slice(0, MAX_TRACKING));
    console.log(`[Tracker] 更新 ${updated} 条追踪记录`);
  }
}

function getTracking(opts = {}) {
  let result = getTrackingRecords();
  if (opts.status) result = result.filter(r => r.status === opts.status);
  if (opts.symbol) result = result.filter(r => r.symbol.includes(opts.symbol.toUpperCase()));
  if (opts.limit) result = result.slice(0, opts.limit);
  return result;
}

function getCompletedRecords() {
  return getTrackingRecords().filter(r => r.status === 'complete');
}

function getTrackingStats() {
  const records = getTrackingRecords();
  const total = records.length;
  const pending = records.filter(r => r.status === 'pending').length;
  const partial = records.filter(r => r.status === 'partial').length;
  const complete = records.filter(r => r.status === 'complete').length;

  const completed = records.filter(r => r.return24h != null);
  const avgReturn24h = completed.length > 0
    ? completed.reduce((sum, r) => sum + r.return24h, 0) / completed.length : null;

  return { total, pending, partial, complete, avgReturn24h };
}

module.exports = {
  recordAlerts,
  checkPending,
  getTracking,
  getCompletedRecords,
  getTrackingStats,
  CHECKPOINTS,
};
