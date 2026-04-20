/**
 * POST /api/scan — 手动触发扫描
 * 与 cron.js 共享逻辑
 */
const okxHttp = require('./_lib/okx-http');
const surfHttp = require('./_lib/surf-http');
const analyzer = require('./_lib/analyzer');
const store = require('./_lib/store');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();
  try {
    const [okxData, surfData] = await Promise.all([
      okxHttp.fullScan(),
      surfHttp.fullScan(),
    ]);

    const result = analyzer.analyze(okxData, surfData);

    store.setLatestScan(result);
    if (result.alerts.length > 0) {
      store.addAlerts(result.alerts);
    }

    const duration = Date.now() - startTime;
    const status = store.getStatus();
    store.updateStatus({
      totalScans: (status.totalScans || 0) + 1,
      lastScanTime: Date.now(),
      lastScanDuration: duration,
    });

    res.json({
      ok: true,
      duration,
      alertCount: result.alerts.length,
      watchlistCount: result.watchlist.length,
      alerts: result.alerts,
      watchlist: result.watchlist.slice(0, 5),
      topScores: result.allScores.slice(0, 10),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
