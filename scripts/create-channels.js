#!/usr/bin/env node
/**
 * Generate N Stellar channel accounts for high-throughput anchoring.
 *
 * Channel accounts pattern: pre-create multiple sub-wallets, distribute
 * anchor txs across them → each channel has its own sequence number,
 * so 40+ concurrent users → 0 `tx_bad_seq` errors.
 *
 * Usage:
 *   node scripts/create-channels.js 20       # create 20 channels
 *   node scripts/create-channels.js 30       # create 30 channels
 *
 * Outputs a single env var line ready to paste into Vercel:
 *   STELLAR_CHANNELS=<secret1>,<secret2>,<secret3>,...
 *
 * Each channel is auto-funded via Friendbot (1000 XLM testnet).
 */

require('dotenv').config();
const { StellarSdk, FRIENDBOT_URL } = require('../src/stellar');

const N = Math.max(1, Math.min(50, Number(process.argv[2] || 20)));

const fetchFn = globalThis.fetch ? globalThis.fetch.bind(globalThis) : require('node-fetch');

async function fund(publicKey) {
  const r = await fetchFn(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Friendbot ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json().catch(() => ({}));
}

(async () => {
  console.log(`\n🔧 Generating ${N} channel accounts...\n`);

  const channels = [];
  for (let i = 0; i < N; i++) {
    const kp = StellarSdk.Keypair.random();
    const pub = kp.publicKey();
    const sec = kp.secret();

    process.stdout.write(`  Channel ${String(i + 1).padStart(2)}/${N}: funding ${pub.slice(0, 8)}…${pub.slice(-6)} `);

    try {
      await fund(pub);
      console.log('✓');
      channels.push({ pub, sec });
    } catch (e) {
      console.log(`✗ ${e.message}`);
      // Continue with rest
    }

    // Small delay to avoid hammering Friendbot
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\n✅ Created ${channels.length}/${N} channels successfully.\n`);

  if (channels.length === 0) {
    console.error('All channel funding failed. Check Friendbot availability.');
    process.exit(1);
  }

  const secrets = channels.map((c) => c.sec).join(',');
  const pubs = channels.map((c) => c.pub).join(',');

  console.log('─────────────────────────────────────────────────────────────');
  console.log('📋 Paste this into Vercel env vars (or .env):');
  console.log('─────────────────────────────────────────────────────────────\n');
  console.log(`STELLAR_CHANNELS=${secrets}\n`);
  console.log('─────────────────────────────────────────────────────────────');
  console.log('🔍 Public keys (for explorer / debugging):');
  console.log('─────────────────────────────────────────────────────────────\n');
  console.log(`STELLAR_CHANNEL_PUBKEYS=${pubs}\n`);
  console.log('─────────────────────────────────────────────────────────────');
  console.log('After setting env var → redeploy on Vercel.');
  console.log(`Theoretical concurrent capacity: ~${channels.length * 3} parallel anchors`);
  console.log('─────────────────────────────────────────────────────────────\n');
})();
