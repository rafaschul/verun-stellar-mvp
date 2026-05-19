# Deploy `verun-stellar-mvp` to Vercel

Total time: ~5 minutes. You'll end with a public URL where every endpoint returns green ticks.

---

## 1. Create a Stellar testnet keypair

In this repo's folder, run:

```bash
npm install
npm run genkey
```

You'll see something like:

```
 STELLAR_PUBLIC = GAH3THY4RSJUDZXZ5E22NKFXSB7US7JXQUKBMNZTNOJSBBMEE5RWG2N2
 STELLAR_SECRET = SAABIPYQ52JARPMVUY4LKIJKM42RNQCQGNS3CXKRTJOUS6EFNR2WMX2H
 Funded ✓
```

**Save both values.** The `STELLAR_SECRET` cannot be recovered — Friendbot already deposited 10,000 testnet XLM into the account.

> Skip this step if you already have a funded testnet account; you can paste the existing keys directly into Vercel.

---

## 2. Verify locally (optional but recommended)

```bash
# put the keys you just generated into a local .env
cp .env.example .env
# then edit .env and paste STELLAR_SECRET / STELLAR_PUBLIC

npm run check       # → balance ~10000 XLM
npm run selftx      # → posts a real TX, prints stellar.expert URL
npm run api         # → http://localhost:3010
./scripts/smoke-live.sh http://localhost:3010
```

If `selftx` prints an `explorer:` URL that opens to a confirmed transaction on stellar.expert, the wiring is good.

---

## 3. Push to a new GitHub repo

```bash
cd verun-stellar-mvp
git init
git add .
git commit -m "verun-stellar-mvp: initial commit"
gh repo create verun-stellar-mvp --public --source=. --push
# (or create the repo in the GitHub UI and `git remote add origin ... && git push -u origin main`)
```

---

## 4. Import to Vercel

1. Open <https://vercel.com/new>
2. Pick the `verun-stellar-mvp` repo
3. Framework preset: **Other** (Vercel auto-detects the `api/` folder as serverless functions)
4. Root directory: leave default
5. Build & Output settings: leave default — there is no build step

Click **Deploy**. The first deploy will succeed but `/api/evaluate` will fail with `STELLAR_SECRET env var missing` until you add env vars.

---

## 5. Add the environment variables

In your Vercel project: **Settings → Environment Variables**.

| Name | Value | Environments |
|------|-------|--------------|
| `STELLAR_SECRET` | the `S...` from step 1 | Production · Preview · Development |
| `STELLAR_PUBLIC` | the `G...` from step 1 | Production · Preview · Development |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Production · Preview · Development |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Production · Preview · Development |
| `FRIENDBOT_URL` | `https://friendbot.stellar.org` | Production · Preview · Development |

After adding them, hit **Deployments → ⋯ → Redeploy** on the latest deployment.

---

## 6. Run the green-tick check

Replace `YOUR_VERCEL_URL` with the live URL Vercel gave you (e.g. `https://verun-stellar-mvp-xxxx.vercel.app`):

```bash
./scripts/smoke-live.sh https://YOUR_VERCEL_URL
```

You should see all five checks pass:

```
[1/5] health ............ true
[2/5] validators ........ 3
[3/5] funding status .... 9999.99... (XLM)
[4/5] config check ...... true / true / true
[5/5] evaluate .......... true / LOW / true / <txid> / <stellar.expert URL>
```

Open the printed `stellar.expert` URL in a browser — you should see a confirmed Memo Transaction with a 32-byte hash memo. That is your on-chain proof.

---

## 7. Manual checks via curl

```bash
BASE=https://YOUR_VERCEL_URL

curl -s $BASE/api/health
curl -s $BASE/api/validators | jq
curl -s $BASE/api/config-check | jq .checks
curl -s $BASE/api/funding-status | jq

curl -s -X POST $BASE/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"agt_demo","score":820,"operation":"transfer"}' | jq
```

The last call returns a `verdict.consensus` (`LOW`/`MED`/`HIGH`/`BLOCK`), `verdict.permitted` (boolean), and `anchor.txid` + `anchor.explorer` — that's the live testnet TX.

---

## Common issues

**`STELLAR_SECRET env var missing`** — env var didn't propagate. Redeploy after adding it; cold-start serverless functions only pick up new envs on rebuild.

**`Friendbot 400`** — the account was already funded by a previous run. Safe to ignore; `funding-status` will still return the real balance.

**`tx_bad_seq`** — two requests submitted at the exact same instant. Retry once; Stellar increments sequence numbers strictly.

**`memo too long`** — won't happen with this code (we always hash to 32 bytes), but if you switched to `Memo.text` keep payloads ≤ 28 bytes.

---

## What next

- Replace the placeholder favicon and logo if you want a Stellar-themed Trustmark.
- Lock the validator set to your real partners by editing `src/validators.json`.
- For mainnet, change `HORIZON_URL` to `https://horizon.stellar.org` and `NETWORK_PASSPHRASE` to `Public Global Stellar Network ; September 2015`, then fund the account from a real wallet (no Friendbot on mainnet).
- For SBT/credential issuance, look at `Operation.changeTrust` + `Operation.setOptions(authRequired, authRevocable)` to issue a non-transferable asset.
