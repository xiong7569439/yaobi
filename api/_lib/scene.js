/**
 * 场景标签器 - 给每个告警快照打上"场景"标签
 *
 * 解决核心问题: 告警不能一刀切, 要区分"什么大盘/什么阶段/什么特征"下的告警
 * 灵感来源: Hermes/MAKIMA 交易员经验库 - 按场景检索历史经验
 *
 * 输出标签体系:
 *  - priceStage:   价格位置 (埋伏 / 启动 / 上涨 / 尾部 / 暴跌)
 *  - marketScene:  大盘状态 (BTC上涨 / BTC横盘 / BTC下跌 + 强度档位)
 *  - fundingRegime:费率状态 (极高/偏高/健康/偏低/负费率)
 *  - volumeRegime: 放量强度 (爆量/放量/平量/缩量)
 *  - sceneKey:     组合键, 用于场景相似度检索
 */

/**
 * 价格位置标签 - 基于告警时的 change24hPct
 * @param {number} change24hPct
 * @returns {string}
 */
function classifyPriceStage(change24hPct) {
  const c = change24hPct || 0;
  if (c <= -20) return 'crash';       // 暴跌 - 可能抄底
  if (c <= -5) return 'pullback';     // 回调 - 可能埋伏买点
  if (c < 5) return 'ambush';         // 埋伏 - 还没发动
  if (c < 20) return 'ignition';      // 启动 - 刚起步
  if (c < 50) return 'rally';         // 上涨中 - 行情展开
  if (c < 100) return 'tail';         // 尾部 - 追高风险区
  return 'blowoff';                   // 暴涨尾声 - 接盘区
}

/**
 * 大盘状态标签 - 基于 BTC 24h 涨跌
 * @param {Object} marketContext - {btc: {change24hPct}, eth: {change24hPct}}
 * @returns {string}
 */
function classifyMarketScene(marketContext) {
  if (!marketContext || !marketContext.btc) return 'unknown';
  const btc = marketContext.btc.change24hPct || 0;
  const eth = marketContext.eth?.change24hPct || 0;
  const avg = (btc + eth) / 2;

  if (avg >= 5) return 'btc_strong_up';    // BTC 强势上涨
  if (avg >= 2) return 'btc_up';           // BTC 温和上涨
  if (avg > -2) return 'btc_sideways';     // BTC 横盘
  if (avg > -5) return 'btc_down';         // BTC 温和下跌
  return 'btc_strong_down';                // BTC 大跌
}

/**
 * 资金费率状态
 * @param {number} fundingRate - OKX 原始值, 0.0001 = 0.01%
 * @returns {string}
 */
function classifyFundingRegime(fundingRate) {
  const f = fundingRate || 0;
  if (f >= 0.0005) return 'fr_extreme_high';  // 极高 - 多头过热
  if (f >= 0.0002) return 'fr_high';          // 偏高
  if (f > 0) return 'fr_healthy';             // 健康正费率
  if (f > -0.0002) return 'fr_low';           // 接近零或轻微负
  return 'fr_negative';                       // 明显负费率 - 空头过拥挤
}

/**
 * 放量强度
 * @param {number} volumeMultiplier - 相对中位数倍数
 * @returns {string}
 */
function classifyVolumeRegime(volumeMultiplier) {
  const v = volumeMultiplier || 1;
  if (v >= 5) return 'vol_explosive';   // 爆量
  if (v >= 3) return 'vol_surge';       // 放量
  if (v >= 1.5) return 'vol_up';        // 轻量增加
  if (v >= 0.7) return 'vol_normal';    // 正常
  return 'vol_dry';                     // 缩量
}

/**
 * OI 变化强度
 */
function classifyOiRegime(oiChangePct) {
  const o = oiChangePct || 0;
  if (o >= 30) return 'oi_flood';      // 持仓暴增
  if (o >= 10) return 'oi_build';      // 建仓中
  if (o > -5) return 'oi_stable';      // 稳定
  if (o > -15) return 'oi_fade';       // 离场
  return 'oi_flee';                    // 大量离场
}

/**
 * 聪明钱先动探测 (Smart Money Early)
 *
 * 核心逻辑: 在价格还没走出来时, OI 已经惄惄建仓 + 成交量温和放大 + 费率未拥挤
 * 这等于在说“有人在离经据仓但未拉盘”, 是埋伏期最黄金的开仓 setup
 *
 * 四项必须同时成立:
 *   1) 价格安静: |24h涨跌| < 5%
 *   2) OI 建仓: oiChangePct ∈ [10%, 40%) —— 低于10%说明没人动, 高于40%已经是拉盘
 *   3) 成交量温暖: volumeMultiplier ∈ [1.5, 5) —— 不能是爆量, 正如足够引注意即可
 *   4) 费率未异常: fundingRate ∈ (-0.02%, 0.02%) —— 无多空拥挤
 *
 * @param {Object} input - {change24hPct, fundingRate, oiChangePct, volumeMultiplier}
 * @returns {boolean}
 */
function detectSmartMoneyEarly(input = {}) {
  const c = Math.abs(input.change24hPct || 0);
  const o = input.oiChangePct || 0;
  const v = input.volumeMultiplier || 1;
  const f = input.fundingRate || 0;

  const priceQuiet = c < 5;
  const oiBuilding = o >= 10 && o < 40;
  const volWarmingUp = v >= 1.5 && v < 5;
  const fundingNormal = f > -0.0002 && f < 0.0002;

  return priceQuiet && oiBuilding && volWarmingUp && fundingNormal;
}

/**
 * 一次性给一条告警快照打全套标签
 * @param {Object} input - {change24hPct, fundingRate, oiChangePct, volumeMultiplier, marketContext}
 * @returns {Object} { priceStage, marketScene, fundingRegime, volumeRegime, oiRegime, sceneKey }
 */
function tagSnapshot(input = {}) {
  const priceStage = classifyPriceStage(input.change24hPct);
  const marketScene = classifyMarketScene(input.marketContext);
  const fundingRegime = classifyFundingRegime(input.fundingRate);
  const volumeRegime = classifyVolumeRegime(input.volumeMultiplier);
  const oiRegime = classifyOiRegime(input.oiChangePct);
  const smartMoneyEarly = detectSmartMoneyEarly(input);

  // 场景键 - 用于后续经验库相似度检索 (粗粒度组合)
  const sceneKey = `${marketScene}|${priceStage}|${fundingRegime}|${oiRegime}`;

  return {
    priceStage,
    marketScene,
    fundingRegime,
    volumeRegime,
    oiRegime,
    smartMoneyEarly,
    sceneKey,
  };
}

/**
 * 场景相似度 - 简单的 Jaccard 式匹配
 * 五个标签中匹配几个算几分, 用于后续经验检索
 */
function sceneSimilarity(sceneA, sceneB) {
  if (!sceneA || !sceneB) return 0;
  const keys = ['priceStage', 'marketScene', 'fundingRegime', 'volumeRegime', 'oiRegime'];
  let match = 0;
  for (const k of keys) {
    if (sceneA[k] && sceneA[k] === sceneB[k]) match++;
  }
  return match / keys.length; // 0 ~ 1
}

/**
 * 场景中文释义 (前端/日志展示用)
 */
const LABEL_CN = {
  // priceStage
  crash: '暴跌', pullback: '回调', ambush: '埋伏', ignition: '启动',
  rally: '上涨中', tail: '尾部', blowoff: '暴涨尾声',
  // marketScene
  btc_strong_up: 'BTC强涨', btc_up: 'BTC上涨', btc_sideways: 'BTC横盘',
  btc_down: 'BTC下跌', btc_strong_down: 'BTC大跌', unknown: '大盘未知',
  // fundingRegime
  fr_extreme_high: '费率极高', fr_high: '费率偏高', fr_healthy: '费率健康',
  fr_low: '费率低位', fr_negative: '负费率',
  // volumeRegime
  vol_explosive: '爆量', vol_surge: '放量', vol_up: '轻量', vol_normal: '平量', vol_dry: '缩量',
  // oiRegime
  oi_flood: 'OI暴增', oi_build: 'OI建仓', oi_stable: 'OI稳定', oi_fade: 'OI离场', oi_flee: 'OI溃逃',
};

function labelCn(tag) {
  return LABEL_CN[tag] || tag;
}

module.exports = {
  classifyPriceStage,
  classifyMarketScene,
  classifyFundingRegime,
  classifyVolumeRegime,
  classifyOiRegime,
  detectSmartMoneyEarly,
  tagSnapshot,
  sceneSimilarity,
  labelCn,
  LABEL_CN,
};
