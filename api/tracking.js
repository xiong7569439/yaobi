/**
 * GET /api/tracking — 追踪记录
 */
const tracker = require('./_lib/tracker');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { status, symbol, limit } = req.query;
  const records = tracker.getTracking({
    status,
    symbol,
    limit: limit ? parseInt(limit) : 100,
  });
  const stats = tracker.getTrackingStats();
  res.json({ ok: true, data: records, stats, total: records.length });
};
