/**
 * On-chain anchor for a Verun verdict on Stellar.
 * Strategy: 1-stroop self-payment whose memo is sha256(verdictPayload).
 * Produces a real Stellar Testnet TX with explorer link — an immutable,
 * timestamped audit anchor for every evaluation.
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

async function anchorEvaluation(payload) {
  const server = getServer();
  const kp = getKeypair();
  const pub = kp.publicKey();

  // Auto-fund on first run (no-op if already funded)
  await ensureFunded(pub);

  const json = JSON.stringify(payload);
  const digest = crypto.createHash('sha256').update(json).digest(); // 32 bytes
  const account = await server.loadAccount(pub);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: pub,
        asset: StellarSdk.Asset.native(),
        amount: '0.0000001', // 1 stroop self-payment
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
    memo_hash: digest.toString('hex'),
    payload_hash: digest.toString('hex'),
    payload_size: json.length,
    explorer: explorerTx(result.hash),
    horizon: `${process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'}/transactions/${result.hash}`,
  };
}

module.exports = { anchorEvaluation };
