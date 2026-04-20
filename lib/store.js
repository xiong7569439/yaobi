/**
 * 数据存储层
 * 内存 + JSON 文件持久化
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const SCAN_LOG_FILE = path.join(DATA_DIR, 'scan-log.json');
const MAX_ALERTS = 500;       // 最多保留500条告警
const MAX_SCAN_LOGS = 100;    // 最多保留100条扫描日志

// 内存存储
let alerts = [];
let scanLogs = [];
let latestScan = null;
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
  console.log(`[Store] 加载完成: ${alerts.length}条告警, ${scanLogs.length}条扫描日志`);
}

// 持久化到文件
function saveToDisk() {
  ensureDataDir();
  try {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts.slice(0, MAX_ALERTS), null, 2));
    fs.writeFileSync(SCAN_LOG_FILE, JSON.stringify(scanLogs.slice(0, MAX_SCAN_LOGS), null, 2));
  } catch (e) {
    console.error('[Store] 保存数据失败:', e.message);
  }
}

// 添加告警
function addAlerts(newAlerts) {
  if (!newAlerts || newAlerts.length === 0) return;

  const now = Date.now();
  for (const alert of newAlerts) {
    alert.id = `${alert.symbol}-${now}-${Math.random().toString(36).slice(2, 6)}`;
    alert.createdAt = now;
    alerts.unshift(alert);
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

// 获取数据
function getAlerts(opts = {}) {
  let result = [...alerts];
  if (opts.level) result = result.filter(a => a.level === opts.level);
  if (opts.symbol) result = result.filter(a => a.symbol.includes(opts.symbol.toUpperCase()));
  if (opts.limit) result = result.slice(0, opts.limit);
  return result;
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
};
