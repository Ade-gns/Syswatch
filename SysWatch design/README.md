SysWatch est une application desktop Linux de surveillance totale du PC : CPU, GPU, mémoire, disques, réseau, processus, batterie, ventilateurs, démarrage et alertes, dans un tableau de bord sombre d'inspiration gaming (HWiNFO, MSI Afterburner, Razer Synapse). Le nom est provisoire ; l'écrire « SysWatch ».

## Fondamentaux de contenu

- Écrire en français, d'un ton neutre et factuel, sans tutoiement. Un libellé tient en un à trois mots : « Température », « Mémoire », « Processus & apps ».
- Titres de carte et en-têtes de colonne : style `label`, toujours en majuscules. Tout le reste en casse de phrase.
- Afficher chaque valeur chiffrée en police mono (`value`, `value-md`, `data`) avec son unité : `61 °C`, `42,8 Mo/s`, `13,1 Go`, `2 840 tr/min`. Virgule décimale, espace insécable avant l'unité, espace fine entre les milliers.
- Dire l'état avec un mot, jamais avec la couleur seule : « Normal », « Attention », « Critique », « Bon », « Connecté ». Les badges portent toujours ce mot.
- Une alerte tient en une ligne : la grandeur, la valeur, l'heure. Exemple : « Disque /home à 91 % », « SSD NVMe à 69 °C ».
- Les actions destructrices se confirment en deux temps dans la ligne elle-même : « Fermer » devient « Confirmer » pendant 3 secondes. Pas de boîte de dialogue bloquante.
- Aucun emoji. Les icônes sont des pictogrammes au trait de 1,8 px sur grille 24 px, héritant `currentColor`.

## Fondations visuelles

**Fond et surfaces.** La fenêtre est en `bg`. Barre de titre, barre latérale et champs sont en `surface-1`. Les cartes sont en `surface-2`, avec une bordure fine `border` et l'ombre `shadow-card` pour un léger relief ; `surface-3` sert au survol, à l'élément segmenté actif et aux bulles d'info. Texte courant en `text`, secondaire en `text-muted` ; `text-disabled` seulement pour un contrôle désactivé.

**Typographie.** Barlow (`ui`) pour toute l'interface, JetBrains Mono (`mono`) pour toute valeur chiffrée, axe de graphique et chiffre de tableau, avec chiffres tabulaires. Titre de page en `title-page`, titre de carte en `label`, texte en `body` ou `body-sm`. Valeur héros d'une carte : `value` ; FPS de l'overlay : `value-xl`.

**Espacement.** Grille de 4 px. Gouttière entre widgets et padding de carte : `space-4` (16 px). Marges de la zone principale : `space-5` en haut et en bas, `space-6` sur les côtés. Les cartes ne dépassent jamais `radius-md` ; la fenêtre et l'overlay prennent `radius-lg` ; boutons, champs et lignes de menu `radius-sm` ; badges, interrupteurs et curseurs `radius-pill`.

**Bordures et profondeur.** Cartes : `border` 1 px plus `shadow-card`. Un contrôle interactif porte `control-border` (≥ 3:1). Un widget qu'on déplace reçoit `shadow-lift` et une bordure `accent`. Pas de dégradé décoratif, pas de bordure colorée d'un seul côté.

**Mouvement.** Les jauges et barres s'animent en 0,6 s ; les graphiques avancent d'un échantillon par seconde. Respecter `prefers-reduced-motion` : graphiques figés.

## Jauges et seuils

Toute jauge (anneau, barre, cœur de CPU, mini-courbe) change de couleur selon sa valeur : normal en `accent`, attention en `warn`, critique en `crit`. Les repères de seuil sont tracés sur les barres. Un seuil se règle par métrique, dans la page Alertes.

| Métrique | Attention | Critique |
| --- | --- | --- |
| Charge CPU, GPU, mémoire | 75 % | 90 % |
| Espace disque | 80 % | 90 % |
| Température CPU, GPU | 80 °C | 90 °C |
| Température SSD NVMe | 65 °C | 75 °C |
| Température par défaut (capteur sans réglage) | 65 °C | 85 °C |

Les valeurs sans seuil (fréquence, puissance, débit) restent en `accent`. Le texte d'une valeur reste en `text` quelle que soit la jauge : l'état se lit sur la jauge, le badge et le mot.

## Couleur d'accent personnalisable

Toutes les teintes d'accent passent par `accent` et `on-accent`. L'utilisateur choisit dans Paramètres un préréglage (`preset-cyan`, `preset-vert`, `preset-orange`, `preset-rose`, `preset-violet`) ou une couleur libre.

- Écraser `--accent` sur l'élément racine qui porte `data-theme`. `bundle.css` en dérive `--accent-soft` (14 %) et `--accent-line` (50 %) par `color-mix`.
- Choisir la valeur du préréglage qui correspond au thème actif (colonne sombre ou claire). Recalculer `--on-accent` : noir `#0a0c10` ou blanc, selon le meilleur contraste.
- Une couleur libre claire passe aussi en thème clair : l'avertir si le contraste avec `surface-2` est inférieur à 4,5:1.
- `warn` et `crit` ne se personnalisent jamais : ils gardent leur sens d'alerte. L'accent ne doit pas être choisi de façon à les imiter (éviter jaune vif et rouge comme préréglages).

## Mise en page

- Fenêtre de 1 280 × 800 px de référence : barre de titre `titlebar-h` (36 px), barre latérale à gauche, zone principale à droite.
- Barre latérale : `sidebar-w` (216 px) avec icônes et libellés, `sidebar-w-collapsed` (64 px) icônes seules, repliable par le bouton « Replier ». Ordre des pages, séparées en quatre groupes : Accueil ; CPU, GPU, Mémoire, Disques, Réseau ; Processus & apps, Batterie, Ventilateurs, Démarrage ; Alertes, Paramètres. La page active a un fond `accent-soft` et une icône `accent`. Les alertes non lues se comptent dans une pastille `crit`.
- En bas de la barre latérale, discrètement : la mémoire utilisée par SysWatch lui-même (`47 Mo`, style `data`, `text-muted`).
- Zone principale : en-tête de page (`title-page` + sous-titre `body-sm`, actions à droite) puis grille de 12 colonnes, gouttière `space-4`. Un widget occupe 3, 4, 5, 6, 7, 8 ou 12 colonnes. Rangée type : quatre cartes de métrique de 3 colonnes (128 px), puis un graphique de 8 colonnes avec une carte de 4.

## Composants

- **Carte de métrique** : jauge circulaire, barre ou valeur seule, plus mini-courbe. Une carte = une grandeur. La barre est réservée aux capacités (disque, batterie).
- **Graphique temps réel** : 60 secondes, grille `gridline`, axes en `axis`. La première série est en `accent` et pleine ; la deuxième en `series-2` en tirets longs ; la troisième en `series-3` en pointillés, pour se distinguer sans la couleur. Au survol, un trait vertical et une bulle `surface-3` listent chaque série à l'instant visé.
- **Tableau de processus** : colonnes Nom, CPU, RAM, Disque, Réseau, triables au clic ; basculer entre « Applications ouvertes » et « Tous les processus » ; un bouton « Fermer » par ligne, confirmé en deux temps.
- **Contrôle des ventilateurs** : bascule Auto, puis trois boutons Faible (35 %), Moyen (60 %), Fort (100 %) avec des barres de signal à 1, 2, 3 niveaux. Choisir un niveau coupe l'Auto ; rallumer l'Auto efface le niveau. Les profils Silencieux, Jeu et Performance sont des cartes exclusives. L'éditeur de courbe permet de glisser chaque point de 30 à 100 °C ; un point ne dépasse jamais ses voisins ; la température courante est repérée par un trait pointillé et sa vitesse lue dans une étiquette.
- **Contrôles** : bouton primaire en `accent` avec texte `on-accent`, bouton secondaire à bordure `control-border`, bouton destructeur qui rougit au survol, bouton segmenté, interrupteur, curseur, case, pastille de couleur.

## Page Accueil personnalisable

- Mode normal : grille de widgets, boutons « Mode jeu » et « Personnaliser » en haut à droite.
- Mode édition : barre latérale repliée automatiquement, bordures pointillées `accent` autour des widgets, poignée de déplacement centrée en haut (`dots`), bouton de retrait rond en haut à droite, coin de redimensionnement en bas à droite, panneau « Ajouter un widget » de 264 px à droite. Le widget saisi est soulevé (`shadow-lift`, bordure `accent`, léger incliné) au-dessus d'un emplacement « Déposer ici » ; sa place d'origine reste en pointillé gris. Les boutons « Réinitialiser » et « Terminer » quittent le mode.

## Widget compact et overlay de jeu

- Fond translucide `overlay-bg`, jamais de focus volé, clic traversant. Trois formes : barre (pilule de 44 px), carte (224 px) et pastille.
- L'overlay de jeu superpose les valeurs au jeu : FPS en `value-xl`, temps de trame, puis CPU, GPU, RAM, VRAM. Un FPS sous la cible s'affiche avec le point `warn` et la mention « sous la cible », jamais la couleur seule. Raccourci par défaut : Ctrl + Maj + F.

## Accessibilité

- Tout texte atteint 4,5:1 sur la surface qui le porte, dans les deux thèmes. Bordures de contrôle, anneaux de focus, icônes et jauges atteignent 3:1.
- Anneau de focus : 2 px `accent`, décalé de 2 px, visible sur tous les contrôles. Le curseur et l'éditeur de courbe se pilotent au clavier (flèches).
- Les états ne reposent jamais sur la teinte seule : mot dans le badge, pastille d'alertes chiffrée, traits de graphique en trois styles, barres de signal sur les boutons de ventilateur.
- `ok` (vert) et `crit` (rouge) n'atteignent pas 3:1 l'un contre l'autre : leur distinction repose sur le mot, le badge et l'icône qui les accompagnent. Un thème « daltonien » (succès en bleu) est à ajouter si le public l'exige.

## Intégration en code

1. Charger `tokens.css` (généré à partir de `tokens.json`) puis `components/bundle.css`.
2. Poser `data-theme="dark"` ou `data-theme="light"` sur l'élément racine de la fenêtre ; les variables `--bg`, `--surface-*`, `--text*`, `--accent`, `--ok`, `--warn`, `--crit`, `--space-*`, `--radius-*`, `--shadow-*` suivent.
3. Les polices Barlow et JetBrains Mono viennent de Google Fonts dans les aperçus ; les embarquer en fichiers (`fonts/`) dans l'application, qui ne doit pas dépendre du réseau.
4. `components/bundle.js` expose `window.SysWatch` : constructeurs de jauges, barres, graphique temps réel, éditeur de courbe, tableau de processus et contrôle de ventilateurs, en JavaScript pur. Il sert de référence de comportement ; recréer les composants dans la pile de l'application (Tauri/React, Qt, GTK) à partir des tokens.
