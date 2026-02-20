#!/bin/sh
# Run all tests: unit, scheduling BDD, and Playwright E2E.
# Usage:
#   ./test.sh          # headless (default)
#   ./test.sh --headed # watch E2E tests in the browser
cd "$(dirname "$0")"

echo "=== Unit tests ==="
node --test test/*.test.mjs || exit 1

echo ""
echo "=== Scheduling BDD tests ==="
npx cucumber-js || exit 1

echo ""
echo "=== E2E tests ==="
npx bddgen && npx playwright test "$@"
