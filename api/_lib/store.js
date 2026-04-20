/**
 * Vercel 简易存储
 * Serverless 环境无持久内存，使用 /tmp 临时文件存储
 * 每次 cron 扫描写入 /tmp，API 读取时返回
 */
const fs = require('fs');
const path = require('path');

const TMP_DIR = '/tmp';
const ALERTS_FILE = path.join(TMP_DIR, 'yaobi-alerts.json');
const LATEST_FILE = path.join(TMP_DIR, 'yaobi-latest.json');
const STATUS_FILE = path.join(TMP_DIR, 'yaobi-status.json');
const COUNTS_FILE = path.join(TMP_DIR, 'yaobi-alert-counts.json');

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
    console.error('[Store] 写入失败:', e.message);
  }
}

function getAlerts() {
  return readJSON(ALERTS_FILE) || [];
}

function addAlerts(newAlerts) {
  const existing = getAlerts();
  const now = Date.now();
  for (const a of newAlerts) {
    a.id = `${a.symbol}-${now}-${Math.random().toString(36).slice(2, 6)}`;
    a.createdAt = now;
  }
  const merged = [...newAlerts, ...existing].slice(0, 200);
  writeJSON(ALERTS_FILE, merged);
  return merged;
}

function getLatestScan() {
  return readJSON(LATEST_FILE);
}

function setLatestScan(data) {
  writeJSON(LATEST_FILE, data);
}

function getStatus() {
  return readJSON(STATUS_FILE) || { totalScans: 0 };
}

function updateStatus(updates) {
  const current = getStatus();
  writeJSON(STATUS_FILE, { ...current, ...updates });
}

function incrementAlertCount(symbol) {
  const counts = readJSON(COUNTS_FILE) || {};
  const now = Date.now();
  if (!counts[symbol]) counts[symbol] = { count: 0, firstSeen: now, lastSeen: now };
  counts[symbol].count += 1;
  counts[symbol].lastSeen = now;
  writeJSON(COUNTS_FILE, counts);
}

function getAlertCount(symbol) {
  const counts = readJSON(COUNTS_FILE) || {};
  return counts[symbol]?.count || 0;
}

function getAlertCounts() {
  return readJSON(COUNTS_FILE) || {};
}

module.exports = { getAlerts, addAlerts, getLatestScan, setLatestScan, getStatus, updateStatus, incrementAlertCount, getAlertCount, getAlertCounts };
