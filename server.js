/**
 * 妖币监控系统 — 主服务入口
 * Express Web 服务 + SSE 实时推送 + REST API
 */

// OKX API 凭据 (启动时自动注入环境变量)
process.env.OKX_API_KEY = process.env.OKX_API_KEY || '69e4a973-37f6-445c-83ac-122b8836efe2';
process.env.OKX_SECRET_KEY = process.env.OKX_SECRET_KEY || '4134344FFC9BBBF7D1DC97C78D49C7BA';
process.env.OKX_PASSPHRASE = process.env.OKX_PASSPHRASE || 'XDCjzA5ar@Ytz29';

const express = require('express');
const path = require('path');
const store = require('./lib/store');
const scanner = require('./lib/scanner');
const tracker = require('./lib/tracker');
const learner = require('./lib/learner');

const PORT = process.env.PORT || 3000;
const app = express();

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ============ API 端点 ============

// SSE 实时推送
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`data: ${JSON.stringify({ type: 'connected', data: { time: Date.now() } })}\n\n`);
  store.addSSEClient(res);

  // 心跳
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);
  req.on('close', () => clearInterval(heartbeat));
});

// 获取告警列表
app.get('/api/alerts', (req, res) => {
  const { level, symbol, limit } = req.query;
  const alerts = store.getAlerts({
    level,
    symbol,
    limit: limit ? parseInt(limit) : 100,
  });
  res.json({ ok: true, data: alerts, total: alerts.length });
});

// 系统状态
app.get('/api/status', (req, res) => {
  const status = store.getStatus();
  status.nextScanTime = scanner.getNextScanTime();
  status.scanInterval = scanner.SCAN_INTERVAL;
  res.json({ ok: true, data: status });
});

// 最新扫描结果
app.get('/api/latest', (req, res) => {
  const latest = store.getLatestScan();
  res.json({ ok: true, data: latest });
});

// 扫描日志
app.get('/api/logs', (req, res) => {
  const logs = store.getScanLogs();
  res.json({ ok: true, data: logs });
});

// 追踪记录
app.get('/api/tracking', (req, res) => {
  const { status, symbol, limit } = req.query;
  const records = tracker.getTracking({
    status,
    symbol,
    limit: limit ? parseInt(limit) : 100,
  });
  const stats = tracker.getTrackingStats();
  res.json({ ok: true, data: records, stats, total: records.length });
});

// 学习参数
app.get('/api/learning', (req, res) => {
  const params = learner.getParams();
  res.json({ ok: true, data: params });
});

// 大盘背景
app.get('/api/market', (req, res) => {
  const ctx = store.getMarketContext();
  res.json({ ok: true, data: ctx });
});

// 手动触发扫描
app.post('/api/scan', async (req, res) => {
  const st = store.getStatus();
  if (st.isScanning) {
    return res.json({ ok: false, message: '扫描正在进行中' });
  }
  try {
    const startTime = Date.now();
    const result = await scanner.runScan();
    const duration = Date.now() - startTime;
    if (result) {
      res.json({
        ok: true,
        duration,
        alertCount: result.alerts.length,
        watchlistCount: result.watchlist.length,
        alerts: result.alerts,
        watchlist: result.watchlist.slice(0, 10),
        topScores: result.allScores.slice(0, 50),
      });
    } else {
      res.json({ ok: true, duration, alertCount: 0, alerts: [], watchlist: [], topScores: [] });
    }
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ============ 启动 ============

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║            妖币监控系统 — Meme Coin Monitor           ║
║                                                      ║
║  OKX Agent Trade Kit + Surf Data Platform            ║
║                                                      ║
║  Web 仪表盘: http://localhost:${PORT}                  ║
║  SSE 推送:   http://localhost:${PORT}/api/events       ║
║  扫描间隔:   每 ${scanner.SCAN_INTERVAL / 60000} 分钟                            ║
╚══════════════════════════════════════════════════════╝
  `);
  // 启动定时扫描
  scanner.start();
});
