const { listSBT } = require('../src/sbt');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const out = await listSBT();
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
