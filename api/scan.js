/**
 * POST /api/scan — 手动触发扫描
 * 与 cron.js 共享逻辑
 */
const okxHttp = require('./_lib/okx-http');
const analyzer = require('./_lib/analyzer');
const store = require('./_lib/store');
const tracker = require('./_lib/tracker');
const learner = require('./_lib/learner');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();
  try {
    const okxData = await okxHttp.fullScan();
    const result = analyzer.analyze(okxData);

    store.setLatestScan(result);

    // 标记降温告警
    store.markCooledAlerts(result.allScores);

    if (result.alerts.length > 0) {
      store.addAlerts(result.alerts);
      for (const alert of result.alerts) {
        store.incrementAlertCount(alert.symbol);
        alert.alertCount = store.getAlertCount(alert.symbol);
      }
    }

    // 价格追踪
    try {
      tracker.recordAlerts(result.alerts);
      await tracker.checkPending();
    } catch (e) {
      console.error('[Scan] 追踪异常:', e.message);
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
      topScores: result.allScores.slice(0, 50),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
