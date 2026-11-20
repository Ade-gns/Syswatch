// Page Accueil — maquettes « HomeScreen » (mode normal) et « HomeEditScreen » (édition).
// Mode édition : barre latérale repliée, bordures pointillées accent, poignée de
// déplacement en haut (`dots`), bouton de retrait rond, coin de redimensionnement, panneau
// « Ajouter un widget » de 264 px. Le widget saisi est soulevé (shadow-lift, bordure
// accent, léger incliné) au-dessus d'un emplacement « Déposer ici » ; sa place d'origine
// reste en pointillé gris. « Terminer » enregistre la disposition (~/.config/syswatch/
// layout.json), « Réinitialiser » revient à la grille par défaut.
// Clavier : sur une poignée, flèches = déplacer ; sur un coin, flèches = redimensionner.
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Empty } from '../components/Card';
import { Switch } from '../components/Controls';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Shell';
import { useAlerts } from '../lib/alerts';
import { be, errText } from '../lib/api';
import { setEditing } from '../lib/editMode';
import { duration, seconds } from '../lib/format';
import { add, compact, type Item, type Layout, move, remove, resize, ROW_PX, sanitize } from '../lib/grid';
import { useOverlayShown } from '../lib/overlay';
import { usePoll } from '../lib/poll';
import { useSettings } from '../lib/settings';
import { useLive } from '../lib/store';
import { CATALOG, type Ctx, DEFAULT_LAYOUT, WIDGETS } from '../home/widgets';

const GAP = 16;
const place = (i: Item): CSSProperties => ({ gridColumn: `${i.x + 1} / span ${i.w}`, gridRow: `${i.y + 1} / span ${i.h}` });

interface Drag {
  id: string;
  kind: 'move' | 'resize';
  orig: Item;
  base: Layout;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
}

export function HomePage() {
  const live = useLive();
  const { intervalMs, tempUnit } = useSettings();
  const { history } = useAlerts();
  const [gameMode, setGameMode] = useOverlayShown();
  const [layout, setLayout] = useState<Layout | null>(null);
  const [edit, setEdit] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const grid = useRef<HTMLDivElement>(null);

  // Disposition enregistrée, sinon celle de la maquette.
  useEffect(() => {
    be().getLayout().then(raw => setLayout(sanitize(raw, t => t in WIDGETS) ?? DEFAULT_LAYOUT)).catch(() => setLayout(DEFAULT_LAYOUT));
  }, []);
  useEffect(() => {
    setEditing(edit);
    return () => setEditing(false);
  }, [edit]);

  const types = new Set(layout?.map(i => i.type));
  const needProcs = types.has('procs');
  const procs = usePoll(() => (needProcs ? be().listProcesses(false) : Promise.resolve(null)), needProcs ? 2000 : null, String(needProcs)).data;
  const needBoot = types.has('boot');
  const startup = usePoll(() => (needBoot ? be().getStartup() : Promise.resolve(null)), null, String(needBoot)).data;

  const pitch = () => {
    const w = grid.current?.clientWidth ?? 1200;
    return { col: (w + GAP) / 12, row: ROW_PX + GAP };
  };
  // Pendant un geste : disposition provisoire (les autres widgets s'écartent).
  const preview = useMemo(() => {
    if (!drag || !layout) return layout;
    const p = pitch();
    const dc = Math.round(drag.dx / p.col), dr = Math.round(drag.dy / p.row);
    return drag.kind === 'move'
      ? move(drag.base, drag.id, drag.orig.x + dc, drag.orig.y + dr)
      : resize(drag.base, drag.id, drag.orig.w + dc, drag.orig.h + dr, WIDGETS[drag.orig.type].minH);
  }, [drag, layout]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => setDrag(d => (d ? { ...d, dx: e.clientX - d.sx, dy: e.clientY - d.sy } : d));
    const onUp = () => {
      setLayout(compact(preview ?? layout ?? []));
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, preview, layout]);

  const { snap, info } = live;
  if (!snap || !info || !layout) return <Empty>Lecture des capteurs…</Empty>;
  const ctx: Ctx = { ...live, snap, info, tempUnit, procs, alerts: history, startup };
  const shown = preview ?? layout;

  const start = (e: React.PointerEvent, it: Item, kind: Drag['kind']) => {
    e.preventDefault();
    setDrag({ id: it.id, kind, orig: it, base: layout, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 });
  };
  const keyMove = (e: React.KeyboardEvent, it: Item, kind: Drag['kind']) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!d[e.key]) return;
    e.preventDefault();
    const [dx, dy] = d[e.key];
    // Largeurs autorisées 3…8 puis 12 : de 8, « → » passe directement à 12.
    const dw = dx > 0 && it.w >= 8 ? 4 : dx < 0 && it.w === 12 ? -4 : dx;
    setLayout(compact(kind === 'move' ? move(layout, it.id, it.x + dx, it.y + dy) : resize(layout, it.id, it.w + dw, it.h + dy, WIDGETS[it.type].minH)));
  };
  const done = async () => {
    try {
      await be().saveLayout(layout);
      setErr(null);
      setEdit(false);
    } catch (e) {
      setErr(errText(e));
    }
  };

  const header = edit ? (
    <PageHeader title="Accueil" sub={err ?? 'Glissez, redimensionnez ou retirez les widgets'} actions={
      <>
        <Badge s="acc">Mode édition</Badge>
        <button className="sw-btn" type="button" onClick={() => setLayout(DEFAULT_LAYOUT)}>Réinitialiser</button>
        <button className="sw-btn pri" type="button" onClick={done}><Icon name="check" size={15} />Terminer</button>
      </>
    } />
  ) : (
    <PageHeader title="Accueil" sub={`${info.osName} · allumé depuis ${duration(snap.uptimeS)} · mise à jour toutes les ${seconds(intervalMs / 1000)}`} actions={
      <>
        <span className="sw-inl"><Icon name="game" size={16} /> Mode jeu <Switch on={gameMode} label="Mode jeu" onChange={setGameMode} /></span>
        <button className="sw-btn" type="button" onClick={() => setEdit(true)}><Icon name="edit" size={15} />Personnaliser</button>
      </>
    } />
  );

  const gridEl = (
    <div className="sw-grid sw-home" ref={grid} style={{ gridAutoRows: `${ROW_PX}px` }}>
      {drag?.kind === 'move' && <div className="sw-slot ghost" style={place(drag.orig)} />}
      {shown.map(it => {
        const def = WIDGETS[it.type];
        const body = def.render(ctx);
        const tools = edit && (
          <>
            <button type="button" className="grip" title="Déplacer le widget" aria-label={`Déplacer ${def.name} (flèches)`}
              onPointerDown={e => start(e, it, 'move')} onKeyDown={e => keyMove(e, it, 'move')}><Icon name="dots" size={16} /></button>
            <button type="button" className="rm" aria-label={`Retirer ${def.name}`} onClick={() => setLayout(remove(layout, it.id))}><Icon name="x" size={13} /></button>
            <button type="button" className="rs" aria-label={`Redimensionner ${def.name} (flèches)`}
              onPointerDown={e => start(e, it, 'resize')} onKeyDown={e => keyMove(e, it, 'resize')}><Icon name="resize" size={12} /></button>
          </>
        );
        if (drag?.kind === 'move' && drag.id === it.id) {
          const p = pitch();
          const tx = drag.dx - (it.x - drag.orig.x) * p.col, ty = drag.dy - (it.y - drag.orig.y) * p.row;
          return (
            <div key={it.id} className="sw-cell-slot" style={place(it)}>
              <div className="sw-slot">Déposer ici</div>
              <div className="sw-w is-drag" style={{ transform: `translate(${tx}px, ${ty}px) rotate(-1.2deg)` }}>{body}{tools}</div>
            </div>
          );
        }
        return <div key={it.id} className="sw-w" style={place(it)}>{body}{tools}</div>;
      })}
      {shown.length === 0 && <div className="sw-slot c12" style={{ gridRow: 'span 3' }}>Ajoutez des widgets depuis le panneau « Ajouter un widget »</div>}
    </div>
  );

  if (!edit) {
    return (
      <>
        {header}
        {gridEl}
      </>
    );
  }
  const needle = q.trim().toLowerCase();
  return (
    <>
      {header}
      <div className="sw-edit-wrap">
        {gridEl}
        <aside className="sw-panel" aria-label="Ajouter un widget">
          <div className="sw-card-h" style={{ margin: 0 }}><span className="sw-label">Ajouter un widget</span></div>
          <div className="sw-search" style={{ display: 'flex' }}>
            <Icon name="search" size={15} />
            <input className="sw-input" style={{ width: '100%', paddingLeft: 32, fontFamily: 'var(--font-ui)' }} placeholder="Filtrer" aria-label="Filtrer les widgets" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="sw-cats">
            {CATALOG.filter(t => WIDGETS[t].name.toLowerCase().includes(needle)).map(t => {
              const d = WIDGETS[t];
              return (
                <div className="sw-cat" key={t}>
                  <span className="ico"><Icon name={d.icon} size={18} /></span>
                  <div className="tx">{d.name}<span>{d.w}×{d.h} cellules</span></div>
                  <button className="sw-btn sm" type="button" aria-label={`Ajouter ${d.name}`} onClick={() => setLayout(compact(add(layout, t, d.w, d.h)))}><Icon name="plus" size={14} /></button>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </>
  );
}
