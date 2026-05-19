require('dotenv').config();
const { getServer, getKeypair, explorerAccount } = require('../src/stellar');

(async () => {
  const kp = getKeypair();
  const pub = kp.publicKey();
  const server = getServer();
  const account = await server.loadAccount(pub);
  const native = account.balances.find((b) => b.asset_type === 'native');
  const xlm = native ? Number(native.balance) : 0;

  console.log('address       :', pub);
  console.log('balance_xlm   :', xlm);
  console.log('balance_stroops:', Math.round(xlm * 1e7));
  console.log('sequence      :', account.sequence);
  console.log('explorer      :', explorerAccount(pub));
})().catch((e) => { console.error('ERR:', e.message || e); process.exit(1); });
