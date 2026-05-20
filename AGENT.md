# Verun Network — Agent Integration Guide (Stellar)

> **For AI agents:** Copy the system prompt below into your agent's system instructions to connect to Verun Network on Stellar.

---

## System Prompt (copy-paste ready)

```
You are an AI agent operating within the Verun Network trust framework on Stellar.

Before executing any financial operation, request a Verun trust evaluation.

== HOW TO EVALUATE ==
POST https://www.erster.fund/api/evaluate
Body: { "agentId": "YOUR_AGENT_ID", "score": YOUR_SCORE, "operation": "transfer" }

== OPERATION GATES ==
read        → score 300+
transfer    → score 500+
order       → score 600+

== VERDICT RULES ==
permitted: true   → proceed with the operation
permitted: false  → stop, escalate to human supervisor
Always store the returned txid as your on-chain audit trail.

== HUMAN ESCALATION ==
If verdict is denied or pending, notify the human supervisor.
Never execute financial operations without a valid Verun verdict.

Network: Stellar Testnet
Validators: BCP Partners + 2 others (testnet prototype)
Docs: https://erster.fund/docs.html
```

---

## API Reference

### Evaluate Agent

```bash
curl -X POST https://www.erster.fund/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agt_my_agent","score":820,"operation":"transfer"}'
```

**Response:**
```json
{
  "success": true,
  "verdict": {
    "consensus": "LOW",
    "permitted": true,
    "operation": "transfer",
    "score": 820
  },
  "anchor": {
    "txid": "STELLAR_TESTNET_TX_HASH",
    "ledger": "12345678",
    "explorer": "https://stellar.expert/explorer/testnet/tx/..."
  }
}
```

### Health Check

```bash
curl https://www.erster.fund/api/health
```

---

## Operation Gates

| operation | Min. Score | Use case |
|-----------|-----------|----------|
| `read` | 300+ | Query platform data, price feeds |
| `transfer` | 500+ | Send tokens, initiate payments |
| `order` | 600+ | Place trade orders, mint tokens |

---

## Score Tiers

| Tier | Score | Access |
|------|-------|--------|
| HIGH | 800+ | Full autonomous access |
| MED | 600+ | Transfer + order |
| LOW | 300+ | Read only |
| BLOCK | <300 | No access |

---

## On-Chain Proof

Every evaluation is anchored as a **Memo Transaction on Stellar Testnet**: a 1-stroop self-payment whose memo is `sha256(verdict_payload)`. Verify any `txid` at: https://stellar.expert/explorer/testnet

---

## Validators (Testnet Prototype)

| Name | Type | Notes |
|------|------|-------|
| BCP Partners | Internal | Score-based |
| External Validator (TBD) | External | Chain API gate — integration exploratory |
| Test Validator | Testnet only | Score-based |

2-of-3 consensus required for a valid verdict.

---

## Links

- **Landing Page:** https://erster.fund
- **Tech Docs:** https://erster.fund/docs.html
- **Contact:** https://www.bcpp.io/contact-us

© 2026 BCP Partners GmbH
