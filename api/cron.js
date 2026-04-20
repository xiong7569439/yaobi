/**
 * Cron Job 端点 — 每5分钟由 Vercel Cron 触发
 * 执行完整扫描并存储结果
 */
const okxHttp = require('./_lib/okx-http');
const analyzer = require('./_lib/analyzer');
const store = require('./_lib/store');

module.exports = async function handler(req, res) {
  // Vercel Cron 会发送 GET 请求，验证 CRON_SECRET
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();
  try {
    console.log('[Cron] 开始扫描...');

    const okxData = await okxHttp.fullScan();
    const result = analyzer.analyze(okxData);

    store.setLatestScan(result);
    if (result.alerts.length > 0) {
      store.addAlerts(result.alerts);
      for (const alert of result.alerts) {
        store.incrementAlertCount(alert.symbol);
        alert.alertCount = store.getAlertCount(alert.symbol);
      }
    }

    const duration = Date.now() - startTime;
    const status = store.getStatus();
    store.updateStatus({
      totalScans: (status.totalScans || 0) + 1,
      lastScanTime: Date.now(),
      lastScanDuration: duration,
    });

    console.log(`[Cron] 完成: ${result.alerts.length}个告警, 耗时${(duration/1000).toFixed(1)}s`);

    res.status(200).json({
      ok: true,
      duration,
      alertCount: result.alerts.length,
      watchlistCount: result.watchlist.length,
      totalAnalyzed: result.allScores.length,
    });
  } catch (err) {
    console.error('[Cron] 异常:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
