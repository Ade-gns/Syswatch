/* @ds-bundle: {"format":4,"namespace":"SysWatch","components":[]} */
(function () {
'use strict';
const SW = {};

/* ---------- Icônes (24×24, trait 1,8) ---------- */
const I = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  gpu: '<rect x="2" y="6" width="20" height="11" rx="2"/><circle cx="9" cy="11.5" r="3"/><path d="M15 9.5h4M15 13.5h4M6 20h12"/>',
  ram: '<rect x="2" y="7" width="20" height="9" rx="1.5"/><path d="M6 10.5v2M10 10.5v2M14 10.5v2M18 10.5v2M6 16v2M10 16v2M14 16v2M18 16v2"/>',
  disk: '<rect x="3" y="12" width="18" height="8" rx="2"/><path d="M5 12l2.2-7h9.6L19 12"/><path d="M16.5 16h.01M13.5 16h.01"/>',
  net: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  proc: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bat: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 10.5v3M10 10.5v3"/>',
  fan: '<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4C12 6 13 3 15.5 3S18 6 12 10.4z"/><path d="M12 10.4C12 6 13 3 15.5 3S18 6 12 10.4z" transform="rotate(120 12 12)"/><path d="M12 10.4C12 6 13 3 15.5 3S18 6 12 10.4z" transform="rotate(240 12 12)"/>',
  boot: '<path d="M12 3v8M6.3 6.6a8 8 0 1 0 11.4 0"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8zM10 21h4"/>',
  cog: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dots: '<path d="M6 12h.01M12 12h.01M18 12h.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  caret: '<path d="M7 10l5 5 5-5"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  temp: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  min: '<path d="M6 12h12"/>',
  max: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  resize: '<path d="M20 10L10 20M20 16l-4 4"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  wifi: '<path d="M3 9a14 14 0 0 1 18 0M6 12.5a9 9 0 0 1 12 0M9 16a4.5 4.5 0 0 1 6 0M12 19.5h.01"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10.5v4M5 12.5h4M16 11h.01M18.5 13.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  logo: '<path d="M2 13h4l2.5-7 4 13 3-9 1.5 3H22"/>'
};
SW.icon = (n, s) => `<svg class="sw-ic" width="${s || 18}" height="${s || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`;

/* ---------- Outils ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
SW.n = (v, d) => Number(v).toFixed(d == null ? 0 : d).replace('.', ',');
SW.level = (v, w, c) => { w = w == null ? 75 : w; c = c == null ? 90 : c; return v >= c ? 'crit' : v >= w ? 'warn' : 'ok'; };
SW.rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
SW.walk = (n, base, amp, seed, max) => { const r = SW.rng(seed || 1); let v = base; const o = []; max = max == null ? 100 : max; for (let i = 0; i < n; i++) { v += (r() - .5) * amp + (base - v) * .12; v = Math.max(0, Math.min(max, v)); o.push(v); } return o; };

SW.PAGES = [
  ['home', 'Accueil', 'home'], '|',
  ['cpu', 'CPU', 'cpu'], ['gpu', 'GPU', 'gpu'], ['ram', 'Mémoire', 'ram'], ['disk', 'Disques', 'disk'], ['net', 'Réseau', 'net'], '|',
  ['proc', 'Processus & apps', 'proc'], ['bat', 'Batterie', 'bat'], ['fan', 'Ventilateurs', 'fan'], ['boot', 'Démarrage', 'boot'], '|',
  ['alert', 'Alertes', 'bell'], ['cog', 'Paramètres', 'cog']
];

/* ---------- Primitives ---------- */
SW.spark = (v, o) => {
  o = o || {}; const w = o.w || 120, h = o.h || 32;
  let mn = o.min == null ? Math.min.apply(0, v) : o.min, mx = o.max == null ? Math.max.apply(0, v) : o.max; if (mx === mn) mx = mn + 1;
  const d = 'M' + v.map((y, i) => ((i / (v.length - 1)) * w).toFixed(1) + ' ' + (h - 2 - ((y - mn) / (mx - mn)) * (h - 4)).toFixed(1)).join('L');
  return `<svg class="sw-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px" aria-hidden="true"><path class="a" d="${d}L${w} ${h}L0 ${h}Z"/><path class="l" d="${d}"/></svg>`;
};
SW.ring = o => {
  const s = o.size || 80, sw = o.stroke || 8, r = (s - sw) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, o.pct)), l = SW.level(p, o.warn, o.crit);
  const txt = o.text == null ? SW.n(p) + '<small>%</small>' : o.text;
  return `<div class="sw-ring l-${l}" style="width:${s}px;height:${s}px" role="img" aria-label="${esc(o.label || '')} ${SW.n(p)} pour cent"><svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><circle class="rt" cx="${s / 2}" cy="${s / 2}" r="${r}" stroke-width="${sw}"/><circle class="rf" cx="${s / 2}" cy="${s / 2}" r="${r}" stroke-width="${sw}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p / 100)).toFixed(2)}" transform="rotate(-90 ${s / 2} ${s / 2})"/></svg><span class="c" style="font-size:${o.fs || Math.round(s / 5)}px">${txt}</span></div>`;
};
SW.bar = o => {
  const p = Math.max(0, Math.min(100, o.pct)), l = SW.level(p, o.warn, o.crit);
  const t = o.ticks === false ? '' : `<b style="left:${o.warn == null ? 75 : o.warn}%"></b><b style="left:${o.crit == null ? 90 : o.crit}%"></b>`;
  return `<div class="sw-bar l-${l}" style="height:${o.h || 8}px" role="img" aria-label="${SW.n(p)} pour cent"><i style="width:${p}%"></i>${t}</div>`;
};
SW.badge = (s, t) => `<span class="sw-badge s-${s}">${t}</span>`;
SW.metric = o => {
  const l = SW.level(o.pct, o.warn, o.crit);
  const sp = o.series ? SW.spark(o.series, { min: 0, max: 100, h: 30 }) : '';
  const val = `<div class="sw-val">${o.value}${o.unit ? `<small>${o.unit}</small>` : ''}</div>`;
  if (o.kind === 'text') {
    return `<div class="sw-card sw-metric bar l-${l}"><div class="t" style="display:flex;justify-content:space-between;align-items:baseline"><span class="sw-label">${o.label}</span><span class="sw-sec">${o.sub || ''}</span></div>${val}${sp}</div>`;
  }
  if ((o.kind || 'ring') === 'ring') {
    return `<div class="sw-card sw-metric l-${l}">${SW.ring({ pct: o.pct, size: 76, stroke: 8, warn: o.warn, crit: o.crit, label: o.label })}<div class="m"><div class="t"><span class="sw-label">${o.label}</span><span class="sw-sec">${o.sub || ''}</span></div>${val}${sp}</div></div>`;
  }
  return `<div class="sw-card sw-metric bar l-${l}"><div class="t" style="display:flex;justify-content:space-between;align-items:baseline"><span class="sw-label">${o.label}</span>${SW.badge(l === 'crit' ? 'crit' : l === 'warn' ? 'warn' : 'ok', l === 'crit' ? 'Critique' : l === 'warn' ? 'Attention' : 'Normal')}</div><div style="display:flex;justify-content:space-between;align-items:baseline">${val}<span class="sw-sec">${o.sub || ''}</span></div>${SW.bar(o)}</div>`;
};

/* ---------- Fenêtre ---------- */
SW.sidebar = (active, collapsed) => {
  let nav = '';
  SW.PAGES.forEach(p => {
    if (p === '|') { nav += '<div class="sw-nav-sep"></div>'; return; }
    nav += `<button class="sw-nav-i" type="button"${p[0] === active ? ' aria-current="page"' : ''} title="${esc(p[1])}">${SW.icon(p[2], 18)}<span class="l">${p[1]}</span>${p[0] === 'alert' ? '<span class="n" aria-label="2 alertes">2</span>' : ''}</button>`;
  });
  return `<nav class="sw-side" aria-label="Pages">${nav}<div class="sw-side-foot"><button class="sw-nav-i" type="button" data-act="collapse" title="Replier la barre latérale">${SW.icon('panel', 18)}<span class="l">Replier</span></button><div class="sw-self" title="Mémoire utilisée par SysWatch lui-même">${SW.icon('ram', 14)}<span class="l">SysWatch&nbsp;</span><b>47 Mo</b></div></div></nav>`;
};
SW.head = (t, s, a) => `<header class="sw-head"><div><h1 class="sw-h1">${t}</h1><div class="sw-sub">${s || ''}</div></div><div class="sw-actions">${a || ''}</div></header>`;
SW.shell = o => `<div class="sw-app${o.collapsed ? ' is-collapsed' : ''}${o.edit ? ' is-edit' : ''}" data-theme="${o.theme || 'dark'}"><div class="sw-titlebar"><span class="sw-brand"><span class="sw-logo">${SW.icon('logo', 15)}</span>SysWatch</span><span class="sw-wc"><span>${SW.icon('min', 14)}</span><span>${SW.icon('max', 14)}</span><span>${SW.icon('x', 14)}</span></span></div><div class="sw-body">${SW.sidebar(o.active || 'home', o.collapsed)}<main class="sw-main">${o.head || ''}${o.body || ''}</main></div></div>`;
SW.switchEl = (on, label, extra) => `<button class="sw-switch" type="button" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}"${extra || ''}></button>`;
SW.seg = (items, cur, key) => `<div class="sw-seg" role="group">${items.map(i => `<button type="button" aria-pressed="${i[0] === cur}" data-v="${i[0]}"${key ? ` data-k="${key}"` : ''}>${i[2] ? SW.icon(i[2], 15) : ''}${i[1]}</button>`).join('')}</div>`;

/* ---------- Accent personnalisable ---------- */
SW.presets = [
  { id: 'cyan', name: 'Cyan', dark: '#00d4ff', light: '#006f8c' },
  { id: 'vert', name: 'Vert', dark: '#3ddc84', light: '#0b7d42' },
  { id: 'orange', name: 'Orange', dark: '#ff8a3d', light: '#b34700' },
  { id: 'rose', name: 'Rose', dark: '#ff5fa2', light: '#b8236b' },
  { id: 'violet', name: 'Violet', dark: '#b58cff', light: '#6b3fcc' }
];
const lum = h => { h = h.replace('#', ''); const c = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
SW.onColor = h => { const L = lum(h); return (L + .05) / .05 >= 1.05 / (L + .05) ? '#0a0c10' : '#ffffff'; };
SW.applyAccent = app => {
  const a = app.dataset.accent || 'cyan', th = app.getAttribute('data-theme') || 'dark', p = SW.presets.filter(x => x.id === a)[0], col = p ? p[th] : a;
  app.style.setProperty('--accent', col); app.style.setProperty('--on-accent', SW.onColor(col));
};

/* ---------- Interactions communes ---------- */
SW.wire = root => {
  root.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t || !root.contains(t)) return;
    if (t.dataset.act === 'collapse') { const a = t.closest('.sw-app, .sw-sidewrap'); if (a) a.classList.toggle('is-collapsed'); return; }
    if (t.classList.contains('sw-switch') && !t.hasAttribute('data-fc')) { t.setAttribute('aria-checked', t.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); return; }
    const seg = t.closest('.sw-seg, .sw-corner, .sw-swatches, [data-radio]');
    if (seg && t.hasAttribute('aria-pressed') && !t.hasAttribute('data-fc')) { seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === t ? 'true' : 'false')); }
  });
};
SW.mount = (root, html) => { root.innerHTML = html; SW.wire(root); return root.firstElementChild; };

/* ---------- Graphique temps réel ---------- */
SW.chart = (el, c) => {
  const n = c.n || 60, PL = 44, PR = 10, PT = 8, PB = 22;
  const S = c.series.map((s, i) => { const sd = s.seed || i + 1; const v = SW.walk(n, s.base, s.amp, sd, c.max || 1e9); return { s, v, r: SW.rng(sd * 7 + 3), last: v[n - 1] }; });
  let hi = -1;
  const ymax = () => { if (c.max) return c.max; let m = 1; S.forEach(o => o.v.forEach(x => { if (x > m) m = x; })); const need = m * 1.1 / 4, e = Math.pow(10, Math.floor(Math.log10(need))); const st = [1, 2, 2.5, 5, 10].map(k => k * e).filter(k => k >= need)[0]; return st * 4; };
  const fmt = (s, v) => s.fmt ? s.fmt(v) : SW.n(v, s.dec || 0) + ' ' + (s.unit != null ? s.unit : (c.unit || ''));
  function render() {
    const W = el.clientWidth || 640, H = c.h || el.clientHeight || 160, ym = ymax(), iw = W - PL - PR, ih = H - PT - PB;
    const X = i => PL + i / (n - 1) * iw, Y = v => PT + (1 - v / ym) * ih;
    let g = '';
    for (let k = 0; k <= 4; k++) { const y = PT + k / 4 * ih; g += `<line class="gl" x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}"/><text class="ax" x="${PL - 8}" y="${y + 4}" text-anchor="end">${SW.n(ym * (1 - k / 4), ym < 10 ? 1 : 0)}</text>`; }
    g += `<text class="ax" x="${PL}" y="${H - 5}">−${n} s</text><text class="ax" x="${PL + iw / 2}" y="${H - 5}" text-anchor="middle">−${n / 2} s</text><text class="ax" x="${W - PR}" y="${H - 5}" text-anchor="end">maintenant</text>`;
    S.forEach((o, si) => {
      const d = 'M' + o.v.map((v, i) => X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('L');
      if (si === 0) g += `<path class="ar" d="${d}L${X(n - 1)} ${PT + ih}L${PL} ${PT + ih}Z" style="fill:${o.s.color}"/>`;
      g += `<path class="ln" d="${d}" style="stroke:${o.s.color}"${o.s.dash ? ` stroke-dasharray="${o.s.dash}"` : ''}/>`;
    });
    if (hi >= 0) { g += `<line class="cur" x1="${X(hi)}" x2="${X(hi)}" y1="${PT}" y2="${PT + ih}"/>`; S.forEach(o => { g += `<circle class="dot" cx="${X(hi)}" cy="${Y(o.v[hi])}" r="4.5" style="fill:${o.s.color}"/>`; }); }
    const old = el.querySelector('svg'); if (old) old.remove();
    el.insertAdjacentHTML('afterbegin', `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.label || 'Graphique temps réel')}">${g}</svg>`);
    let tip = el.querySelector('.sw-tip');
    if (hi >= 0) {
      if (!tip) { el.insertAdjacentHTML('beforeend', '<div class="sw-tip"></div>'); tip = el.querySelector('.sw-tip'); }
      tip.innerHTML = `<div class="tt">${hi === n - 1 ? 'maintenant' : 'il y a ' + (n - 1 - hi) + ' s'}</div>` + S.map(o => `<div class="r"><span><i style="--c:${o.s.color}"></i> ${esc(o.s.name)}</span><b>${fmt(o.s, o.v[hi])}</b></div>`).join('');
      const x = X(hi), tw = tip.offsetWidth; tip.style.left = (x + 14 + tw > W ? x - 14 - tw : x + 14) + 'px';
    } else if (tip) tip.remove();
  }
  function tick() { S.forEach(o => { const s = o.s; o.last += (o.r() - .5) * s.amp + (s.base - o.last) * .12; o.last = Math.max(0, Math.min(c.max || 1e9, o.last)); o.v.push(o.last); o.v.shift(); }); }
  el.addEventListener('mousemove', e => { const r = el.getBoundingClientRect(), W = el.clientWidth, x = (e.clientX - r.left) * (W / r.width); const i = Math.round((x - PL) / (W - PL - PR) * (n - 1)); const h = i < 0 || i > n - 1 ? -1 : i; if (h !== hi) { hi = h; render(); } });
  el.addEventListener('mouseleave', () => { hi = -1; render(); });
  render();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) { const t = setInterval(() => { if (!el.isConnected) { clearInterval(t); return; } if (hi >= 0) return; tick(); render(); }, c.every || 1000); }
  if (window.ResizeObserver) { let w0 = el.clientWidth; new ResizeObserver(() => { if (el.clientWidth !== w0) { w0 = el.clientWidth; render(); } }).observe(el); }
};

/* ---------- Éditeur de courbe température → vitesse ---------- */
SW.curve = (el, c) => {
  c = c || {};
  const W = 560, H = c.h || 280, PL = 46, PR = 16, PT = 14, PB = 30, X0 = 30, X1 = 100;
  const pts = (c.points || [[30, 20], [45, 28], [60, 45], [75, 75], [88, 100]]).map(p => p.slice());
  let temp = c.temp || 61, drag = -1, foc = -1;
  const sx = t => PL + (t - X0) / (X1 - X0) * (W - PL - PR), sy = p => PT + (1 - p / 100) * (H - PT - PB);
  const at = t => { if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / ((b[0] - a[0]) || 1); } return pts[pts.length - 1][1]; };
  el.innerHTML = `<div class="sw-curve"><svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Courbe température vers vitesse du ventilateur. Utilisez les flèches sur un point pour l'ajuster."></svg></div>`;
  const svg = el.querySelector('svg');
  function out() { const s = Math.round(at(temp)); if (c.onchange) c.onchange(s, pts); return s; }
  function render() {
    let g = '';
    for (let t = X0; t <= X1; t += 10) g += `<line class="gl" x1="${sx(t)}" x2="${sx(t)}" y1="${PT}" y2="${H - PB}"/><text class="ax" x="${sx(t)}" y="${H - 10}" text-anchor="middle">${t}°</text>`;
    for (let p = 0; p <= 100; p += 25) g += `<line class="gl" x1="${PL}" x2="${W - PR}" y1="${sy(p)}" y2="${sy(p)}"/><text class="ax" x="${PL - 8}" y="${sy(p) + 4}" text-anchor="end">${p} %</text>`;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join('');
    const full = `M${sx(X0)} ${sy(pts[0][1])}${d.replace(/^M[^L]*/, '')}L${sx(X1)} ${sy(pts[pts.length - 1][1])}`;
    g += `<path class="fl" d="${full}L${sx(X1)} ${H - PB}L${sx(X0)} ${H - PB}Z"/><path class="cl" d="${full}"/>`;
    const s = Math.round(at(temp)), lx = sx(temp), ly = sy(at(temp)), tx = Math.min(Math.max(lx, PL + 66), W - PR - 66);
    g += `<line class="lv" x1="${lx}" x2="${lx}" y1="${PT}" y2="${H - PB}"/><circle class="lvd" cx="${lx}" cy="${ly}" r="5"/><g class="tg"><rect x="${tx - 62}" y="${PT + 2}" width="124" height="24" rx="6"/><text x="${tx}" y="${PT + 18}" text-anchor="middle">${temp} °C → ${s} %</text></g>`;
    pts.forEach((p, i) => { g += `<circle class="pt${drag === i ? ' on' : ''}" data-i="${i}" cx="${sx(p[0])}" cy="${sy(p[1])}" r="8" tabindex="0" role="slider" aria-label="Point ${i + 1} : ${p[0]} °C, ${p[1]} %" aria-valuenow="${p[1]}"/>`; });
    svg.innerHTML = g;
    if (foc >= 0) { const f = svg.querySelector(`[data-i="${foc}"]`); if (f) f.focus(); }
  }
  function setPt(i, t, p) {
    const lo = i ? pts[i - 1] : [X0 - 2, 0], hi = i < pts.length - 1 ? pts[i + 1] : [X1 + 2, 100];
    pts[i][0] = Math.round(Math.max(lo[0] + 2, Math.min(hi[0] - 2, t, X1))); pts[i][0] = Math.max(X0, pts[i][0]);
    pts[i][1] = Math.round(Math.max(lo[1], Math.min(hi[1], p, 100)));
    render(); out();
  }
  svg.addEventListener('pointerdown', e => { const i = e.target.getAttribute && e.target.getAttribute('data-i'); if (i == null) return; drag = +i; foc = -1; svg.setPointerCapture(e.pointerId); e.preventDefault(); render(); });
  svg.addEventListener('pointermove', e => { if (drag < 0) return; const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H; setPt(drag, X0 + (x - PL) / (W - PL - PR) * (X1 - X0), 100 * (1 - (y - PT) / (H - PT - PB))); });
  const end = () => { if (drag >= 0) { drag = -1; render(); } };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', e => { const i = e.target.getAttribute && e.target.getAttribute('data-i'); if (i == null) return; const k = e.key, p = pts[+i]; let t = p[0], v = p[1]; if (k === 'ArrowLeft') t -= 1; else if (k === 'ArrowRight') t += 1; else if (k === 'ArrowUp') v += 5; else if (k === 'ArrowDown') v -= 5; else return; e.preventDefault(); foc = +i; setPt(+i, t, v); });
  svg.addEventListener('focusout', () => { foc = -1; });
  render(); out();
  return { setTemp(t) { temp = t; render(); return out(); } };
};

/* ---------- Contrôle des ventilateurs ---------- */
SW.fanControl = (el, o) => {
  o = o || {};
  const MAXR = 4800, st = { auto: true, lvl: 'moyen', autoSpeed: o.autoSpeed || 52 };
  const L = [['faible', 'Faible', 35, 1], ['moyen', 'Moyen', 60, 2], ['fort', 'Fort', 100, 3]];
  const speed = () => st.auto ? st.autoSpeed : L.filter(l => l[0] === st.lvl)[0][2];
  const sig = k => `<span class="sw-sig" aria-hidden="true">${[1, 2, 3].map(i => `<i${i <= k ? ' class="on"' : ''} style="height:${6 + i * 5}px"></i>`).join('')}</span>`;
  const fan = (nm, sp, rpm) => `<div class="sw-fan">${SW.ring({ pct: sp, size: 44, stroke: 5, text: '', label: nm })}<div><div class="nm">${nm}</div><div class="sw-sec">${SW.n(sp)} % de la vitesse max.</div></div><div class="sw-val md">${SW.n(rpm).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}<small>tr/min</small></div></div>`;
  function draw() {
    const sp = speed(), a = Math.round(MAXR * sp / 100 / 10) * 10, b = Math.round(MAXR * .92 * sp / 100 / 10) * 10;
    el.innerHTML = `<div class="sw-fc-auto"><div><div class="sw-h3">Mode automatique</div><div class="sw-sec">Suit la courbe température → vitesse</div></div>${SW.switchEl(st.auto, 'Mode automatique', ' data-fc="auto"')}</div>
<div class="sw-fanbtns" role="group" aria-label="Vitesse manuelle">${L.map(l => `<button type="button" class="sw-fanbtn" data-fc="${l[0]}" aria-pressed="${!st.auto && st.lvl === l[0]}">${sig(l[3])}<b>${l[1]}</b><span class="sw-sec">${l[2]} %</span></button>`).join('')}</div>
<div class="sw-fans">${fan('Ventilateur CPU', sp, a)}${fan('Ventilateur GPU', Math.round(sp * .92), b)}</div>`;
  }
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-fc]'); if (!t) return; const k = t.dataset.fc;
    if (k === 'auto') st.auto = !st.auto; else { st.auto = false; st.lvl = k; }
    draw(); if (o.onchange) o.onchange(st);
  });
  draw();
  return { setAuto(p) { st.autoSpeed = p; draw(); } };
};

/* ---------- Tableau des processus ---------- */
SW.PROCS = [
  { name: 'firefox', pid: 4128, t: 'app', cpu: 12.4, ram: 2310, disk: 0.3, net: 4.2 },
  { name: 'steam', pid: 3011, t: 'app', cpu: 6.1, ram: 612, disk: 1.2, net: 18.4 },
  { name: 'code', pid: 5530, t: 'app', cpu: 4.8, ram: 940, disk: 0.1, net: 0.0 },
  { name: 'kwin_wayland', pid: 1204, t: 'sys', cpu: 3.2, ram: 310, disk: 0.0, net: 0.0 },
  { name: 'plasmashell', pid: 1260, t: 'sys', cpu: 2.1, ram: 420, disk: 0.0, net: 0.0 },
  { name: 'discord', pid: 6102, t: 'app', cpu: 1.9, ram: 530, disk: 0.0, net: 0.2 },
  { name: 'pipewire', pid: 982, t: 'sys', cpu: 0.9, ram: 28, disk: 0.0, net: 0.0 },
  { name: 'spotify', pid: 6455, t: 'app', cpu: 0.8, ram: 380, disk: 0.0, net: 0.4 },
  { name: 'Xwayland', pid: 1301, t: 'sys', cpu: 0.6, ram: 96, disk: 0.0, net: 0.0 },
  { name: 'baloo_file', pid: 1822, t: 'sys', cpu: 0.4, ram: 52, disk: 3.1, net: 0.0 }
];
SW.procTable = (el, o) => {
  o = o || {};
  const rows = SW.PROCS.map(r => Object.assign({}, r)); let key = 'cpu', dir = -1, q = '', scope = 'app', arm = null, timer = 0;
  const cols = [['name', 'Nom', 0], ['cpu', 'CPU', 1], ['ram', 'RAM', 1], ['disk', 'Disque', 1], ['net', 'Réseau', 1]];
  const fm = v => v >= 1024 ? SW.n(v / 1024, 1) + ' Go' : SW.n(v) + ' Mo';
  el.innerHTML = `<div class="sw-ptool"><div class="sw-search">${SW.icon('search', 15)}<input class="sw-input" type="search" placeholder="Rechercher un processus" aria-label="Rechercher un processus"></div>${SW.seg([['app', 'Applications ouvertes'], ['all', 'Tous les processus']], 'app')}</div><div class="pb"></div>`;
  const pb = el.querySelector('.pb');
  function draw() {
    const list = rows.filter(r => (scope === 'all' || r.t === scope) && r.name.toLowerCase().includes(q)).sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
    pb.innerHTML = `<table class="sw-table"><thead><tr>${cols.map(c => `<th class="${c[2] ? 'n' : ''}"${c[0] === key ? ` aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-k="${c[0]}">${c[1]}${SW.icon('down', 12)}</button></th>`).join('')}<th></th></tr></thead><tbody>${list.map(r => {
      const lc = SW.level(r.cpu * 4), lr = SW.level(r.ram / 163.84);
      return `<tr><td><span class="sw-pn"><i>${esc(r.name.charAt(0))}</i>${esc(r.name)}<span class="p">${r.pid}</span></span></td><td class="n"><span class="sw-cell"><span class="l-${lc}">${SW.bar({ pct: Math.min(100, r.cpu * 4), ticks: false, h: 5 })}</span>${SW.n(r.cpu, 1)} %</span></td><td class="n"><span class="sw-cell"><span class="l-${lr}">${SW.bar({ pct: Math.min(100, r.ram / 163.84), ticks: false, h: 5 })}</span>${fm(r.ram)}</span></td><td class="n">${SW.n(r.disk, 1)} Mo/s</td><td class="n">${SW.n(r.net, 1)} Mo/s</td><td class="act"><button type="button" class="sw-btn sm dng${arm === r.pid ? ' on' : ''}" data-close="${r.pid}" aria-label="Fermer ${esc(r.name)}">${SW.icon('x', 12)}${arm === r.pid ? 'Confirmer' : 'Fermer'}</button></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  el.addEventListener('click', e => {
    const k = e.target.closest('[data-k]'), cl = e.target.closest('[data-close]'), sg = e.target.closest('.sw-seg button');
    if (k && k.closest('th')) { const nk = k.dataset.k; if (nk === key) dir = -dir; else { key = nk; dir = nk === 'name' ? 1 : -1; } draw(); }
    else if (cl) { const pid = +cl.dataset.close; if (arm === pid) { const i = rows.findIndex(r => r.pid === pid); if (i >= 0) rows.splice(i, 1); arm = null; } else { arm = pid; clearTimeout(timer); timer = setTimeout(() => { arm = null; draw(); }, 3000); } draw(); }
    else if (sg) { scope = sg.dataset.v; el.querySelectorAll('.sw-seg button').forEach(b => b.setAttribute('aria-pressed', b === sg ? 'true' : 'false')); draw(); }
  });
  el.querySelector('input').addEventListener('input', e => { q = e.target.value.toLowerCase(); draw(); });
  draw();
};

/* ---------- Pièces d'écran réutilisées ---------- */
SW.coreBars = vals => `<div class="sw-cores">${vals.map((v, i) => `<div class="sw-core l-${SW.level(v)}"><b>${Math.round(v)}</b><div class="tr"><i style="height:${Math.max(3, v)}%"></i></div><span>${i}</span></div>`).join('')}</div>`;
SW.kv = rows => `<div class="sw-kv">${rows.map(r => `<div><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}</div>`;
SW.card = (title, right, body, cls, style) => `<div class="sw-card ${cls || ''}"${style ? ` style="${style}"` : ''}><div class="sw-card-h"><span class="sw-label">${title}</span>${right || ''}</div>${body}</div>`;
SW.legend = items => `<div class="sw-leg">${items.map(i => `<span><i class="${i[2] || ''}" style="--c:${i[1]}"></i>${i[0]}</span>`).join('')}</div>`;

/* ---------- Page Accueil (normal / édition / clair) ---------- */
SW.home = edit => {
  const cpu = SW.walk(40, 34, 10, 3), gpu = SW.walk(40, 12, 6, 5), ram = SW.walk(40, 80, 3, 9), dl = SW.walk(40, 40, 14, 2, 200);
  const tools = () => edit ? `<div class="grip" title="Déplacer le widget">${SW.icon('dots', 16)}</div><button class="rm" type="button" aria-label="Retirer le widget">${SW.icon('x', 13)}</button><span class="rs" aria-hidden="true">${SW.icon('resize', 12)}</span>` : '';
  const W = (c, inner, x) => `<div class="sw-w ${c}${x ? ' ' + x : ''}">${inner}${tools()}</div>`;
  const m = W('c3', SW.metric({ label: 'CPU', pct: 34, value: '4,38', unit: 'GHz', sub: '61 °C', series: cpu })) +
    W('c3', SW.metric({ label: 'GPU', pct: 12, value: '48', unit: '°C', sub: 'VRAM 1,2 Go', series: gpu })) +
    W('c3', SW.metric({ label: 'Mémoire', pct: 82, value: '13,1', unit: 'Go', sub: '/ 16 Go', series: ram })) +
    W('c3', SW.metric({ kind: 'bar', label: 'Disque /home', pct: 91, warn: 80, crit: 90, value: '1,82', unit: 'To', sub: '/ 2 To' }));
  const chart = W('c8', SW.card('Activité en temps réel', SW.legend([['CPU', 'var(--accent)'], ['GPU', 'var(--series-2)', 'd'], ['Mémoire', 'var(--series-3)', 't']]), '<div class="sw-chart" id="home-chart" style="flex:1"></div>'));
  const netBody = `<div class="sw-net"><div><span class="sw-sec">${SW.icon('down', 13)} Réception</span><div class="sw-val md" style="font-size:24px;line-height:30px">42,8<small>Mo/s</small></div></div><div><span class="sw-sec">${SW.icon('up', 13)} Émission</span><div class="sw-val md" style="font-size:24px;line-height:30px">3,1<small>Mo/s</small></div></div></div><div class="l-ok">${SW.spark(dl, { min: 0, h: 44 })}</div><div class="sw-foot sw-sec"><span>Ping 14 ms</span><span>${SW.icon('wifi', 12)} Wi‑Fi 5 GHz · −52 dBm</span></div>`;
  const net = SW.card('Réseau', SW.badge('ok', 'Connecté'), netBody);
  const prow = (n, v) => `<div class="sw-row"><span>${n}</span><span class="l-ok">${SW.bar({ pct: v * 5, ticks: false, h: 6 })}</span><span class="sw-mono">${SW.n(v, 1)} %</span></div>`;
  const procs = SW.card('Top processus', '<span class="sw-sec">CPU</span>', `<div class="sw-rows">${prow('firefox', 12.4)}${prow('steam', 6.1)}${prow('code', 4.8)}${prow('kwin_wayland', 3.2)}${prow('plasmashell', 2.1)}</div>`);
  const trow = (n, v) => `<div class="sw-row"><span>${n}</span><span class="l-${SW.level(v, 65, 85)}">${SW.bar({ pct: v, warn: 65, crit: 85, ticks: false, h: 6 })}</span><span class="sw-mono">${v} °C</span></div>`;
  const temps = SW.card('Températures', SW.badge('warn', '1 en hausse'), `<div class="sw-rows">${trow('CPU', 61)}${trow('GPU', 48)}${trow('SSD NVMe', 69)}${trow('Carte mère', 52)}${trow('Batterie', 34)}</div>`);
  const arow = (s, ic, t, h) => `<div class="sw-alert-r s-${s}"><span class="ico">${SW.icon(ic, 15)}</span><span>${t}</span><span class="sw-sec">${h}</span></div>`;
  const alerts = SW.card('Alertes récentes', '<span class="sw-sec">aujourd’hui</span>', `<div class="sw-rows" style="justify-content:flex-start;gap:4px">${arow('crit', 'warn', 'Disque /home à 91 %', '10:02')}${arow('warn', 'temp', 'SSD NVMe à 69 °C', '09:47')}${arow('ok', 'fan', 'Profil ventilateurs : Jeu', '09:15')}</div>`);
  const rows = 'grid-template-rows:128px 232px 1fr';
  if (!edit) return `<div class="sw-grid" style="${rows}">${m}${chart}${W('c4', net)}${W('c4', procs)}${W('c4', temps)}${W('c4', alerts)}</div>`;
  const drop = `<div class="sw-cell-slot c4"><div class="sw-slot">Déposer ici</div>${W('', net, 'is-drag')}</div>`;
  return `<div class="sw-grid" style="${rows}">${m}${chart}<div class="sw-slot ghost c4"></div>${W('c4', procs)}${W('c4', temps)}${drop}</div>`;
};
SW.catalog = () => {
  const it = [['cpu', 'CPU', '3×2'], ['gpu', 'GPU', '3×2'], ['ram', 'Mémoire', '3×2'], ['disk', 'Disque', '3×2'], ['bat', 'Batterie', '3×2'], ['fan', 'Ventilateurs', '4×3'], ['net', 'Ping & latence', '4×2'], ['clock', 'Temps de démarrage', '3×2']];
  return `<aside class="sw-panel" aria-label="Ajouter un widget"><div class="sw-card-h" style="margin:0"><span class="sw-label">Ajouter un widget</span></div><div class="sw-search" style="display:flex">${SW.icon('search', 15)}<input class="sw-input" style="width:100%;padding-left:32px;font-family:var(--font-ui)" placeholder="Filtrer" aria-label="Filtrer les widgets"></div>${it.map(i => `<div class="sw-cat"><span class="ico">${SW.icon(i[0], 18)}</span><div class="tx">${i[1]}<span>${i[2]} cellules</span></div><button class="sw-btn sm" type="button" aria-label="Ajouter ${i[1]}">${SW.icon('plus', 14)}</button></div>`).join('')}</aside>`;
};
SW.homeInit = root => {
  const el = root.querySelector('#home-chart'); if (!el) return;
  SW.chart(el, { label: 'Activité CPU, GPU et mémoire sur 60 secondes', max: 100, unit: '%', series: [
    { name: 'CPU', color: 'var(--accent)', base: 34, amp: 12, seed: 3 },
    { name: 'GPU', color: 'var(--series-2)', dash: '7 4', base: 12, amp: 8, seed: 5 },
    { name: 'Mémoire', color: 'var(--series-3)', dash: '2 4', base: 80, amp: 2, seed: 9 }] });
};
SW.homePage = (o) => {
  o = o || {};
  const edit = !!o.edit;
  const a = edit
    ? `<span class="sw-badge s-acc">Mode édition</span><button class="sw-btn" type="button">Réinitialiser</button><button class="sw-btn pri" type="button">${SW.icon('check', 15)}Terminer</button>`
    : `<span class="sw-inl">${SW.icon('game', 16)} Mode jeu ${SW.switchEl(false, 'Mode jeu')}</span><button class="sw-btn" type="button">${SW.icon('edit', 15)}Personnaliser</button>`;
  const head = SW.head('Accueil', edit ? 'Glissez, redimensionnez ou retirez les widgets' : 'CachyOS · allumé depuis 3 h 42 · mise à jour il y a 1 s', a);
  const body = edit ? `<div class="sw-edit-wrap">${SW.home(true)}${SW.catalog()}</div>` : SW.home(false);
  return SW.shell({ active: 'home', collapsed: edit, edit, theme: o.theme || 'dark', head, body });
};

window.SysWatch = SW;
})();
