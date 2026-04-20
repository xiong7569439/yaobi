/**
 * GET /api/latest — 最新扫描结果
 */
const store = require('./_lib/store');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const latest = store.getLatestScan();
  res.json({ ok: true, data: latest });
};
