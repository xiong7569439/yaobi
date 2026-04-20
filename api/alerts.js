/**
 * GET /api/alerts — 获取告警列表
 */
const store = require('./_lib/store');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const alerts = store.getAlerts();
  const { level, symbol, limit } = req.query;
  let filtered = alerts;
  if (level) filtered = filtered.filter(a => a.level === level);
  if (symbol) filtered = filtered.filter(a => a.symbol.includes(symbol.toUpperCase()));
  if (limit) filtered = filtered.slice(0, parseInt(limit));
  res.json({ ok: true, data: filtered, total: filtered.length });
};
