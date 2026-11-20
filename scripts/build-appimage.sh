#!/usr/bin/env bash
# Construit l'AppImage de SysWatch.
#
# Le plugin GTK de linuxdeploy cherche les bibliothèques GTK par un `find` récursif dans
# le libdir de pkg-config (/usr/lib). Si un logiciel tiers y range ses propres copies
# (VMware : /usr/lib/vmware/lib/libgdk_pixbuf-2.0.so.0/…), elles sont embarquées à tort
# et le bundle échoue. On répond donc à la seule question « libdir » de ces paquets par
# un dossier temporaire qui ne contient que les bibliothèques du premier niveau
# (le plugin choisit lui-même pkgconf dans le PATH : on le précède).
set -euo pipefail
cd "$(dirname "$0")/.."

LIBDIR="$(pkg-config --variable=libdir gdk-pixbuf-2.0)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
for pat in 'libgdk_pixbuf-*.so*' 'libgobject-*.so*' 'libgio-*.so*' 'librsvg-*.so*' 'libpango-*.so*' 'libpangocairo-*.so*' 'libpangoft2-*.so*'; do
  find "$LIBDIR" -maxdepth 1 \( -type f -o -type l \) -name "$pat" -exec ln -sf {} "$STAGE/" \;
done

REAL="$(command -v pkgconf || command -v pkg-config)"
mkdir -p "$STAGE/bin"
cat > "$STAGE/bin/pkgconf" <<WRAP
#!/usr/bin/env bash
if [[ "\$1" == "--variable=libdir" && "\$2" =~ ^(gdk-pixbuf-2.0|gobject-2.0|gio-2.0|librsvg-2.0|pango|pangocairo|pangoft2)$ ]]; then
  echo "$STAGE"
else
  exec "$REAL" "\$@"
fi
WRAP
chmod +x "$STAGE/bin/pkgconf"
ln -s pkgconf "$STAGE/bin/pkg-config"

# Signature de mise à jour (.sig) avec la clé locale si elle existe ; sinon build non signé,
# utilisable tel quel mais sans fichiers de mise à jour.
KEY="$HOME/.tauri/syswatch.key"
EXTRA=()
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -f "$KEY" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$KEY.password" 2>/dev/null || true)"
elif [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  EXTRA=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
fi

# NO_STRIP : le strip embarqué par linuxdeploy ne connaît pas les binaires récents.
PATH="$STAGE/bin:$PATH" NO_STRIP=true npm run tauri build -- --bundles appimage "${EXTRA[@]}" "$@"
