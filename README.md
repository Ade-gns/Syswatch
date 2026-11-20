# SysWatch

Surveillance totale du PC sous Linux (testé sur CachyOS et Kubuntu) : CPU, GPU, mémoire,
disques et SMART, réseau, processus, batterie, ventilateurs, démarrage, alertes, widget
compact et overlay du mode jeu. Tout reste local : aucune donnée n'est envoyée sur le
réseau (seul un ping ICMP vers la passerelle locale mesure la latence).

Stack : Tauri 2, React, TypeScript, Tailwind 4 ; backend Rust. Le design (tokens,
maquettes) vient du dossier `SysWatch design/` ; `npm run sync-tokens` régénère les
variables CSS à partir de `tokens.json`.

## Prérequis

    # Arch / CachyOS
    sudo pacman -S --needed rustup base-devel webkit2gtk-4.1 libayatana-appindicator gtk-layer-shell udisks2
    # Kubuntu / Ubuntu
    sudo apt install build-essential libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libgtk-layer-shell-dev udisks2
    rustup default stable
    npm install

## Lancer

    npm run tauri dev                                  # développement
    npm run tauri build -- --bundles deb,rpm -c '{"bundle":{"createUpdaterArtifacts":false}}'   # .deb et .rpm (service inclus)
    ./scripts/build-appimage.sh                        # AppImage

Les paquets .deb et .rpm installent aussi le service privilégié des ventilateurs
(systemd, D-Bus, polkit). L'AppImage ne peut pas installer de service système :
utiliser alors `scripts/install-helper.sh`. `build-appimage.sh` contourne un défaut du
plugin GTK de linuxdeploy quand un logiciel tiers (VMware…) range des bibliothèques GTK
sous /usr/lib.

Hors de Tauri (`npm run dev`, navigateur), une source de données simulée reprend les
valeurs des maquettes pour comparer le rendu ; elle n'est jamais incluse dans le build.
Journal du backend : `SYSWATCH_LOG=info npm run tauri dev`.

## Mises à jour

L'AppImage se met à jour depuis **Paramètres → Mises à jour** : elle lit `latest.json`
dans la dernière Release GitHub, vérifie la signature du fichier téléchargé avec la clé
publique de `tauri.conf.json`, se remplace et redémarre. Aucune requête n'est faite tant
que « Vérifier au démarrage » est désactivé (par défaut) et qu'on ne clique pas
« Vérifier maintenant ». Les paquets .deb, .rpm et Arch se mettent à jour par le
gestionnaire de paquets.

Clé de signature : `~/.tauri/syswatch.key` (+ `.password`), hors du dépôt, à sauvegarder :
sans elle, plus aucune mise à jour ne pourra être acceptée par les AppImage installées.
`build-appimage.sh` l'utilise si elle est présente. Pour GitHub Actions, la copier dans
les secrets du dépôt `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Publier une version :

    ./scripts/release.sh 0.2.0          # numéro partout, commit et tag v0.2.0
    git push origin main v0.2.0         # .github/workflows/release.yml compile, signe, publie

## Service privilégié (ventilateurs)

L'application ne tourne jamais en root. Le pilotage des ventilateurs passe par un petit
service D-Bus séparé, autorisé par polkit (voir `packaging/README-helper.md`) :

    cargo build --release -p syswatch-helper
    sudo ./scripts/install-helper.sh             # --uninstall pour retirer

Sans lui, tout le reste fonctionne ; la page Ventilateurs passe en lecture seule.

## FPS de l'overlay

Seul MangoHud, injecté dans le jeu, connaît les FPS. Paramètres → Mode jeu →
« Configurer » ajoute trois lignes à `~/.config/MangoHud/MangoHud.conf` pour que SysWatch
lise son journal en direct ; l'overlay s'affiche alors pendant la partie (raccourci
Ctrl + Maj + F, via le portail de raccourcis globaux sous Wayland).

## Fichiers

- `~/.config/syswatch/settings.json` : réglages (thème, accent, seuils d'alerte, widget…)
- `~/.config/syswatch/layout.json` : disposition de l'Accueil
- `~/.config/autostart/syswatch.desktop` : lancement à l'ouverture de session (option)
- `~/.local/state/syswatch/mangohud/` : journaux MangoHud lus par l'overlay (purgés après 24 h)

## Organisation

    crates/syswatch-core     collecte sans droits (sysfs, procfs, NVML, udisks2, sock_diag…)
    crates/syswatch-fans     ventilateurs et courbes, partagé avec le service
    crates/syswatch-helper   service privilégié (D-Bus + polkit)
    src-tauri                application : échantillonnage, alertes, fenêtres, icône
    src                      interface React (pages, composants du design)
    packaging                unité systemd, D-Bus, polkit
