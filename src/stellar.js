/**
 * Verun Stellar MVP — Stellar helpers
 * Centralised wallet/signer + Friendbot auto-fund logic.
 */
require('dotenv').config();
const StellarSdk = require('@stellar/stellar-sdk');

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';

function normalizeSecret(raw) {
  return String(raw || '').trim().replace(/^['"`]+|['"`]+$/g, '');
}

function getServer() {
  return new StellarSdk.Horizon.Server(HORIZON_URL);
}

function getKeypair() {
  const secret = normalizeSecret(process.env.STELLAR_SECRET);
  if (!secret) throw new Error('STELLAR_SECRET env var missing');
  if (!secret.startsWith('S')) throw new Error('STELLAR_SECRET must start with "S"');
  return StellarSdk.Keypair.fromSecret(secret);
}

function explorerTx(txid) {
  return `https://stellar.expert/explorer/testnet/tx/${txid}`;
}

function explorerAccount(addr) {
  return `https://stellar.expert/explorer/testnet/account/${addr}`;
}

/**
 * Auto-fund the configured testnet account via Friendbot if it doesn't exist
 * yet. Returns { funded: bool, alreadyExisted: bool, hash?: string }.
 */
async function ensureFunded(publicKey) {
  const server = getServer();
  try {
    await server.loadAccount(publicKey);
    return { funded: true, alreadyExisted: true };
  } catch (e) {
    // Not found → fund via Friendbot
    if (!(e?.response?.status === 404 || /not found/i.test(e.message))) throw e;
  }
  const r = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Friendbot ${r.status}: ${body.slice(0, 200)}`);
  }
  const body = await r.json().catch(() => ({}));
  return { funded: true, alreadyExisted: false, hash: body.hash || null };
}

module.exports = {
  StellarSdk,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  FRIENDBOT_URL,
  getServer,
  getKeypair,
  ensureFunded,
  explorerTx,
  explorerAccount,
  normalizeSecret,
};
