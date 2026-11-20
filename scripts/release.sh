#!/usr/bin/env bash
# Prépare une version : met le numéro partout, commite et crée le tag (sans pousser).
#   ./scripts/release.sh 0.2.0
#   git push origin main v0.2.0     # GitHub Actions compile, signe et publie
set -euo pipefail
cd "$(dirname "$0")/.."

V="${1:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Usage : $0 X.Y.Z" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Arbre de travail non propre : commitez d'abord." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$V" >/dev/null && { echo "Le tag v$V existe déjà." >&2; exit 1; }

# tauri.conf.json, package.json (+ lock), version du workspace Cargo (+ lock).
node -e '
  const fs = require("fs"), v = process.argv[1];
  for (const f of ["src-tauri/tauri.conf.json", "package.json"]) {
    const j = JSON.parse(fs.readFileSync(f, "utf8")); j.version = v;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  }' "$V"
npm install --package-lock-only --ignore-scripts >/dev/null
sed -i -E '/^\[workspace\.package\]/,/^\[/ s/^version = ".*"/version = "'"$V"'"/' Cargo.toml
cargo update --workspace --quiet

git add src-tauri/tauri.conf.json package.json package-lock.json Cargo.toml Cargo.lock
git commit -m "Version $V"
git tag -a "v$V" -m "SysWatch $V"
echo "Prêt. Publier avec : git push origin main v$V"
