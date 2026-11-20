// Synchronise les design tokens de « SysWatch design/ » vers l'application.
//  - src/styles/tokens.css : copie conforme du tokens.css du design (variables CSS, thèmes sombre/clair)
//  - src/styles/theme.css  : thème Tailwind v4 généré depuis tokens.json, qui pointe vers ces variables
//  - src/lib/tokens.gen.ts : préréglages d'accent et seuils utiles au code
// Ne pas éditer les fichiers générés : modifier le design puis relancer `npm run sync-tokens`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const design = join(root, 'SysWatch design');
const tokens = JSON.parse(readFileSync(join(design, 'tokens.json'), 'utf8'));
const out = p => { mkdirSync(dirname(join(root, p)), { recursive: true }); return join(root, p); };
const HEADER = '/* @generated par scripts/sync-tokens.mjs depuis « SysWatch design/ » — ne pas éditer */\n';

// 1. tokens.css tel quel
writeFileSync(out('src/styles/tokens.css'), HEADER + readFileSync(join(design, 'tokens.css'), 'utf8'));

// 2. Thème Tailwind. Les couleurs et ombres dépendent du thème : on référence la variable du design.
//    Espacements, rayons, polices et mise en page sont fixes : même valeur que tokens.css.
const L = [];
L.push('@theme {');
L.push('  --color-*: initial;', '  --radius-*: initial;', '  --shadow-*: initial;', '  --font-*: initial;');
L.push('  --spacing: 4px; /* grille de 4 px du design : p-4 = space-4 = 16 px */');
for (const t of tokens.color.tokens) L.push(`  --color-${t.name}: var(--${t.name});`);
for (const t of tokens.spacing.tokens) L.push(`  --spacing-${t.name.replace('space-', 's')}: ${t.value};`);
for (const t of tokens.radius.tokens) L.push(`  --radius-${t.name.replace('radius-', '')}: ${t.value};`);
for (const t of tokens.shadow.tokens) L.push(`  --shadow-${t.name.replace('shadow-', '')}: var(--${t.name});`);
for (const [k, v] of Object.entries(tokens.type.families)) L.push(`  --font-${k}: ${v};`);
for (const t of tokens.layout.tokens) L.push(`  --width-${t.name}: ${t.value};`);
L.push('}');
// Styles de texte : une classe utilitaire par style du design (text-title-page, text-label…)
for (const g of tokens.type.groups) for (const s of g.styles) {
  const fam = s.family || g.family;
  L.push(`@utility type-${s.name} {`,
    `  font-family: var(--font-${fam}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};`,
    `  letter-spacing: ${s.letterSpacing || 0};${s.name === 'label' ? ' text-transform: uppercase;' : ''}${fam === 'mono' ? ' font-variant-numeric: tabular-nums;' : ''}`,
    '}');
}
writeFileSync(out('src/styles/theme.css'), HEADER + L.join('\n') + '\n');

// 3. Préréglages d'accent (valeurs sombre / claire) pour le code TypeScript
const presets = tokens.color.tokens.filter(t => t.name.startsWith('preset-')).map(t => ({
  id: t.name.replace('preset-', ''),
  name: t.name.replace('preset-', '').replace(/^./, c => c.toUpperCase()),
  dark: t.value.dark, light: t.value.light,
}));
writeFileSync(out('src/lib/tokens.gen.ts'), HEADER.replace('/*', '//').replace(' */', '') +
  `export const ACCENT_PRESETS = ${JSON.stringify(presets, null, 2)} as const;\n`);

console.log(`tokens synchronisés : ${tokens.color.tokens.length} couleurs, ${presets.length} préréglages d'accent`);
