#!/usr/bin/env bash
# Installe (ou désinstalle avec --uninstall) le service privilégié de SysWatch.
# À lancer avec sudo depuis la racine du dépôt, après « cargo build --release -p syswatch-helper ».
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=/usr/lib/syswatch/syswatch-helper
FILES=(
  "packaging/syswatch-helper.service:/usr/lib/systemd/system/syswatch-helper.service"
  "packaging/dev.syswatch.Helper1.service:/usr/share/dbus-1/system-services/dev.syswatch.Helper1.service"
  "packaging/dev.syswatch.Helper1.conf:/usr/share/dbus-1/system.d/dev.syswatch.Helper1.conf"
  "packaging/dev.syswatch.policy:/usr/share/polkit-1/actions/dev.syswatch.policy"
  "packaging/README-helper.md:/usr/share/doc/syswatch/README-helper.md"
)

if [[ $EUID -ne 0 ]]; then
  echo "Ce script doit être lancé avec sudo." >&2
  exit 1
fi

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl stop syswatch-helper.service 2>/dev/null || true
  rm -f "$BIN"
  for f in "${FILES[@]}"; do rm -f "${f#*:}"; done
  rmdir --ignore-fail-on-non-empty /usr/lib/syswatch /usr/share/doc/syswatch 2>/dev/null || true
  systemctl daemon-reload
  echo "Service SysWatch désinstallé."
  exit 0
fi

SRC=target/release/syswatch-helper
if [[ ! -x "$SRC" ]]; then
  echo "Binaire absent : lancez d'abord « cargo build --release -p syswatch-helper » (sans sudo)." >&2
  exit 1
fi

install -Dm755 "$SRC" "$BIN"
for f in "${FILES[@]}"; do install -Dm644 "${f%%:*}" "${f#*:}"; done
systemctl daemon-reload
# Recharge la configuration du bus pour prendre en compte la nouvelle politique.
busctl call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig >/dev/null 2>&1 || true
systemctl stop syswatch-helper.service 2>/dev/null || true
echo "Service SysWatch installé : il démarrera à la première demande de l'application."
