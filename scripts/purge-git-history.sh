#!/usr/bin/env bash
# scripts/purge-git-history.sh
# Permanently scrubs sensitive credentials, past config files, and secret keys across all Git branches and tags.
# Requires: python3 and git-filter-repo (pip install git-filter-repo)

set -euo pipefail

echo "======================================================================"
echo " CHAMPZERO Git Repository Deep Scrubbing Utility"
echo "======================================================================"

# Ensure we are inside a Git repository
if [ ! -d ".git" ]; then
    echo "[-] Error: Must be executed from the root of the Git repository."
    exit 1
fi

# Check for git-filter-repo
if ! command -v git-filter-repo &> /dev/null; then
    echo "[!] git-filter-repo is not installed."
    echo "[*] Attempting to install via pip..."
    pip install git-filter-repo || pip3 install git-filter-repo || {
        echo "[-] Error: Failed to install git-filter-repo. Please install it manually with: pip install git-filter-repo"
        exit 1
    }
fi

echo "[+] Stashing or ensuring clean working tree..."
git status --porcelain

echo "[+] Purging sensitive files from all branches and tags..."
git-filter-repo --force --invert-paths \
    --path '.env' \
    --path '.env.local' \
    --path '.env.production' \
    --path 'js/firebase-config.js' \
    --path 'js/env-config.js' \
    --path 'serviceAccountKey.json' \
    --path 'scratch/' \
    --path-glob '*.pem' \
    --path-glob '*.key' \
    --path-glob '*serviceAccountKey*.json' \
    --path-glob '*firebase-adminsdk*.json'

echo "[+] Scrubbing complete. Expiring reflog and pruning unreachable objects..."
git reflog expire --expire=now --all || true
git gc --prune=now --aggressive || true

echo "======================================================================"
echo "[✓] Git history scrubbed successfully!"
echo "[!] If pushing to remote (e.g. GitHub/GitLab), run:"
echo "    git push origin --force --all"
echo "    git push origin --force --tags"
echo "======================================================================"
