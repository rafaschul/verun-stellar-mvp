# Verun Stellar MVP

The Trust Layer for Agentic Finance — anchored on **Stellar Testnet**.

A 2-of-3 validator consensus protocol that scores AI agents and writes every verdict to Stellar as a Memo Transaction (sha256 of the verdict payload, anchored via a 1-stroop self-payment).

Built natively on Stellar to leverage its fast finality (~5s), low fees (~100 stroops), Memo-based audit anchors, and `manageData` primitives for non-transferable Soulbound credentials.

## Quick start (local)

```bash
npm install
cp .env.example .env

# 1. Generate a fresh keypair and fund it via Friendbot
npm run genkey
# Copy the printed STELLAR_PUBLIC + STELLAR_SECRET into your .env

# 2. Sanity check
npm run check    # prints address + XLM balance
npm run selftx   # submits a real testnet TX, prints explorer URL

# 3. Run the API
npm run api      # http://localhost:3010
```

Smoke test the live endpoints:

```bash
chmod +x scripts/smoke-live.sh
./scripts/smoke-live.sh http://localhost:3010
# All five checks should print green-tickable values.
```

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health`          | Service heartbeat |
| GET  | `/api/validators`      | List validator set |
| GET  | `/api/config-check`    | Validate STELLAR_SECRET, Horizon reachability |
| GET  | `/api/funding-status`  | Account balance + auto-funds via Friendbot if missing |
| POST | `/api/score`           | Run validators only (no anchor) |
| POST | `/api/evaluate`        | Run validators + anchor verdict on Stellar testnet |
| POST | `/api/mint-sbt`        | Issue a VTRUST Soulbound credential on Stellar |
| POST | `/api/revoke-sbt`      | Revoke a credential (kill-switch) |
| GET  | `/api/sbt-status`      | Check credential status for an agent |
| GET  | `/api/sbt-list`        | List all issued credentials |

## Environment variables

See `.env.example`. Required: `STELLAR_SECRET`. Optional: `STELLAR_PUBLIC`, `HORIZON_URL`, `NETWORK_PASSPHRASE`, `FRIENDBOT_URL`.

## Deploy

See `DEPLOY.md` for the GitHub + Vercel walkthrough.

## License

MIT — © 2026 BCP Partners GmbH
