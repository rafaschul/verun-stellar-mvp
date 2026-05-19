const StellarSdk = require('@stellar/stellar-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secretRaw = process.env.STELLAR_SECRET || '';
  const horizonUrl = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
  const networkPassphrase = process.env.NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;
  const configuredAddress = process.env.STELLAR_PUBLIC || null;

  let secretValid = false;
  let derivedAddress = null;
  let secretError = null;

  if (secretRaw) {
    try {
      const kp = StellarSdk.Keypair.fromSecret(secretRaw.trim());
      secretValid = true;
      derivedAddress = kp.publicKey();
    } catch (e) {
      secretError = e.message || String(e);
    }
  }

  let horizonReachable = false;
  let horizonStatus = null;
  let horizonError = null;
  try {
    const r = await fetch(horizonUrl);
    horizonStatus = r.status;
    horizonReachable = r.ok;
  } catch (e) {
    horizonError = e.message || String(e);
  }

  return res.status(200).json({
    ok: true,
    checks: {
      secret_present: Boolean(secretRaw),
      secret_valid: secretValid,
      secret_error: secretError,
      derived_address: derivedAddress,
      configured_address: configuredAddress,
      address_match: Boolean(
        derivedAddress && configuredAddress && derivedAddress === configuredAddress
      ),
      horizon_url: horizonUrl,
      horizon_reachable: horizonReachable,
      horizon_status: horizonStatus,
      horizon_error: horizonError,
      network_passphrase: networkPassphrase,
    },
    hints: [
      'If secret_valid=false, re-save STELLAR_SECRET in Vercel — it must start with "S" and be 56 chars.',
      'If address_match=false, update STELLAR_PUBLIC to the secret-derived G... address (or remove it to skip the check).',
      'After fixing env vars, redeploy and retest /api/funding-status + /api/evaluate.',
    ],
  });
};
