/**
 * GET /api/status — 系统状态
 */
const store = require('./_lib/store');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const status = store.getStatus();
  status.nextScanTime = (status.lastScanTime || Date.now()) + 5 * 60 * 1000;
  status.scanInterval = 5 * 60 * 1000;
  status.alertCount = store.getAlerts().length;
  res.json({ ok: true, data: status });
};
