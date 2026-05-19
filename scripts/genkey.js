/**
 * Generate a fresh Stellar testnet keypair AND fund it via Friendbot.
 * Usage:  npm run genkey   (or:  node scripts/genkey.js )
 *
 * Print the secret + public key. Copy them into Vercel env vars:
 *   STELLAR_SECRET = S...
 *   STELLAR_PUBLIC = G...
 */
const StellarSdk = require('@stellar/stellar-sdk');
const FRIENDBOT = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';

(async () => {
  const kp = StellarSdk.Keypair.random();
  const pub = kp.publicKey();
  const sec = kp.secret();

  console.log('────────────────────────────────────────────────────────────');
  console.log(' Stellar testnet keypair');
  console.log('────────────────────────────────────────────────────────────');
  console.log(' STELLAR_PUBLIC =', pub);
  console.log(' STELLAR_SECRET =', sec);
  console.log('────────────────────────────────────────────────────────────');
  console.log(' Funding via Friendbot...');

  const r = await fetch(`${FRIENDBOT}/?addr=${encodeURIComponent(pub)}`);
  const body = await r.text();
  if (!r.ok) {
    console.error(' Friendbot error', r.status, body.slice(0, 300));
    process.exit(1);
  }
  let json;
  try { json = JSON.parse(body); } catch { json = {}; }
  console.log(' Funded ✓   hash:', json.hash || '(unknown)');
  console.log('');
  console.log(' Save the SECRET above somewhere safe — it cannot be recovered.');
  console.log(' Set STELLAR_SECRET (and optionally STELLAR_PUBLIC) in Vercel.');
})().catch((e) => { console.error('ERR:', e.message || e); process.exit(1); });
