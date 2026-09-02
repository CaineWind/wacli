#!/bin/bash
set -euo pipefail

increment="${1:-patch}"

npx release-it --increment="$increment"

echo "Release commit and tag created locally."
echo "Push them with: git push origin main --follow-tags"
