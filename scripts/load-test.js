#!/usr/bin/env node
/**
 * Hardcore load + integrity test for the channel-accounts deployment.
 *
 *   Usage:
 *     node scripts/load-test.js                         # full suite (default)
 *     node scripts/load-test.js --url=https://...       # override target
 *     node scripts/load-test.js --quick                 # skip balance check
 *     node scripts/load-test.js --burst=60              # change burst size
 *
 * Steps:
 *   1. Balance check    — every channel pubkey is funded on Horizon
 *   2. Smoke test       — 1 sequential call to /api/x402/evaluate, sanity-check shape
 *   3. Warm burst       — 10 concurrent (loosens cold start)
 *   4. Target burst     — 40 concurrent (the original failure mode)
 *   5. Stress burst     — 60 concurrent (≈ theoretical ceiling)
 *
 * Pass criteria:
 *   - 100 % HTTP 200
 *   - 0   anchor errors
 *   - channels_total === 20 on every response
 *   - ≥ 15 distinct channels seen across 40-concurrent burst
 *   - attempts ≤ 2 on > 95 % of requests
 */

// The website's "Run x402 Evaluation" button calls /api/evaluate (the
// unpaid demo-anchor endpoint). The x402 endpoint just returns 402 metadata.
// We target /api/evaluate to match what users actually hit.
const ENDPOINT_DEFAULT = 'https://www.erster.fund/api/evaluate';
const HORIZON = 'https://horizon-testnet.stellar.org';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const ENDPOINT = args.url || ENDPOINT_DEFAULT;
const QUICK = !!args.quick;
const BURST = Number(args.burst || 0);

const PUBKEYS = (
  'GCZPCSWDHQ7A5V4XIFQMTQBFP6JJHFX6JJM5WIIIFDJUCGYVU6D4CNGK,GCPRYZHBVEL3TJCKDQ7GHX5YJTYKA33GD5CUZQJ7L4JYOI44BCLZHJTE,GDHNQ7HGVLA6OLXHLXYEYPZVCCC4SUUBUVX5DGDEUARDJB3YEK5LLFVA,GC64A6POIXYCZJN347ITQXJZLBNMZAFHJGMLAHHRYOOCXAOUBQYUSUIM,GD25DXLMAFKTQWIZC3FIURZAAXJTXBQQBSZAJHHFOEGDN4CJHPX2BE2R,GBPVATYC23I55MXRMOON3FVNL2COYRVUK6SOB7FVEKWDQ2QPZHDVNU4X,GBLKIJATS6S3MFK3CLJZ3FVYS74TGU7YFEPW3RNVDVPWPRUZF5UPYT35,GAJE3RN4JL6G3UBFUE2DQKNIWDHI2G5B4ALM2LJFDEGY6QM6XTMEBQVK,GC74OUJBMASD7GTE5IVUKZAROTRRPNMTF5EHHXKS5ZBEGDEYT6YP56R2,GB3GA2OOLFONFTRODA26IEFNCTXTXGTYOESJBHZQGXOZZBNMTV6A7DQK,GCFNTJ24XEIHRH7OG5DQONS7PMEPJICKFJQSB6IHFMU2A4TGLJ2HLOHV,GCMCPYMXNUSYGH3XEADIF2A4JEX4RLG2RMG7DMB2VBJLETVEHVVT72XJ,GA7JLUZQWSSY4QFWYMM2DWALOJGYLX6VJD53YG2NXL6Q4QGDCWMUO4TN,GC7IVUEU5RE2YPXBF7R2Z6LCVDA2Q7W6HXQHTQZFMSVJJU3FTIIZGPPT,GCSQ3L354HRFCIMZMBGPPFNIW4NKSSXF4ZL7UWVX3QHQBKESBVEBYGZA,GC7TYYCRYJIO3S7IEK4UDIZKDYBPANEXAPF3CWHQGZH42ZXW6AORSERQ,GAHE6POEYOMSFP2XNYROYPEBORPPPBXKQWHGDQKXQRZC5ZEX7AJJD3EO,GCK5KYQO6H7GEYXXI72PRLNYHD3QZHWIPYFZ4BYW67ESFCS7WZMM3VNO,GB6X4LDWYWX24ACYSJ5S6AXJXRXTD2WOMNKQRKWOR2CASRMKOMFNR4BD,GDQENYFECOPXSNA7VA3PPUQTP4TMGFCCVE4ATXZZV3Q6DJRSHN7SNWHV'
).split(',');

const log = (...a) => console.log(...a);
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

let pass = 0;
let fail = 0;
const failures = [];
function assert(cond, label) {
  if (cond) {
    pass++;
    log(`  ${green('✓')} ${label}`);
  } else {
    fail++;
    failures.push(label);
    log(`  ${red('✗')} ${label}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Step 1 — Balance check
// ─────────────────────────────────────────────────────────────────
async function step1Balances() {
  log(bold('\n[1] Balance check — all 20 channel accounts'));
  if (QUICK) return log(dim('   (skipped via --quick)'));

  const results = await Promise.all(
    PUBKEYS.map(async (pub, i) => {
      try {
        const r = await fetch(`${HORIZON}/accounts/${pub}`);
        if (!r.ok) return { i, pub, ok: false, status: r.status };
        const j = await r.json();
        const native = j.balances.find((b) => b.asset_type === 'native');
        const xlm = parseFloat(native?.balance || '0');
        return { i, pub, ok: true, xlm, seq: j.sequence };
      } catch (e) {
        return { i, pub, ok: false, err: e.message };
      }
    })
  );

  let totalXlm = 0;
  let funded = 0;
  results.forEach((r) => {
    const idx = String(r.i + 1).padStart(2);
    const short = `${r.pub.slice(0, 8)}…${r.pub.slice(-6)}`;
    if (!r.ok) {
      log(`  ${red('✗')} ${idx}/20 ${short}  NOT FUNDED${r.status ? ` (${r.status})` : ''}`);
    } else {
      funded++;
      totalXlm += r.xlm;
      log(`  ${green('✓')} ${idx}/20 ${short}  ${r.xlm.toFixed(2).padStart(9)} XLM   seq=${r.seq}`);
    }
  });
  log(dim(`  total funded: ${funded}/20 · total balance: ${totalXlm.toFixed(2)} XLM`));
  assert(funded === 20, `all 20 channels funded`);
  assert(totalXlm > 19_000, `aggregate balance > 19 000 XLM (= huge runway)`);
}

// ─────────────────────────────────────────────────────────────────
// Step 2 — Single smoke call
// ─────────────────────────────────────────────────────────────────
async function callOnce(label, i) {
  const t0 = Date.now();
  try {
    // Mirror exactly what the website button sends — POST /api/evaluate with
    // the demo payload. This is the call that actually triggers anchorEvaluation()
    // and exercises the channel-account selection + retry path.
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: `agt_${label}_${i}`,
        score: 820,
        operation: 'transfer',
        validatorIds: ['val-erster-01', 'val-tokenforge-02', 'val-test-03'],
      }),
    });
    const ms = Date.now() - t0;
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { __unparseable: text.slice(0, 200) };
    }
    return { http: r.status, ms, body };
  } catch (e) {
    return { http: 0, ms: Date.now() - t0, body: { __err: e.message } };
  }
}

async function step2Smoke() {
  log(bold('\n[2] Smoke test — 1 sequential call'));
  log(dim(`   POST ${ENDPOINT}`));
  const r = await callOnce('smoke', 0);
  log(dim(`   HTTP ${r.http}  ·  ${r.ms} ms`));
  const a = r.body?.anchor;
  if (a) {
    log(dim(`   anchor.txid = ${a.txid || '—'}`));
    log(dim(`   anchor.channels_total = ${a.channels_total}`));
    log(dim(`   anchor.channel_used   = ${a.channel_used}`));
    log(dim(`   anchor.attempts       = ${a.attempts}`));
  } else {
    log(dim(`   body: ${JSON.stringify(r.body).slice(0, 400)}`));
  }
  assert(r.http === 200, 'HTTP 200 OK');
  assert(!!r.body?.success, 'success: true');
  assert(!!r.body?.anchor?.txid, 'anchor TX produced');
  assert(r.body?.anchor?.channels_total === 20, 'channels_total === 20  (env var loaded)');
  assert((r.body?.anchor?.attempts || 99) <= 2, 'attempts ≤ 2');
}

// ─────────────────────────────────────────────────────────────────
// Step 3/4/5 — bursts
// ─────────────────────────────────────────────────────────────────
async function burst(label, n) {
  log(bold(`\n[${label}] Burst of ${n} concurrent requests`));
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: n }, (_, i) => callOnce(label, i)));
  const totalMs = Date.now() - t0;

  let ok = 0;
  let anchored = 0;
  let anchorErr = 0;
  const channels = new Set();
  const attemptBuckets = { 1: 0, 2: 0, 3: 0, 4: 0, '5+': 0 };
  let badChannelsTotal = 0;
  const errors = {};
  let httpErrors = 0;

  for (const r of results) {
    if (r.http === 200) ok++;
    else {
      httpErrors++;
      const k = `HTTP_${r.http}`;
      errors[k] = (errors[k] || 0) + 1;
    }
    const a = r.body?.anchor;
    if (a?.txid) {
      anchored++;
      channels.add(a.channel_used);
      const att = a.attempts || 1;
      if (att >= 5) attemptBuckets['5+']++;
      else attemptBuckets[att]++;
      if (a.channels_total !== 20) badChannelsTotal++;
    } else if (r.body?.anchor?.error || r.body?.error) {
      anchorErr++;
      const k = (r.body.anchor?.error || r.body.error || 'unknown').slice(0, 60);
      errors[k] = (errors[k] || 0) + 1;
    }
  }

  log(dim(`   wall time:      ${totalMs} ms  (≈ ${((totalMs / n) | 0)} ms/req avg)`));
  log(dim(`   HTTP 200:       ${ok}/${n}`));
  log(dim(`   anchored:       ${anchored}/${n}`));
  log(dim(`   distinct chans: ${channels.size}/20`));
  log(dim(`   attempts dist:  1×${attemptBuckets[1]}  2×${attemptBuckets[2]}  3×${attemptBuckets[3]}  4×${attemptBuckets[4]}  5+×${attemptBuckets['5+']}`));
  if (Object.keys(errors).length) {
    log(yellow(`   errors:`));
    for (const [k, v] of Object.entries(errors)) log(yellow(`     ${k}  × ${v}`));
  }

  assert(httpErrors === 0, `0 HTTP errors (got ${httpErrors})`);
  assert(anchored === n, `100 % anchored (${anchored}/${n})`);
  assert(badChannelsTotal === 0, `every response shows channels_total=20`);
  if (n >= 20) assert(channels.size >= Math.min(15, n - 5), `≥ ${Math.min(15, n - 5)} distinct channels used`);
  const slow = attemptBuckets[3] + attemptBuckets[4] + attemptBuckets['5+'];
  assert(slow / n < 0.05, `> 95 % requests succeeded in ≤ 2 attempts (slow=${slow}/${n})`);
}

// ─────────────────────────────────────────────────────────────────
(async () => {
  log(bold('Verun Stellar — channel-accounts integrity + load test'));
  log(dim(`endpoint: ${ENDPOINT}`));
  log(dim(`horizon:  ${HORIZON}`));

  await step1Balances();
  await step2Smoke();
  if (BURST) {
    await burst('B', BURST);
  } else {
    await burst('3', 10);
    await burst('4', 40);
    await burst('5', 60);
  }

  log(bold(`\nResult: ${green(pass + ' pass')}  ·  ${fail === 0 ? green('0 fail') : red(fail + ' fail')}`));
  if (failures.length) {
    log(red('\nFailed checks:'));
    failures.forEach((f) => log(red(`  - ${f}`)));
    process.exit(1);
  }
  log(green('\n✅ All hardcore tests passed — endpoint is bulletproof for marketing launch.\n'));
})().catch((e) => {
  console.error(red(`\nFatal: ${e.message}`));
  process.exit(2);
});
