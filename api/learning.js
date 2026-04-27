/**
 * GET /api/learning — 学习参数状态
 */
const learner = require('./_lib/learner');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const params = learner.getParams();
  res.json({ ok: true, data: params });
};
