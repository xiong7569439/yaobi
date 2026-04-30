/**
 * 数据存储层
 * 内存 + JSON 文件持久化
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const SCAN_LOG_FILE = path.join(DATA_DIR, 'scan-log.json');
const ALERT_COUNTS_FILE = path.join(DATA_DIR, 'alert-counts.json');
const MAX_ALERTS = 500;
const MAX_SCAN_LOGS = 100;

// 内存存储
let alerts = [];
let scanLogs = [];
let latestScan = null;
let marketContext = null;  // BTC/ETH 大盘背景
let alertCounts = {};  // { symbol: { count: N, firstSeen: ts, lastSeen: ts } }
let systemStatus = {
  startTime: Date.now(),
  totalScans: 0,
  lastScanTime: null,
  lastScanDuration: null,
  isScanning: false,
  errors: [],
};

// SSE 客户端列表
const sseClients = new Set();

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 从文件加载数据
function loadFromDisk() {
  ensureDataDir();
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[Store] 加载告警数据失败:', e.message);
    alerts = [];
  }
  try {
    if (fs.existsSync(SCAN_LOG_FILE)) {
      scanLogs = JSON.parse(fs.readFileSync(SCAN_LOG_FILE, 'utf-8'));
    }
  } catch (e) {
    scanLogs = [];
  }
  try {
    if (fs.existsSync(ALERT_COUNTS_FILE)) {
      alertCounts = JSON.parse(fs.readFileSync(ALERT_COUNTS_FILE, 'utf-8'));
    }
  } catch (e) {
    alertCounts = {};
  }
  console.log(`[Store] 加载完成: ${alerts.length}条告警, ${scanLogs.length}条扫描日志, ${Object.keys(alertCounts).length}个代币追踪`);
}

// 持久化到文件
function saveToDisk() {
  ensureDataDir();
  try {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts.slice(0, MAX_ALERTS), null, 2));
    fs.writeFileSync(SCAN_LOG_FILE, JSON.stringify(scanLogs.slice(0, MAX_SCAN_LOGS), null, 2));
    fs.writeFileSync(ALERT_COUNTS_FILE, JSON.stringify(alertCounts, null, 2));
  } catch (e) {
    console.error('[Store] 保存数据失败:', e.message);
  }
}

// 添加告警 (同一 symbol 只保留最新一条，更新而非重复)
function addAlerts(newAlerts) {
  if (!newAlerts || newAlerts.length === 0) return;

  const now = Date.now();
  for (const alert of newAlerts) {
    alert.id = `${alert.symbol}-${now}-${Math.random().toString(36).slice(2, 6)}`;
    alert.createdAt = now;

    // 查找已存在的同 symbol 告警，有则更新，无则新增
    const existIdx = alerts.findIndex(a => a.symbol === alert.symbol);
    if (existIdx >= 0) {
      // 保留首次发现时间
      alert.firstSeenAt = alerts[existIdx].firstSeenAt || alerts[existIdx].createdAt;
      alerts.splice(existIdx, 1); // 移除旧的
    } else {
      alert.firstSeenAt = now;
    }
    alerts.unshift(alert); // 最新的放前面
  }

  // 裁剪
  if (alerts.length > MAX_ALERTS) {
    alerts = alerts.slice(0, MAX_ALERTS);
  }

  // 推送 SSE
  broadcastSSE({ type: 'alerts', data: newAlerts });

  // 持久化
  saveToDisk();
}

// 记录扫描日志
function addScanLog(log) {
  scanLogs.unshift({
    ...log,
    timestamp: Date.now(),
  });
  if (scanLogs.length > MAX_SCAN_LOGS) {
    scanLogs = scanLogs.slice(0, MAX_SCAN_LOGS);
  }
  saveToDisk();
}

// 更新系统状态
function updateStatus(updates) {
  Object.assign(systemStatus, updates);
}

// 设置最新扫描结果
function setLatestScan(result) {
  latestScan = result;
}

function setMarketContext(ctx) { marketContext = ctx; }
function getMarketContext() { return marketContext; }

// 获取数据
function getAlerts(opts = {}) {
  let result = [...alerts];
  if (opts.level) result = result.filter(a => a.level === opts.level);
  if (opts.symbol) result = result.filter(a => a.symbol.includes(opts.symbol.toUpperCase()));
  if (opts.limit) result = result.slice(0, opts.limit);
  return result;
}

// 代币提醒次数追踪
function incrementAlertCount(symbol) {
  const now = Date.now();
  if (!alertCounts[symbol]) {
    alertCounts[symbol] = { count: 0, firstSeen: now, lastSeen: now };
  }
  alertCounts[symbol].count += 1;
  alertCounts[symbol].lastSeen = now;
  saveToDisk();
}

function getAlertCount(symbol) {
  return alertCounts[symbol]?.count || 0;
}

function getAlertCounts() {
  return { ...alertCounts };
}

/**
 * 标记降温告警 — 对比最新扫描分数，如果跌出阈值则标记
 * @param {Array} currentScores - 本次扫描的 allScores 列表
 * @param {number} threshold - 告警阈值 (默认40)
 */
function markCooledAlerts(currentScores, threshold = 40) {
  if (!currentScores || currentScores.length === 0) return;

  const scoreMap = new Map();
  for (const s of currentScores) {
    scoreMap.set(s.symbol, s.totalScore);
  }

  let changed = false;
  for (const alert of alerts) {
    const currentScore = scoreMap.get(alert.symbol);
    if (currentScore !== undefined) {
      if (currentScore < threshold && !alert.cooledDown) {
        // 跌出阈值 → 标记降温
        alert.cooledDown = true;
        alert.currentScore = Math.round(currentScore * 100) / 100;
        alert.cooledAt = Date.now();
        changed = true;
        console.log(`[Store] ${alert.symbol} 已降温: ${alert.totalScore.toFixed(1)} → ${currentScore.toFixed(1)}`);
      } else if (currentScore >= threshold && alert.cooledDown) {
        // 重新升温 → 取消降温标记
        delete alert.cooledDown;
        delete alert.currentScore;
        delete alert.cooledAt;
        changed = true;
        console.log(`[Store] ${alert.symbol} 重新升温: ${currentScore.toFixed(1)}`);
      }
    }
  }

  if (changed) saveToDisk();
}

function getScanLogs() { return scanLogs; }
function getLatestScan() { return latestScan; }
function getStatus() {
  return {
    ...systemStatus,
    uptime: Date.now() - systemStatus.startTime,
    alertCount: alerts.length,
    scanCount: scanLogs.length,
  };
}

// SSE 管理
function addSSEClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcastSSE(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

// 初始化
loadFromDisk();

module.exports = {
  addAlerts,
  addScanLog,
  updateStatus,
  setLatestScan,
  getAlerts,
  getScanLogs,
  getLatestScan,
  getStatus,
  addSSEClient,
  broadcastSSE,
  setMarketContext,
  getMarketContext,
  incrementAlertCount,
  getAlertCount,
  getAlertCounts,
  markCooledAlerts,
};
