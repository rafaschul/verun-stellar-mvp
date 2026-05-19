/**
 * Verun SBT — Protocol-custodial Soulbound credential on Stellar.
 *
 * Architecture: agent identity is the `agentId` string. The credential is
 * stored as a manageData entry on the protocol account ("network wallet"),
 * NOT on an agent-owned wallet. This matches the EU AI Act / MiFID II frame
 * where the protocol is the responsible party and credentials are revocable
 * unilaterally by the issuer (kill-switch).
 *
 * On-chain proof:
 *   • manageData entry on protocol account: "vtrust_<agentId>" = "<tier>:<score>:<isoTs>"
 *   • A separate memo-hash TX anchoring sha256(credentialJson) for tamper-evidence.
 *
 * Verification (public, anyone can run, no auth):
 *   GET horizon/accounts/<protocolPubKey>/data/vtrust_<agentId>
 *
 * Revocation (kill-switch):
 *   manageData with value = null clears the entry. Audit trail preserved
 *   in horizon transaction history.
 */
require('dotenv').config();
const crypto = require('crypto');
const {
  StellarSdk,
  NETWORK_PASSPHRASE,
  getServer,
  getKeypair,
  ensureFunded,
  explorerTx,
  explorerAccount,
} = require('./stellar');

const MAX_KEY_BYTES = 64;   // Stellar manageData hard limit
const MAX_VAL_BYTES = 64;

function tierFromScore(score) {
  if (score >= 800) return 'LOW';
  if (score >= 600) return 'MED';
  if (score >= 300) return 'HIGH';
  return 'BLOCK';
}

function safeAgentKey(agentId) {
  // Sanitise + truncate so it always fits in 64 bytes alongside the prefix.
  const clean = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  const key = `vtrust_${clean}`;
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    return key.slice(0, MAX_KEY_BYTES);
  }
  return key;
}

function encodeCredential(tier, score, ts) {
  // Compact format: "MED:720:2026-04-30T13:38:04Z" — fits in 64 bytes.
  const v = `${tier}:${score}:${ts}`;
  if (Buffer.byteLength(v, 'utf8') > MAX_VAL_BYTES) {
    return v.slice(0, MAX_VAL_BYTES);
  }
  return v;
}

function parseCredential(b64) {
  if (!b64) return null;
  const raw = Buffer.from(b64, 'base64').toString('utf8');
  const m = raw.match(/^([A-Z]+):(\d+):(.+)$/);
  if (!m) return { raw };
  return { tier: m[1], score: Number(m[2]), ts: m[3] };
}

// ────────────────────────────────────────────────────────────────────
// MINT — issue / refresh credential
// ────────────────────────────────────────────────────────────────────
async function mintSBT({ agentId, score }) {
  if (!agentId) throw new Error('agentId required');
  score = Number(score);
  if (Number.isNaN(score)) throw new Error('score must be a number');
  if (score < 300) {
    throw new Error(`score ${score} below minimum SBT threshold (300). Verdict was BLOCK.`);
  }

  const tier = tierFromScore(score);
  const ts = new Date().toISOString();
  const key = safeAgentKey(agentId);
  const value = encodeCredential(tier, score, ts);

  const credentialPayload = { type: 'verun-sbt', agentId, tier, score, ts, key };
  const credentialHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(credentialPayload))
    .digest();

  const server = getServer();
  const kp = getKeypair();
  const pub = kp.publicKey();
  await ensureFunded(pub);
  const account = await server.loadAccount(pub);

  // One transaction with TWO operations:
  //   1. manageData(vtrust_<agentId>, "<tier>:<score>:<ts>")  → credential registry
  //   2. payment(self, 1 stroop) with memo = sha256(credentialJson) → tamper-proof anchor
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: String(Number(StellarSdk.BASE_FEE) * 2),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.manageData({
        name: key,
        value, // string up to 64 bytes
      })
    )
    .addOperation(
      StellarSdk.Operation.payment({
        destination: pub,
        asset: StellarSdk.Asset.native(),
        amount: '0.0000001',
      })
    )
    .addMemo(StellarSdk.Memo.hash(credentialHash))
    .setTimeout(60)
    .build();

  tx.sign(kp);
  const result = await server.submitTransaction(tx);

  return {
    success: true,
    agentId,
    tier,
    score,
    ts,
    key,
    txid: result.hash,
    ledger: String(result.ledger ?? ''),
    credential_hash: credentialHash.toString('hex'),
    network: 'stellar-testnet',
    issuer: pub,
    explorer: explorerTx(result.hash),
    issuer_explorer: explorerAccount(pub),
    verify_url: `${process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'}/accounts/${pub}/data/${key}`,
  };
}

// ────────────────────────────────────────────────────────────────────
// REVOKE — kill-switch (clears manageData entry)
// ────────────────────────────────────────────────────────────────────
async function revokeSBT({ agentId, reason = 'unspecified' }) {
  if (!agentId) throw new Error('agentId required');
  const key = safeAgentKey(agentId);

  const revokePayload = { type: 'verun-sbt-revoke', agentId, reason, ts: new Date().toISOString() };
  const revokeHash = crypto.createHash('sha256').update(JSON.stringify(revokePayload)).digest();

  const server = getServer();
  const kp = getKeypair();
  const pub = kp.publicKey();
  const account = await server.loadAccount(pub);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: String(Number(StellarSdk.BASE_FEE) * 2),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      // manageData with value=null deletes the entry on-chain
      StellarSdk.Operation.manageData({ name: key, value: null })
    )
    .addOperation(
      StellarSdk.Operation.payment({
        destination: pub,
        asset: StellarSdk.Asset.native(),
        amount: '0.0000001',
      })
    )
    .addMemo(StellarSdk.Memo.hash(revokeHash))
    .setTimeout(60)
    .build();

  tx.sign(kp);
  const result = await server.submitTransaction(tx);

  return {
    success: true,
    revoked: true,
    agentId,
    key,
    reason,
    txid: result.hash,
    ledger: String(result.ledger ?? ''),
    revoke_hash: revokeHash.toString('hex'),
    explorer: explorerTx(result.hash),
  };
}

// ────────────────────────────────────────────────────────────────────
// STATUS — read credential from on-chain manageData
// ────────────────────────────────────────────────────────────────────
async function statusSBT({ agentId }) {
  if (!agentId) throw new Error('agentId required');
  const key = safeAgentKey(agentId);
  const server = getServer();
  const kp = getKeypair();
  const pub = kp.publicKey();
  const account = await server.loadAccount(pub);
  const dataEntries = account.data_attr || {};
  const b64 = dataEntries[key];

  if (!b64) {
    return {
      ok: true,
      agentId,
      credentialed: false,
      key,
      issuer: pub,
      verify_url: `${process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'}/accounts/${pub}/data/${key}`,
    };
  }

  return {
    ok: true,
    agentId,
    credentialed: true,
    key,
    issuer: pub,
    credential: parseCredential(b64),
    verify_url: `${process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'}/accounts/${pub}/data/${key}`,
    issuer_explorer: explorerAccount(pub),
  };
}

// ────────────────────────────────────────────────────────────────────
// LIST — every credentialed agent on this issuer
// ────────────────────────────────────────────────────────────────────
async function listSBT() {
  const server = getServer();
  const kp = getKeypair();
  const pub = kp.publicKey();
  const account = await server.loadAccount(pub);
  const dataEntries = account.data_attr || {};
  const out = [];
  for (const [k, v] of Object.entries(dataEntries)) {
    if (!k.startsWith('vtrust_')) continue;
    out.push({
      key: k,
      agentId: k.replace(/^vtrust_/, ''),
      credential: parseCredential(v),
    });
  }
  return {
    ok: true,
    issuer: pub,
    issuer_explorer: explorerAccount(pub),
    total: out.length,
    credentials: out,
  };
}

module.exports = { mintSBT, revokeSBT, statusSBT, listSBT, tierFromScore };
