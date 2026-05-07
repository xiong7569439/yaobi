/**
 * 一次性清理: 把超过 48h 还没拿到任何价格的僵尸 tracking 记录标为 stale
 * 典型来源: 美股代码 (AMD/INTC/MU 等) 被误当 crypto symbol
 */
const fs = require('fs');
const path = require('path');
const okxFetcher = require('../lib/okx-fetcher');

const TRACKING_FILE = path.join(__dirname, '..', 'data', 'tracking.json');
const now = Date.now();
const STALE_H = 48 * 3600 * 1000;

const records = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf-8'));

// 拉一次 OKX spot symbol 名单
const tickers = okxFetcher.getSpotTickers();
const validSymbols = new Set(tickers.map(t => (t.instId || '').split('-')[0]).filter(Boolean));
console.log(`OKX spot 可用 symbol: ${validSymbols.size} 个`);

let staleByAge = 0;
let staleByMissing = 0;
const sampleMissing = new Set();

for (const r of records) {
  if (r.status === 'complete' || r.status === 'stale') continue;
  const age = now - r.alertTime;
  const noneFilled = !r.p1h && !r.p4h && !r.p24h;
  const notInOkx = !validSymbols.has(r.symbol);

  // 条件1: 超过 48h 且从没拿到过任何价格 → stale
  // 条件2: OKX spot 根本没这个 symbol → 直接 stale (无论年龄)
  if ((age > STALE_H && noneFilled) || notInOkx) {
    r.status = 'stale';
    r.staleReason = notInOkx
      ? `OKX spot 无 ${r.symbol} (疑似非加密资产代码)`
      : '超过 48h 仍未获取到任何价格';
    if (notInOkx) {
      staleByMissing++;
      sampleMissing.add(r.symbol);
    } else {
      staleByAge++;
    }
  }
}

fs.writeFileSync(TRACKING_FILE, JSON.stringify(records, null, 2), 'utf-8');

console.log(`\n========== 清理结果 ==========`);
console.log(`按年龄(>48h 且无价格)标 stale: ${staleByAge} 条`);
console.log(`按 OKX 无此 symbol 标 stale:    ${staleByMissing} 条`);
console.log(`合计 stale:                      ${staleByAge + staleByMissing} 条`);
console.log(`\n疑似非加密资产代码样本(前20): ${Array.from(sampleMissing).slice(0, 20).join(', ')}`);

// 重新统计
const stats = {
  total: records.length,
  pending: records.filter(r => r.status === 'pending').length,
  partial: records.filter(r => r.status === 'partial').length,
  complete: records.filter(r => r.status === 'complete').length,
  stale: records.filter(r => r.status === 'stale').length,
};
console.log(`\n清理后状态分布:`, stats);
