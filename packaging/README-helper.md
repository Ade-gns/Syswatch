# Service privilégié de SysWatch (`syswatch-helper`)

SysWatch tourne toujours avec les droits de l'utilisateur. Seule l'écriture des consignes
de ventilateurs demande root ; elle passe par ce petit service séparé.

## Ce qu'il fait — et rien d'autre

- Pilote les canaux `pwmN` / `pwmN_enable` de `/sys/class/hwmon` qu'il découvre lui-même
  (GPU exclus). Le client ne transmet qu'un identifiant (`nct6775/pwm2`) et un mode
  (automatique, pleine vitesse, vitesse fixe, courbe) ; jamais de chemin ni de commande.
- Applique la courbe température → vitesse toutes les 2 s, même application fermée.
- Garde-fous : vitesse plancher de 20 %, pleine vitesse au-delà de 90 °C ou si la sonde
  CPU devient illisible, retour au firmware à l'arrêt (SIGTERM, 60 s d'inactivité).

## Sécurité

- Démarré à la demande par D-Bus (`dev.syswatch.Helper1`), service systemd durci :
  aucune capacité, pas de réseau, système de fichiers en lecture seule hors `/sys`,
  filtre d'appels système (`systemd-analyze security` : exposition 1,2).
- Chaque écriture est autorisée par polkit, action `dev.syswatch.fan-control` :
  sans mot de passe pour la session locale active, mot de passe administrateur sinon.
  Pour exiger le mot de passe à chaque fois, une règle dans `/etc/polkit-1/rules.d/`
  peut renvoyer `polkit.Result.AUTH_ADMIN` pour cette action.

## Installation

    cargo build --release -p syswatch-helper
    sudo ./scripts/install-helper.sh            # installer
    sudo ./scripts/install-helper.sh --uninstall

Journal : `journalctl -u syswatch-helper`.
