#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Check if logged in
if ! npm whoami >/dev/null 2>&1; then
  echo "Not logged in to npm. Opening browser login..."
  npm login --auth-type=web
fi

echo "Logged in as: $(npm whoami)"

# Build fresh before publish
echo "Building..."
npm run build

# Publish
echo "Publishing token-counter-mcp..."
npm publish --access public

echo ""
echo "Done! Package is live:"
echo "  npx -y token-counter-mcp"
