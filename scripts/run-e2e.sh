#!/usr/bin/env bash
# Verun E2E smoke test — production (www.erster.fund)
# Tests: health, validators, evaluate, SBT lifecycle, sbt-list, frontend deploy state.
#
# Usage:  bash scripts/run-e2e.sh

set -u

BASE="https://www.erster.fund"
AGENT="agt_e2e_$(date +%s)"

GREEN='\033[0;32m'; RED='\033[0;31m'; AMBER='\033[0;33m'; BOLD='\033[1m'; NC='\033[0m'
pass(){ printf "${GREEN}[OK]${NC} %s\n"   "$1"; }
fail(){ printf "${RED}[FAIL]${NC} %s\n"   "$1"; }
hdr(){  printf "\n${BOLD}-- %s --${NC}\n" "$1"; }

CURL="curl -sSL --max-time 20"

# ----- 1. HEALTH -----------------------------------------------------
hdr "1/6  HEALTH CHECK"
H_BODY=$($CURL "$BASE/api/health")
H_CODE=$($CURL -o /dev/null -w "%{http_code}" "$BASE/api/health")
echo "$H_BODY" | python3 -m json.tool 2>/dev/null || echo "$H_BODY"
[ "$H_CODE" = "200" ] && pass "HTTP $H_CODE" || fail "HTTP $H_CODE"

# ----- 2. VALIDATORS -------------------------------------------------
hdr "2/6  VALIDATORS"
V_BODY=$($CURL "$BASE/api/validators")
V_CODE=$($CURL -o /dev/null -w "%{http_code}" "$BASE/api/validators")
echo "$V_BODY" | python3 -m json.tool 2>/dev/null || echo "$V_BODY"
[ "$V_CODE" = "200" ] && pass "HTTP $V_CODE" || fail "HTTP $V_CODE"

# ----- 3. EVALUATE (POST + on-chain anchor) --------------------------
hdr "3/6  EVALUATE -> ON-CHAIN ANCHOR"
E_BODY=$($CURL -X POST "$BASE/api/evaluate" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT\",\"score\":720,\"operation\":\"transfer\"}")
echo "$E_BODY" | python3 -m json.tool 2>/dev/null || echo "$E_BODY"
TXID=$(echo "$E_BODY"   | python3 -c "import sys,json;print(json.load(sys.stdin)['anchor']['txid'])"      2>/dev/null || echo "")
PERMIT=$(echo "$E_BODY" | python3 -c "import sys,json;print(json.load(sys.stdin)['verdict']['permitted'])" 2>/dev/null || echo "")
if [ -n "$TXID" ]; then
  pass "TXID: $TXID"
  echo "       Explorer: https://stellar.expert/explorer/testnet/tx/$TXID"
else
  fail "no TXID returned"
fi
[ "$PERMIT" = "True" ] && pass "permitted=True (score 720 OK for transfer)" || fail "permitted=$PERMIT"

# ----- 4. SBT LIFECYCLE ---------------------------------------------
hdr "4/6  SBT LIFECYCLE (mint -> verify -> revoke -> re-verify)"
BASE="$BASE" bash scripts/sbt-demo.sh "${AGENT}_sbt" 720 || fail "sbt-demo.sh non-zero exit"

# ----- 5. SBT-LIST --------------------------------------------------
hdr "5/6  SBT-LIST"
L_BODY=$($CURL "$BASE/api/sbt-list")
L_CODE=$($CURL -o /dev/null -w "%{http_code}" "$BASE/api/sbt-list")
echo "$L_BODY" | python3 -m json.tool 2>/dev/null | head -25 || echo "$L_BODY" | head -200
[ "$L_CODE" = "200" ] && pass "HTTP $L_CODE" || fail "HTTP $L_CODE"

# ----- 6. FRONTEND DEPLOY STATE -------------------------------------
hdr "6/6  FRONTEND DEPLOY"
LANDING_CODE=$($CURL -o /dev/null -w "%{http_code}" "$BASE/")
DOCS_CODE=$($CURL    -o /dev/null -w "%{http_code}" "$BASE/docs.html")
IMG_CODE=$($CURL     -o /dev/null -w "%{http_code}" "$BASE/assets/sbt-architecture.png")
[ "$LANDING_CODE" = "200" ] && pass "landing $LANDING_CODE"   || fail "landing $LANDING_CODE"
[ "$DOCS_CODE"    = "200" ] && pass "docs $DOCS_CODE"         || fail "docs $DOCS_CODE"
[ "$IMG_CODE"     = "200" ] && pass "sbt-arch image $IMG_CODE" || fail "sbt-arch image $IMG_CODE"

DOCS_HTML=$($CURL "$BASE/docs.html")
echo "$DOCS_HTML" | grep -q ">Impressum<"   && fail "Impressum still in docs"  || pass "Impressum removed from docs"
echo "$DOCS_HTML" | grep -q "Search docs"   && fail "search bar still in docs" || pass "search bar removed from docs"

# ----- DONE ---------------------------------------------------------
printf "\n${BOLD}+- E2E TEST COMPLETE ------------------------------------------+${NC}\n"
printf "  Endpoint  : %s\n" "$BASE"
printf "  Agent     : %s\n" "$AGENT"
printf "  Repo HEAD : %s\n" "$(git rev-parse --short HEAD 2>/dev/null || echo n/a)"
printf "${BOLD}+--------------------------------------------------------------+${NC}\n"
