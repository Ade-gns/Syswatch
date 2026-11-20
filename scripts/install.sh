#!/usr/bin/env bash
# Installe SysWatch (AppImage) pour l'utilisateur courant, avec ses prérequis.
#
#   curl -fsSL https://raw.githubusercontent.com/Ade-gns/Syswatch/main/scripts/install.sh | bash
#   … | bash -s -- --uninstall
#
# 1. Prérequis système manquants (FUSE pour l'AppImage, udisks2 pour SMART), via le
#    gestionnaire de paquets de la distribution (pacman, apt, dnf, zypper) : sudo demandé.
# 2. Dernière AppImage depuis les Releases GitHub → ~/.local/bin/SysWatch.AppImage
#    (dossier de l'utilisateur : elle peut s'y mettre à jour elle-même).
# 3. Entrée de menu et icône dans ~/.local/share.
# 4. Facultatif (question posée) : service privilégié du pilotage des ventilateurs.
#
# Variables : SYSWATCH_APPIMAGE (fichier local au lieu du téléchargement), SYSWATCH_YES=1
# (répondre oui à tout), SYSWATCH_NO_HELPER=1 (ne pas proposer le service).
set -euo pipefail

REPO="Ade-gns/Syswatch"
DL="https://github.com/$REPO/releases/latest/download"
RAW="https://raw.githubusercontent.com/$REPO/main"
BIN_DIR="$HOME/.local/bin"
APP="$BIN_DIR/SysWatch.AppImage"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP="$DATA/applications/syswatch.desktop"
ICON="$DATA/icons/hicolor/128x128/apps/syswatch.png"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }

# Questions : lues sur le terminal même quand le script arrive par « curl | bash ».
ask() {
  [[ "${SYSWATCH_YES:-}" == 1 ]] && return 0
  local r=""
  # Sans terminal (installation automatisée) : réponse « non ».
  { read -rp "$1 [o/N] " r </dev/tty; } 2>/dev/null || return 1
  [[ "$r" =~ ^[oOyY] ]]
}

[[ $EUID -ne 0 ]] || die "lancer ce script sans sudo : il le demandera lui-même si besoin."
[[ "$(uname -m)" == x86_64 ]] || die "seule l'architecture x86_64 est publiée."
command -v curl >/dev/null || die "curl est requis."

if [[ "${1:-}" == "--uninstall" ]]; then
  say "Désinstallation de SysWatch"
  rm -f "$APP" "$DESKTOP" "$ICON" "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/syswatch.desktop"
  if [[ -x /usr/lib/syswatch/syswatch-helper ]] && ask "Retirer aussi le service des ventilateurs (sudo) ?"; then
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    curl -fsSL "$RAW/scripts/install-helper.sh" -o "$tmp/install-helper.sh"
    sudo bash "$tmp/install-helper.sh" --uninstall
  fi
  say "Terminé. Les réglages restent dans ~/.config/syswatch (à supprimer à la main si besoin)."
  exit 0
fi

# --- 1. Prérequis -------------------------------------------------------------------------
# Mêmes noms de paquets sur Arch, Debian/Ubuntu, Fedora et openSUSE.
pkgs=()
command -v fusermount3 >/dev/null || command -v fusermount >/dev/null || pkgs+=(fuse3)
command -v udisksctl >/dev/null || pkgs+=(udisks2)

if ((${#pkgs[@]})); then
  if command -v pacman >/dev/null; then pm=(sudo pacman -S --needed --noconfirm)
  elif command -v apt-get >/dev/null; then pm=(sudo apt-get install -y)
  elif command -v dnf >/dev/null; then pm=(sudo dnf install -y)
  elif command -v zypper >/dev/null; then pm=(sudo zypper --non-interactive install)
  else pm=(); fi
  say "Prérequis manquants : ${pkgs[*]}"
  if ((${#pm[@]})) && ask "Les installer maintenant avec « ${pm[*]} » ?"; then
    [[ "${pm[1]}" == apt-get ]] && sudo apt-get update -qq
    "${pm[@]}" "${pkgs[@]}"
  else
    warn "Non installés : sans FUSE l'AppImage ne démarre pas, sans udisks2 pas de données SMART."
  fi
fi

# --- 2. AppImage ----------------------------------------------------------------------------
mkdir -p "$BIN_DIR"
if [[ -n "${SYSWATCH_APPIMAGE:-}" ]]; then
  say "Copie de $SYSWATCH_APPIMAGE"
  install -m755 "$SYSWATCH_APPIMAGE" "$APP"
else
  say "Téléchargement de la dernière version"
  curl -fL --progress-bar "$DL/SysWatch-x86_64.AppImage" -o "$APP.part" || die "téléchargement impossible ($DL)."
  chmod 755 "$APP.part" && mv -f "$APP.part" "$APP"
fi

# --- 3. Menu et icône ------------------------------------------------------------------------
mkdir -p "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
curl -fsSL "$RAW/src-tauri/icons/128x128.png" -o "$ICON" || warn "icône non téléchargée."
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=SysWatch
GenericName=Surveillance système
Comment=Surveillance totale du PC : CPU, GPU, mémoire, disques, réseau, ventilateurs
Exec="$APP"
Icon=syswatch
Terminal=false
Categories=System;Monitor;
Keywords=moniteur;température;ventilateur;processus;monitor;sensors;
StartupWMClass=syswatch
EOF
command -v update-desktop-database >/dev/null && update-desktop-database -q "$(dirname "$DESKTOP")" || true

# --- 4. Service des ventilateurs (facultatif) ------------------------------------------------
if [[ "${SYSWATCH_NO_HELPER:-}" != 1 && ! -x /usr/lib/syswatch/syswatch-helper ]]; then
  echo
  echo "Le pilotage des ventilateurs passe par un petit service système (D-Bus + polkit),"
  echo "jamais par l'application en root. Sans lui, les ventilateurs restent en lecture seule."
  if ask "Installer ce service maintenant (sudo) ?"; then
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    curl -fL --progress-bar "$DL/syswatch-helper-x86_64.tar.gz" -o "$tmp/helper.tar.gz" || die "téléchargement du service impossible."
    tar -xzf "$tmp/helper.tar.gz" -C "$tmp"
    sudo bash "$tmp/scripts/install-helper.sh"
  fi
fi

echo
say "SysWatch est installé : menu des applications, ou « $APP »."
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) warn "$BIN_DIR n'est pas dans le PATH (sans effet sur le menu).";; esac
