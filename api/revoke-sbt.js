const { revokeSBT } = require('../src/sbt');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { agentId, reason } = req.body || {};
    if (!agentId) return res.status(400).json({ success: false, error: 'agentId required' });
    const out = await revokeSBT({ agentId, reason });
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
};
