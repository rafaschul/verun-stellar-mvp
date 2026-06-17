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

// 40 channel public keys (matching the 40 channels currently deployed)
const PUBKEYS = (
  'GAZ5TUUNIZ4QWQM2YZ4WLFCCNQHZBF2C4UGY7DCWWPWAGLFJE7YAPB5V,GAMLQVJ2SOZKHFWE2MQGF62A56HJJDJ6QMQVESOCYQFOOS6GE665I5NV,GC7JF5JEQQD3CA352BIXRR23A6COIAIDMT3AAATV32BMW4U6ZBGNLLAM,GAIWH3VULLU7LVPRN2WYFR3STRUTBTYFPKRVFTCYNGRF6765REZOII2V,GCSVG3FTHMXFOI3KZH5G3JOVG2HRIO4TAMEEHTQ2NSRENOOIH2YQW5XJ,GCAOEFHEMUTB7CJB7KMN2BPK5H2WJZQNMWPWSURTNNLP33GLOVOP62WS,GBXVVKVYTLKAAQJJJ3OW3OLCL3H6AKNN7LL2LD3VFHP2GIETVFVK7N5C,GA54EVAQA3A3STB4UXO6XQACW7KZDFX57OII7YAPCG3NLFLAT55SYYRC,GBPPV7JG2MGQG65PFBHICFURYQPEBV5ROF5VB42AN2EGDUBC5T4SOMNC,GACZOBELX2RUUKX2UY5PQQ2P4SL5V7BWFF7VN3WMOGNLPBOEWEC3JVS4,GC6A2PYYL6RLIFK5IBPZLOZMMPGDURR4UEF2J3HZPVB3JNOC3C7BL6NX,GBJ7XE7FCBUDFWELDZY7XLJKHBVS37D6SSCPKW5KMCV3W5F72UM2YOFO,GCIXAYQHAPK3WTNZ4ISWZO3WLWTYPRBIJFJDLKQCYQD3KSBMRBCVL7S7,GBAKCTLL5ANLCAMUTDZZOFNPHBIICAN3HT2UQDFO7PVDSNZBROMDLRBR,GAIV2HXN6T6WMR2QLFHTF4VEHNF5A3ADFKWMAOOXLZRWVCF6C6FSCTBT,GBWHBJDMOGKAOVOTKJD4UPFZZM7DENYLHJYAYADKWEJQFVE4WZJ5KT4C,GABP4Z2WVLBTC6EOTXZH7MUK4NEK35TPSAMKRIQ2LHPB2DCEV4J2E4EH,GBSKPZ3RHMD4JGQ7K2IVYLGNO7BO5PO6H73VTALXOKQ2IACD3ABJEFTH,GAOZIWIG3CZT4FMU5NXQEECWVHF7QUUMCGEM2OSLM7XTME3CKAF53GYJ,GDM5PJ35HOCTVX6PJZ4E543BSO7BZZRW3IUOYZYUDK5JDGSEAMRTML4E,GAZK3SMJNDOHVCAQYZWZJL2IDLGL3FKITAA4NSDHMBPLNE4Y7JZACYG5,GCIFMENK3NI4GCWJUMDWIXX5MPYKFYLOZTB2NTKX7SO76U4JVBICDPNF,GCV2U6KNF6MFYUMTFMXC3OEE7BWN6AKXIOOCTGIKAHENIDCBPAL5YQBJ,GCOREV44VYXM7ZYRB7HRDGRNVFS25R4WD7WS5KA3C2XZQV2MWXFBJXSV,GAUEL62XWIF7OOMN2MR4M4CRS7K63RZNHFLCMELPSPOHSHA4Q6C5HBE6,GCNLZQ2PEOUYYTF4KIMQZJ4GKJXN6OLSXNRWJAPWFPRS3PENQVW4AUMD,GALTO3HDDJEHMIDZ33C7OPB7FWQLHXF3AQFYPY3WF4I4LDI2XG23FQDE,GCRKM2DRAPE5T23VOZCVNJBF2RLVNGVDVESSFSDLPCEFCWD5NDHPAS3R,GABVAQZ3GX776KJLF67YL6IYPLP3Z3JZSW2PVKPLMP3NRALD2LQEWRVB,GAYNPDHVYO2OHSKJPM6INIBJIS4GQGR4PQABPLF5XB5WSQC6SEAFZKJY,GADWMIXTJM7GTU4DJUEVGKJRNNTU7RX6DEMVS2DOBOXWLBG5ZULV7TD3,GBAR2NJ45HTMVAHDB6SB54LG4VZ32KOIALCTC2NTBKL4KZUSP2TCYQZD,GD7KAXDYYMDU4IALTQ2STZLCIU5EA4YEHE4AT3RGS3H6XS6KELGBRXHS,GAASXBJQJSULZY5APYTHNVT2GLBNPSCMOXLEUEWMXCHUJVEDQPZCOVC2,GDGD5GI43HZWMT7A7DRJ2ATFAW2SXWLVAZRBWLIRS6GCVA2QRBZRMF33,GD54DR573GW2KQABQDA5GB4FFHALPZQZ26FTRKGTSTVZGFXAOA3H37M7,GBHRDIHZTWAORIQYG7R5BAWWOQHOOZUQS5NZC6VACQO4YDIXZL4GR75U,GAO5APMZEXERC2ADZUFOBVOM36TKXZEO3XMABDKLA5M2YTJMK5WOTAPD,GBM6T22MQHWPBYRKU2GEORB34JSTFHO6GWONEXTX4PGO4BH2I7ZI6HAM,GAVIOB7W4LR4A7QJHIP6WAMG3ZOYNHAKAIALOBXJXEJW4Z6CRQCCAOGC'
).split(',');
const EXPECTED_CHANNELS = PUBKEYS.length; // 40

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
  assert(funded === EXPECTED_CHANNELS, `all ${EXPECTED_CHANNELS} channels funded`);
  assert(totalXlm > EXPECTED_CHANNELS * 950, `aggregate balance > ${EXPECTED_CHANNELS * 950} XLM (= huge runway)`);
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
  assert(r.body?.anchor?.channels_total === EXPECTED_CHANNELS, `channels_total === ${EXPECTED_CHANNELS}  (env var loaded)`);
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
      if (a.channels_total !== EXPECTED_CHANNELS) badChannelsTotal++;
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
  assert(badChannelsTotal === 0, `every response shows channels_total=${EXPECTED_CHANNELS}`);
  const minDistinct = Math.min(Math.floor(EXPECTED_CHANNELS * 0.75), n - 5);
  if (n >= EXPECTED_CHANNELS) assert(channels.size >= minDistinct, `≥ ${minDistinct} distinct channels used`);
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
