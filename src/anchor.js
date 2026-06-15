/**
 * On-chain anchor for a Verun verdict on Stellar.
 * Strategy: native-asset self-payment whose memo is sha256(verdictPayload).
 * Produces a real Stellar Testnet TX with explorer link — an immutable,
 * timestamped audit anchor for every evaluation.
 *
 * The self-payment amount defaults to the x402 XLM price (0.005 XLM by default)
 * so the on-chain TX visibly reflects the evaluation price. Override via the
 * `amount` option or the `X402_PRICE_XLM` env var.
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
} = require('./stellar');

const DEFAULT_ANCHOR_AMOUNT = process.env.X402_PRICE_XLM || '0.005';

async function anchorEvaluation(payload, opts = {}) {
  const server = getServer();
  const kp = getKeypair();
  const pub = kp.publicKey();

  // Auto-fund on first run (no-op if already funded)
  await ensureFunded(pub);

  const json = JSON.stringify(payload);
  const digest = crypto.createHash('sha256').update(json).digest(); // 32 bytes
  const account = await server.loadAccount(pub);

  // Self-payment amount — defaults to the x402 XLM price so explorer reflects
  // the demo evaluation price (0.005 XLM). Caller can override via opts.amount.
  const amount = String(opts.amount || DEFAULT_ANCHOR_AMOUNT);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: pub,
        asset: StellarSdk.Asset.native(),
        amount,
      })
    )
    .addMemo(StellarSdk.Memo.hash(digest))
    .setTimeout(60)
    .build();

  tx.sign(kp);

  const result = await server.submitTransaction(tx);

  return {
    txid: result.hash,
    ledger: String(result.ledger ?? ''),
    network: 'stellar-testnet',
    amount,
    asset: 'XLM',
    memo_hash: digest.toString('hex'),
    payload_hash: digest.toString('hex'),
    payload_size: json.length,
    explorer: explorerTx(result.hash),
    horizon: `${process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'}/transactions/${result.hash}`,
  };
}

module.exports = { anchorEvaluation };
