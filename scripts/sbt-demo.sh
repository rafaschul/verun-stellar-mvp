#!/usr/bin/env bash
# Verun SBT lifecycle demo — protocol-custodial credential on Stellar.
# Mint → verify on-chain → revoke (kill-switch) → re-verify.
#
# Usage:  ./scripts/sbt-demo.sh [agentId] [score]
#         ./scripts/sbt-demo.sh agt_fahad_001 720
#         BASE=http://localhost:3010 ./scripts/sbt-demo.sh   # local API

set -euo pipefail

AGENT="${1:-agt_fahad_001}"
SCORE="${2:-720}"
BASE="${BASE:-https://erster.fund}"

green() { printf '\033[0;32m%s\033[0m' "$1"; }
red()   { printf '\033[0;31m%s\033[0m' "$1"; }
amber() { printf '\033[0;33m%s\033[0m' "$1"; }
bold()  { printf '\033[1m%s\033[0m' "$1"; }

echo
bold "┌─ Verun SBT Lifecycle Demo ─────────────────────────────────────┐"
echo
printf "│ Agent : %-15s  •  Score: %-4s  •  Endpoint: %s\n" "$AGENT" "$SCORE" "$BASE"
bold "└────────────────────────────────────────────────────────────────┘"
echo

# ─── 1. PRE-CHECK STATUS ────────────────────────────────────────────
echo "[1/5] $(amber 'Checking current credential status...')"
PRE=$(curl -s "$BASE/api/sbt-status?agentId=$AGENT")
PRE_CRED=$(echo "$PRE" | python3 -c "import sys,json;print(json.load(sys.stdin).get('credentialed',False))" 2>/dev/null || echo "false")
echo "      Credentialed before mint: $PRE_CRED"
echo

# ─── 2. MINT ────────────────────────────────────────────────────────
echo "[2/5] $(amber 'Minting VTRUST credential under protocol authority...')"
MINT=$(curl -s -X POST "$BASE/api/mint-sbt" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT\",\"score\":$SCORE,\"operation\":\"transfer\"}")

MINT_OK=$(echo "$MINT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('success',False))")
if [ "$MINT_OK" != "True" ]; then
  red "      ✗ Mint failed: "
  echo "$MINT" | python3 -m json.tool
  exit 1
fi

TXID=$(echo "$MINT"     | python3 -c "import sys,json;print(json.load(sys.stdin)['txid'])")
TIER=$(echo "$MINT"     | python3 -c "import sys,json;print(json.load(sys.stdin)['tier'])")
LEDGER=$(echo "$MINT"   | python3 -c "import sys,json;print(json.load(sys.stdin)['ledger'])")
EXPLORER=$(echo "$MINT" | python3 -c "import sys,json;print(json.load(sys.stdin)['explorer'])")
VERIFY=$(echo "$MINT"   | python3 -c "import sys,json;print(json.load(sys.stdin)['verify_url'])")

green "      ✓ Mint successful"; echo
echo "        Tier         : $TIER"
echo "        TX           : $TXID"
echo "        Ledger       : $LEDGER"
echo "        Explorer     : $EXPLORER"
echo "        Verify URL   : $VERIFY"
echo

# ─── 3. PUBLIC VERIFICATION ─────────────────────────────────────────
echo "[3/5] $(amber 'Public verification (anyone, no auth required)...')"
echo "        \$ curl $VERIFY"
RAW=$(curl -s "$VERIFY" || echo '{"value":null}')
VAL=$(echo "$RAW" | python3 -c "import sys,json,base64;d=json.load(sys.stdin);v=d.get('value');print(base64.b64decode(v).decode() if v else '(empty)')" 2>/dev/null || echo "(unparseable)")
green "      → on-chain credential = $VAL"; echo
echo

# ─── 4. REVOKE (kill-switch) ────────────────────────────────────────
echo "[4/5] $(amber 'Simulating MiFID II kill-switch — revoking credential...')"
REV=$(curl -s -X POST "$BASE/api/revoke-sbt" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT\",\"reason\":\"demo_kill_switch\"}")

REV_OK=$(echo "$REV" | python3 -c "import sys,json;print(json.load(sys.stdin).get('success',False))")
if [ "$REV_OK" != "True" ]; then
  red "      ✗ Revoke failed: "
  echo "$REV" | python3 -m json.tool
  exit 1
fi

REV_TXID=$(echo "$REV"     | python3 -c "import sys,json;print(json.load(sys.stdin)['txid'])")
REV_EXPLORER=$(echo "$REV" | python3 -c "import sys,json;print(json.load(sys.stdin)['explorer'])")
green "      ✓ Revoke successful"; echo
echo "        Revoke TX    : $REV_TXID"
echo "        Explorer     : $REV_EXPLORER"
echo

# ─── 5. POST-REVOKE VERIFICATION ────────────────────────────────────
echo "[5/5] $(amber 'Re-verifying after revoke...')"
sleep 2
POST=$(curl -s "$BASE/api/sbt-status?agentId=$AGENT")
POST_CRED=$(echo "$POST" | python3 -c "import sys,json;print(json.load(sys.stdin).get('credentialed',False))")
if [ "$POST_CRED" = "False" ]; then
  green "      ✓ Credential cleared on-chain — kill-switch confirmed"; echo
else
  red "      ✗ Credential still present (revoke did not propagate). Status: $POST_CRED"
fi
echo

# ─── SUMMARY ────────────────────────────────────────────────────────
bold "┌─ Lifecycle Complete ───────────────────────────────────────────┐"
echo
echo "│ Mint TX    : $TXID"
echo "│ Revoke TX  : $REV_TXID"
echo "│ Issuer     : protocol account (single responsible party — EU regulator-friendly)"
echo "│ Compliance : EU AI Act Art.12 ✓  AI Act Art.14 ✓  MiFID II Art.17 ✓"
bold "└────────────────────────────────────────────────────────────────┘"
echo
