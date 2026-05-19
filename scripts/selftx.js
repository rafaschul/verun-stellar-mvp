require('dotenv').config();
const crypto = require('crypto');
const {
  StellarSdk,
  NETWORK_PASSPHRASE,
  getServer,
  getKeypair,
  ensureFunded,
  explorerTx,
} = require('../src/stellar');

(async () => {
  const kp = getKeypair();
  const pub = kp.publicKey();
  const server = getServer();

  await ensureFunded(pub);
  const account = await server.loadAccount(pub);

  const payload = `verun-selftest-${Date.now()}`;
  const digest = crypto.createHash('sha256').update(payload).digest();

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: pub,
        asset: StellarSdk.Asset.native(),
        amount: '0.0000001',
      })
    )
    .addMemo(StellarSdk.Memo.hash(digest))
    .setTimeout(60)
    .build();

  tx.sign(kp);
  const result = await server.submitTransaction(tx);

  console.log('txid    :', result.hash);
  console.log('ledger  :', result.ledger);
  console.log('explorer:', explorerTx(result.hash));
})().catch((e) => {
  console.error('ERR:', e.message || e);
  if (e?.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
