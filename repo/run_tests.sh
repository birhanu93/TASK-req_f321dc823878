#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-local}"

case "$MODE" in
  local)
    echo "=== Running tests locally ==="
    echo "Installing dependencies..."
    npm ci
    npm test
    ;;
  docker)
    echo "=== Running tests in Docker ==="
    docker compose build tests
    docker compose run --rm tests
    ;;
  coverage)
    echo "=== Running tests with coverage ==="
    echo "Installing dependencies..."
    npm ci
    npm run test:coverage
    ;;
  *)
    echo "Usage: $0 [local|docker|coverage]"
    echo "  local    - Run tests locally (default)"
    echo "  docker   - Run tests in Docker container"
    echo "  coverage - Run tests with coverage report"
    exit 1
    ;;
esac

echo ""
echo "=== Tests complete ==="
