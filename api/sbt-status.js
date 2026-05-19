const { statusSBT } = require('../src/sbt');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const agentId = (req.query && req.query.agentId) || '';
    if (!agentId) return res.status(400).json({ ok: false, error: 'agentId query param required' });
    const out = await statusSBT({ agentId });
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
