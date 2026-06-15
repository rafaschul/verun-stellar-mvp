/**
 * Verun · x402 Payment Layer (Stellar, "exact" scheme)
 * ──────────────────────────────────────────────────────────────────────────
 * Implements the x402 spec for Stellar using two payment schemes accepted
 * side-by-side via the Stellar x402 Facilitator:
 *
 *   1. USDC (Circle issued asset on Stellar)
 *   2. XLM  (native Lumens)
 *
 * Flow:
 *   1. Client GET  /api/x402/evaluate              → 402 + paymentRequirements
 *   2. Client signs a Stellar Payment operation
 *      (USDC asset payment or native XLM payment to protocol payTo)
 *   3. Client POST /api/x402/evaluate + X-PAYMENT header (base64 signed XDR)
 *   4. Server forwards X-PAYMENT to facilitator /verify
 *   5. On success → facilitator /settle (submits on-chain)
 *   6. Server runs Verun 2-of-3 validator consensus
 *   7. Server anchors verdict via Stellar payment-memo (audit trail)
 *   8. Returns 200 + { verdict, anchor, settlement }
 *
 * Honest scope note:
 *   - Schemes returned in 402 are spec-compliant (x402Version: 1, scheme: exact, CAIP-2 IDs)
 *   - facilitator /verify + /settle endpoints are wired and configurable
 *     via X402_FACILITATOR_URL.
 *   - Real on-chain settlement requires the facilitator URL to be live;
 *     until then `simulate` mode returns synthesized success for the demo.
 */

// ── CAIP-2 network IDs (Stellar) ─────────────────────────────
// Per CAIP-2 registry: stellar:pubnet, stellar:testnet
const STELLAR_PUBNET_CAIP2  = 'stellar:pubnet';
const STELLAR_TESTNET_CAIP2 = 'stellar:testnet';

// ── USDC on Stellar (Circle issued asset) ────────────────────
// Circle USDC issuer addresses on Stellar.
// Asset code "USDC" + issuer pubkey uniquely identifies the asset.
const USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH37Y5VPTC';
const USDC_MAINNET_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_DECIMALS = 7; // Stellar uses 7 decimals for all assets (stroop = 10^-7)

// ── XLM (native) ─────────────────────────────────────────────
// XLM also uses 7 decimals at the protocol level (stroop = 10^-7 XLM)
const XLM_DECIMALS = 7;

// ── Stellar x402 Facilitator ─────────────────────────────────
// Placeholder URL — replace once a Stellar x402 facilitator is published.
// Override via env: X402_FACILITATOR_URL=https://...
const STELLAR_X402_FACILITATOR_DEFAULT = 'https://x402.stellar.org';

// ── Resolved config (env-overridable) ────────────────────────
const { convertUSDtoNative } = require('./priceOracle');

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || STELLAR_X402_FACILITATOR_DEFAULT;
// USD-target evaluation price. XLM amount is derived from this at the current
// market rate (oracle). USDC amount is 1:1 with USD. Override via env if needed.
const PRICE_USD       = Number(process.env.X402_PRICE_USD || '0.005');   // $0.005 target
const PRICE_USDC      = Number(process.env.X402_PRICE_USDC || PRICE_USD); // 1:1 with USD
// PRICE_XLM direct override is still supported (forces a fixed XLM amount)
const PRICE_XLM_FIXED = process.env.X402_PRICE_XLM ? Number(process.env.X402_PRICE_XLM) : null;
const NETWORK_KIND    = (process.env.X402_NETWORK || 'testnet').toLowerCase();
const NETWORK_CAIP2   = NETWORK_KIND === 'mainnet' ? STELLAR_PUBNET_CAIP2 : STELLAR_TESTNET_CAIP2;
const USDC_ISSUER     = NETWORK_KIND === 'mainnet' ? USDC_MAINNET_ISSUER : USDC_TESTNET_ISSUER;
const USDC_ASSET_ID   = `USDC:${USDC_ISSUER}`; // canonical Stellar asset reference

// Simulate facilitator if URL is the placeholder (so the live terminal demo
// still produces a clean transcript even before a real facilitator is published).
const SIMULATE = !process.env.X402_FACILITATOR_URL && FACILITATOR_URL === STELLAR_X402_FACILITATOR_DEFAULT;

function getPayToAddress() {
  // Stellar signer's public key doubles as the protocol payTo address by default.
  return (
    process.env.STELLAR_PAY_TO ||
    process.env.STELLAR_PUBLIC ||
    null
  );
}

/**
 * Build x402 paymentRequirements payload (returned with HTTP 402).
 * Spec: https://docs.x402.org
 *
 * Now async because XLM amount is derived from the current market price
 * (USD-pegged target). Pass `amountXLM` to bypass the oracle.
 */
async function buildPaymentRequirements({
  resource,
  description,
  amountUSDC = PRICE_USDC,
  amountXLM,  // if omitted → derived from market rate
} = {}) {
  // Resolve XLM amount: explicit override > env fixed > market-rate conversion
  if (amountXLM == null) {
    if (PRICE_XLM_FIXED != null && Number.isFinite(PRICE_XLM_FIXED)) {
      amountXLM = PRICE_XLM_FIXED;
    } else {
      amountXLM = await convertUSDtoNative(PRICE_USD, 'XLM');
    }
  }
  const payTo = getPayToAddress();
  if (!payTo) throw new Error('STELLAR_PUBLIC / STELLAR_PAY_TO not configured');

  // Convert decimal amounts → smallest unit per asset (Stellar: 7 decimals).
  const usdcStroops = Math.round(amountUSDC * Math.pow(10, USDC_DECIMALS)).toString();
  const xlmStroops  = Math.round(amountXLM  * Math.pow(10, XLM_DECIMALS)).toString();

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK_CAIP2,
        asset: USDC_ASSET_ID,
        payTo,
        maxAmountRequired: usdcStroops,
        maxTimeoutSeconds: 300,
        resource: resource || '/api/x402/evaluate',
        description: description || `Verun Trust Evaluation · ${amountUSDC} USDC · Stellar`,
        mimeType: 'application/json',
        extra: {
          name: 'USDC',
          decimals: USDC_DECIMALS,
          assetCode: 'USDC',
          issuer: USDC_ISSUER,
          network: NETWORK_KIND,
          facilitator: FACILITATOR_URL,
          provider: 'Stellar x402 Facilitator',
        },
      },
      {
        scheme: 'exact',
        network: NETWORK_CAIP2,
        asset: 'XLM',
        payTo,
        maxAmountRequired: xlmStroops,
        maxTimeoutSeconds: 300,
        resource: resource || '/api/x402/evaluate',
        description: description || `Verun Trust Evaluation · ${amountXLM} XLM · Stellar`,
        mimeType: 'application/json',
        extra: {
          name: 'XLM',
          decimals: XLM_DECIMALS,
          assetCode: 'native',
          network: NETWORK_KIND,
          facilitator: FACILITATOR_URL,
          provider: 'Stellar x402 Facilitator',
        },
      },
    ],
  };
}

/**
 * Decode the X-PAYMENT header — base64-encoded JSON with the signed
 * Stellar transaction XDR bytes + scheme metadata.
 */
function decodePaymentHeader(xPaymentHeader) {
  if (!xPaymentHeader) return null;
  try {
    const decoded = Buffer.from(xPaymentHeader, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (e) {
    return { error: 'invalid_x_payment_encoding', detail: e.message };
  }
}

/**
 * POST {facilitator}/verify — verify the signed payment without submitting.
 */
async function facilitatorVerify({ xPaymentHeader, paymentRequirements }) {
  if (SIMULATE) {
    return {
      simulated: true,
      ok: true,
      reason: 'facilitator_url_not_set — simulated verify pass',
    };
  }
  const r = await fetch(`${FACILITATOR_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 1,
      paymentPayload: xPaymentHeader,
      paymentRequirements,
    }),
  });
  const body = await r.json().catch(() => ({ raw: r.statusText }));
  return { httpStatus: r.status, ...body };
}

/**
 * POST {facilitator}/settle — submit the verified payment to Stellar.
 */
async function facilitatorSettle({ xPaymentHeader, paymentRequirements }) {
  if (SIMULATE) {
    // Generate a plausible-looking testnet txid for the simulated path so the
    // demo terminal renders something realistic.
    // Stellar tx hashes are 64-char hex.
    const fakeTxid = Array.from({ length: 64 }, () =>
      '0123456789abcdef'[Math.floor(Math.random() * 16)]
    ).join('');
    return {
      simulated: true,
      ok: true,
      txid: fakeTxid,
      explorer: `https://stellar.expert/explorer/testnet/tx/${fakeTxid}`,
      reason: 'facilitator_url_not_set — simulated settlement (replace X402_FACILITATOR_URL with real Stellar facilitator)',
    };
  }
  const r = await fetch(`${FACILITATOR_URL}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 1,
      paymentPayload: xPaymentHeader,
      paymentRequirements,
    }),
  });
  const body = await r.json().catch(() => ({ raw: r.statusText }));
  return { httpStatus: r.status, ...body };
}

module.exports = {
  // Constants
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  USDC_TESTNET_ISSUER,
  USDC_MAINNET_ISSUER,
  USDC_DECIMALS,
  XLM_DECIMALS,
  STELLAR_X402_FACILITATOR_DEFAULT,
  FACILITATOR_URL,
  PRICE_USD,
  PRICE_USDC,
  PRICE_XLM_FIXED,
  NETWORK_CAIP2,
  USDC_ISSUER,
  USDC_ASSET_ID,
  NETWORK_KIND,
  SIMULATE,

  // Helpers
  getPayToAddress,
  buildPaymentRequirements,
  decodePaymentHeader,
  facilitatorVerify,
  facilitatorSettle,
};
