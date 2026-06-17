/**
 * On-chain anchor for a Verun verdict on Stellar.
 * Strategy: native-asset self-payment whose memo is sha256(verdictPayload).
 * Produces a real Stellar Testnet TX with explorer link — an immutable,
 * timestamped audit anchor for every evaluation.
 *
 * High-throughput design:
 *   - Anchor txs spread across N channel accounts (STELLAR_CHANNELS env)
 *     → ~30-100 concurrent anchors without `tx_bad_seq` collisions.
 *   - Per-submission retry-on-conflict with exponential backoff
 *     → handles residual same-channel collisions safely.
 *   - Falls back to single STELLAR_SECRET account if no channels configured.
 *
 * The self-payment amount defaults to market-rate XLM equivalent of $0.005 USD,
 * so the on-chain TX visibly reflects the evaluation price.
 * Override via the `amount` option or the `X402_PRICE_XLM` env var.
 */
require('dotenv').config();
const crypto = require('crypto');
const {
  StellarSdk,
  NETWORK_PASSPHRASE,
  getServer,
  ensureFunded,
  explorerTx,
} = require('./stellar');
const { pickChannel, getChannelCount } = require('./channels');

const { convertUSDtoNative } = require('./priceOracle');
const PRICE_USD = Number(process.env.X402_PRICE_USD || '0.005');
const PRICE_XLM_FIXED = process.env.X402_PRICE_XLM ? Number(process.env.X402_PRICE_XLM) : null;

// Retry config — handles residual sequence collisions when same channel
// gets picked twice within ledger close time (~5s on Stellar).
const MAX_RETRIES = Number(process.env.STELLAR_ANCHOR_MAX_RETRIES || 4);
const RETRY_BACKOFF_MS = Number(process.env.STELLAR_ANCHOR_BACKOFF_MS || 250);

// Async submit: don't wait for ledger close (~5s). Returns hash immediately
// and the tx settles in the background. Reduces endpoint latency from ~5s → ~300ms,
// which lifts Vercel function concurrent capacity from ~25 → 200+ requests/burst.
// Set STELLAR_ANCHOR_SYNC=1 to fall back to legacy waiting submit.
const USE_ASYNC_SUBMIT = process.env.STELLAR_ANCHOR_SYNC !== '1';

async function resolveAnchorAmount(opts) {
  if (opts.amount != null) return String(opts.amount);
  if (PRICE_XLM_FIXED != null && Number.isFinite(PRICE_XLM_FIXED)) return String(PRICE_XLM_FIXED);
  const xlm = await convertUSDtoNative(PRICE_USD, 'XLM');
  return parseFloat(xlm.toFixed(7)).toString();
}

function isSequenceError(err) {
  const codes = err?.response?.data?.extras?.result_codes;
  if (!codes) return false;
  return (
    codes.transaction === 'tx_bad_seq' ||
    (Array.isArray(codes.operations) && codes.operations.includes('op_bad_seq'))
  );
}

function isRetryableError(err) {
  if (isSequenceError(err)) return true;
  const status = err?.response?.status;
  // 429 (rate limited), 503/504 (server overload) — retry
  if (status === 429 || status === 503 || status === 504) return true;
  return false;
}

async function submitWithRetry({ payload, opts }) {
  const server = getServer();
  const amount = await resolveAnchorAmount(opts);
  const json = JSON.stringify(payload);
  const digest = crypto.createHash('sha256').update(json).digest();

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Pick a (potentially different) channel on each attempt to dodge collisions
    const kp = pickChannel();
    const pub = kp.publicKey();

    try {
      // Auto-fund first time we use a channel (idempotent)
      if (attempt === 0) await ensureFunded(pub).catch(() => {});

      const account = await server.loadAccount(pub);

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

      // ── Async fast-path: submit + return hash without waiting for ledger close.
      //   Stellar SDK 12+ exposes server.submitAsyncTransaction → /transactions_async on
      //   Horizon. It returns immediately once the tx is queued for inclusion (~150ms),
      //   instead of blocking 5s until the next ledger close. The tx still anchors
      //   on-chain — we just don't wait around in the HTTP handler for the receipt.
      let result;
      if (USE_ASYNC_SUBMIT && typeof server.submitAsyncTransaction === 'function') {
        const submitRes = await server.submitAsyncTransaction(tx);
        // submitAsyncTransaction returns { hash, tx_status, ... } once accepted by Horizon.
        // tx_status "PENDING" / "DUPLICATE" → considered successfully queued. Anything
        // else (ERROR) is treated as a failed submit so the retry loop can recover.
        const status = submitRes?.tx_status || submitRes?.txStatus || 'PENDING';
        if (status === 'ERROR' || status === 'TRY_AGAIN_LATER') {
          // Synthesize an error-shape so the retry/error path handles it like a sync submit.
          const err = new Error(`async_submit_${status.toLowerCase()}`);
          err.response = { status: 400, data: { extras: { result_codes: submitRes?.errorResult || {} } } };
          throw err;
        }
        result = {
          hash: submitRes.hash || tx.hash().toString('hex'),
          ledger: null, // unknown until ledger closes
          _async: true,
          _submitStatus: status,
        };
      } else {
        // Legacy sync path (forced via STELLAR_ANCHOR_SYNC=1 or SDK without async).
        result = await server.submitTransaction(tx);
      }

      return {
        result,
        amount,
        digest,
        json,
        channel_used: pub,
        attempts: attempt + 1,
      };
    } catch (e) {
      lastError = e;
      if (attempt >= MAX_RETRIES || !isRetryableError(e)) throw e;
      // Exponential backoff with jitter
      const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastError;
}

async function anchorEvaluation(payload, opts = {}) {
  const { result, amount, digest, json, channel_used, attempts } = await submitWithRetry({
    payload,
    opts,
  });

  return {
    txid: result.hash,
    ledger: String(result.ledger ?? ''),
    network: 'stellar-testnet',
    amount,
    asset: 'XLM',
    channel_used,
    channels_total: getChannelCount(),
    attempts,
    memo_hash: digest.toString('hex'),
    payload_hash: digest.toString('hex'),
    payload_size: json.length,
    explorer: explorerTx(result.hash),
    horizon: `${process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'}/transactions/${result.hash}`,
  };
}

module.exports = { anchorEvaluation };
