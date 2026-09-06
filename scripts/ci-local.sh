#!/usr/bin/env bash
#
# RUN THE CI PIPELINE LOCALLY — CMBBACKEND.
#
#     bash scripts/ci-local.sh
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# It runs the same commands as `.github/workflows/ci.yml`, in the same order, on
# the machine you are sitting at, so the pipeline can be shown to work before
# anybody depends on it — and so a pre-push check costs no Actions minutes.
#
# It is not a substitute for the real thing: it uses the checkout you have
# rather than a clean one, and it cannot prove `npm ci` resolves on a fresh
# runner. Those are the two things only GitHub can tell you.
#
# Every step prints PASS or FAIL and the script exits non-zero if any failed.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PASSED=0
FAILED=0
declare -a RESULTS=()

step() {
  local name="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$name"
  if "$@"; then
    RESULTS+=("PASS  $name")
    PASSED=$((PASSED + 1))
  else
    RESULTS+=("FAIL  $name")
    FAILED=$((FAILED + 1))
  fi
}

# ── backend ────────────────────────────────────────────────────────────────
step "backend · typecheck"        npm run typecheck
step "backend · lint"             npm run lint
step "backend · tests"            npm test
step "backend · build"            npm run build

step "backend · entry points"     bash -c '
  for entry in dist/server.js dist/jobs/run.js dist/db/migrate.js dist/db/seed.js; do
    test -f "$entry" || { echo "MISSING: $entry"; exit 1; }
    echo "present: $entry"
  done'

# ── schema ─────────────────────────────────────────────────────────────────
step "schema · drizzle-kit check" npx drizzle-kit check

step "schema · counts agree"      bash -c '
  sql=$(ls drizzle/*.sql | wc -l)
  snap=$(ls drizzle/meta/*_snapshot.json | wc -l)
  journal=$(node -e "console.log(require(\"./drizzle/meta/_journal.json\").entries.length)")
  echo "migrations=$sql snapshots=$snap journal=$journal"
  test "$sql" = "$snap" || { echo "A migration has no snapshot — the Wave 0 defect."; exit 1; }
  test "$sql" = "$journal" || { echo "The journal disagrees with the migrations on disk."; exit 1; }'

# A CONTENT SNAPSHOT before and after, not `git diff` against HEAD. The latter
# is blind to untracked files and fails on legitimate uncommitted migration
# work that generate never touched.
step "schema · db:generate zero diff" bash -c '
  snapshot() { find drizzle -type f \( -name "*.sql" -o -name "*.json" \) -print0 | sort -z | xargs -0 sha256sum | sha256sum; }
  before=$(snapshot)
  npm run db:generate >/dev/null 2>&1
  after=$(snapshot)
  if [ "$before" != "$after" ]; then
    echo "db:generate changed files under drizzle/:"; git status --porcelain drizzle/; exit 1
  fi
  echo "Zero diff: db:generate is a no-op, so the schema and the snapshots agree."'

# ── hygiene ────────────────────────────────────────────────────────────────
step "hygiene · no tracked .env"  bash -c '
  tracked=$(git ls-files | grep -E "(^|/)\.env($|\.)" | grep -v "\.env\.example$" || true)
  if [ -n "$tracked" ]; then echo "Tracked env files:"; echo "$tracked"; exit 1; fi
  echo "No tracked .env files."'

step "hygiene · no tracked build output" bash -c '
  tracked=$(git ls-files | grep -E "(^|/)(node_modules|dist)/" || true)
  if [ -n "$tracked" ]; then echo "Tracked build output:"; echo "$tracked" | head; exit 1; fi
  echo "No tracked build output."'

step "hygiene · meta/ is JSON only" bash -c '
  stray=$(git ls-files "drizzle/meta/*" | grep -v "\.json$" || true)
  if [ -n "$stray" ]; then echo "Non-JSON in meta/ (D-081):"; echo "$stray"; exit 1; fi
  echo "meta/ contains JSON only."'

step "hygiene · no tracked .storage" bash -c '
  tracked=$(git ls-files | grep -E "(^|/)\.storage/" || true)
  if [ -n "$tracked" ]; then echo "Tracked storage artefacts:"; echo "$tracked" | head; exit 1; fi
  echo "No tracked storage artefacts."'

# ── summary ────────────────────────────────────────────────────────────────
printf '\n\033[1m════ CI SUMMARY ════\033[0m\n'
for line in "${RESULTS[@]}"; do printf '  %s\n' "$line"; done
printf '\n  %d passed, %d failed\n' "$PASSED" "$FAILED"
exit $(( FAILED > 0 ? 1 : 0 ))
