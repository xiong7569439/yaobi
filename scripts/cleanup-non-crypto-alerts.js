/**
 * 一次性清理: 把 data/alerts.json 里残留的非加密资产告警剔除
 * 同样逻辑: 不在 OKX spot 基础币种白名单里的就删
 */
const fs = require('fs');
const path = require('path');
const okxFetcher = require('../lib/okx-fetcher');

const ALERTS_FILE = path.join(__dirname, '..', 'data', 'alerts.json');
if (!fs.existsSync(ALERTS_FILE)) {
  console.log('alerts.json 不存在, 跳过');
  process.exit(0);
}

const alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf-8'));
if (!Array.isArray(alerts) || alerts.length === 0) {
  console.log('alerts.json 无记录, 跳过');
  process.exit(0);
}

const tickers = okxFetcher.getSpotTickers();
const whitelist = new Set(tickers.map(t => (t.instId || '').split('-')[0]).filter(Boolean));
console.log('OKX spot 白名单:', whitelist.size, '个币种');
console.log('alerts.json 原有:', alerts.length, '条');

const removed = [];
const kept = alerts.filter(a => {
  if (!a.symbol) return true;
  if (whitelist.has(a.symbol)) return true;
  removed.push(a.symbol);
  return false;
});

fs.writeFileSync(ALERTS_FILE, JSON.stringify(kept, null, 2), 'utf-8');

console.log('移除非加密资产告警:', removed.length, '条');
if (removed.length > 0) {
  const uniq = Array.from(new Set(removed));
  console.log('涉及符号(去重前20):', uniq.slice(0, 20).join(', '));
}
console.log('剩余告警:', kept.length, '条');
