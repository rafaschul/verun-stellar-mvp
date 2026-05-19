const { StellarSdk, getServer, getKeypair, ensureFunded, explorerAccount } = require('../src/stellar');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let address = process.env.STELLAR_PUBLIC || null;
    if (!address) {
      try {
        address = getKeypair().publicKey();
      } catch (e) {
        return res.status(500).json({ ok: false, error: `STELLAR_SECRET not configured: ${e.message}` });
      }
    }

    // Auto-fund via Friendbot if needed (idempotent)
    let fundResult = null;
    try {
      fundResult = await ensureFunded(address);
    } catch (e) {
      fundResult = { funded: false, error: e.message };
    }

    const server = getServer();
    const account = await server.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === 'native');
    const xlm = native ? Number(native.balance) : 0;

    res.status(200).json({
      ok: true,
      network: 'stellar-testnet',
      address,
      explorer: explorerAccount(address),
      friendbot: fundResult,
      balance: {
        xlm,
        stroops: Math.round(xlm * 1e7),
        funded: xlm >= 1,
        recommendedMinXlm: 1,
      },
      sequence: account.sequence,
      faucet: 'https://friendbot.stellar.org',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
