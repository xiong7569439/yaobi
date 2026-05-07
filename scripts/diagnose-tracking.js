const fs = require('fs');
const t = JSON.parse(fs.readFileSync('data/tracking.json', 'utf-8'));
const now = Date.now();
const H = 3600 * 1000;

// 按告警时间距今分桶
const buckets = { '<1h':0, '1-4h':0, '4-24h':0, '1-3d':0, '>3d':0 };
const ret1hByAge = { '<1h':0, '1-4h':0, '4-24h':0, '1-3d':0, '>3d':0 };
const ret24hByAge = { '<1h':0, '1-4h':0, '4-24h':0, '1-3d':0, '>3d':0 };

for (const r of t) {
  const ageH = (now - r.alertTime) / H;
  const key = ageH < 1 ? '<1h' : ageH < 4 ? '1-4h' : ageH < 24 ? '4-24h' : ageH < 72 ? '1-3d' : '>3d';
  buckets[key]++;
  if (r.return1h != null) ret1hByAge[key]++;
  if (r.return24h != null) ret24hByAge[key]++;
}

console.log('\n========== 追踪记录按 "告警年龄" 分桶 ==========');
console.log('年龄段  | 总数 | 已填1h | 已填24h');
for (const k of Object.keys(buckets)) {
  console.log(`${k.padEnd(7)} | ${String(buckets[k]).padEnd(4)} | ${String(ret1hByAge[k]).padEnd(6)} | ${ret24hByAge[k]}`);
}

// 老记录(>24h)但没填 24h 的，是丢失的检查
const missed = t.filter(r => ((now - r.alertTime) > 24 * H) && r.return24h == null);
console.log(`\n老记录(>24h)但 return24h 仍为 null: ${missed.length} 条`);
if (missed.length) {
  console.log('样本（前5条）:');
  for (const r of missed.slice(0, 5)) {
    console.log(`  ${r.symbol}  年龄${((now-r.alertTime)/H).toFixed(1)}h  status=${r.status}  p0=${r.p0}  1h=${r.return1h}  4h=${r.return4h}  24h=${r.return24h}`);
  }
}

// 还统计每天产生多少条
const perDay = {};
for (const r of t) {
  const d = new Date(r.alertTime).toISOString().slice(0, 10);
  perDay[d] = (perDay[d] || 0) + 1;
}
console.log('\n========== 每日告警量 ==========');
Object.entries(perDay).sort().forEach(([d, n]) => console.log(`  ${d}  ${n} 条`));

// 最老 / 最新
const sorted = t.map(r => r.alertTime).sort();
console.log('\n最老记录: ' + new Date(sorted[0]).toLocaleString());
console.log('最新记录: ' + new Date(sorted[sorted.length-1]).toLocaleString());
console.log('总量: ' + t.length + ' / MAX 500');
