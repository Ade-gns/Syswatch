// Fenêtres flottantes — maquette « CompactOverlay » : widget compact toujours visible
// (barre, carte, pastille) et overlay FPS du mode jeu (standard, minimal, détaillé).
// Fond translucide `overlay-bg`, pas de focus, clic traversant (géré par le backend).
// Un FPS sous la cible s'affiche avec le point `warn` ET la mention « sous la cible ».
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { Bar, Spark } from '../components/Gauges';
import { Icon } from '../components/Icon';
import { be, inTauri } from '../lib/api';
import { bytes, NBSP, num, rate, rateStr, tempStr } from '../lib/format';
import { mainGpu } from '../lib/gpu';
import { level, THRESHOLDS, type Level } from '../lib/levels';
import { useSettings } from '../lib/settings';
import { tail, useLive } from '../lib/store';
import type { Snapshot, SystemInfo } from '../lib/types';

const Dot = ({ l }: { l: Level }) => <i className={`sw-dot l-${l}`} />;

/** Ajuste la fenêtre à son contenu, puis la replace dans son coin. */
function useFitWindow(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !inTauri) return;
    let last = '';
    const fit = () => {
      const r = el.getBoundingClientRect();
      const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`;
      if (key === last) return;
      last = key;
      const w = getCurrentWindow();
      w.setSize(new LogicalSize(Math.ceil(r.width), Math.ceil(r.height))).then(() => be().reposition(w.label));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [dep]);
  return ref;
}

interface Values {
  cpu: number;
  cpuT: number | null;
  gpu: number | null;
  gpuT: number | null;
  ram: number;
  disk: number | null;
}

function values(s: Snapshot, info: SystemInfo): Values {
  const g = mainGpu(info, s)?.snap;
  const mounts = s.disks.flatMap(d => d.mounts);
  const m = mounts.find(x => x.targets.includes('/home')) ?? mounts.find(x => x.targets.includes('/'));
  return {
    cpu: s.cpu.usage,
    cpuT: s.cpu.tempC,
    gpu: g?.state === 'active' ? g.usage : null,
    gpuT: g?.state === 'active' ? g.tempC : null,
    ram: s.memory.total ? (s.memory.used / s.memory.total) * 100 : 0,
    disk: m && m.total ? (m.used / m.total) * 100 : null,
  };
}

function Frame({ children, opacity = 1, dep }: { children: ReactNode; opacity?: number; dep: unknown }) {
  const ref = useFitWindow(dep);
  return <div className="sw-float" ref={ref} style={{ opacity }}>{children}</div>;
}

/* ---------- Widget compact ---------- */

export function WidgetApp() {
  const { snap, info } = useLive();
  const { widget, tempUnit } = useSettings();
  if (!snap || !info) return null;
  const v = values(snap, info);
  const pct = (x: number) => `${num(x)}${NBSP}%`;
  const [rx, rxu] = rate(snap.network.rxBps);

  if (widget.style === 'card') {
    const ln = (n: string, p: number | null, th = THRESHOLDS.load) => (
      <div className={`ln l-${p == null ? 'ok' : level(p, th)}`}>
        <span>{n}</span><Bar pct={p ?? 0} th={th} ticks={false} h={5} /><span>{p == null ? '—' : pct(p)}</span>
      </div>
    );
    return (
      <Frame opacity={widget.opacity / 100} dep={widget.style}>
        <div className="sw-cmp card">
          <div className="hd"><span>SysWatch</span>{v.cpuT != null && <span><Icon name="temp" size={12} /> {tempStr(v.cpuT, tempUnit)}</span>}</div>
          {ln('CPU', v.cpu)}
          {ln('GPU', v.gpu)}
          {ln('RAM', v.ram)}
          {v.disk != null && ln('DSK', v.disk, THRESHOLDS.disk)}
        </div>
      </Frame>
    );
  }
  if (widget.style === 'pill') {
    return (
      <Frame opacity={widget.opacity / 100} dep={widget.style}>
        <div className="sw-pills">
          <div className="sw-cmp pill"><Dot l={level(v.cpu)} />CPU {pct(v.cpu)}{v.cpuT != null && ` · ${tempStr(v.cpuT, tempUnit)}`}</div>
          <div className="sw-cmp pill"><Dot l={level(v.ram)} />RAM {pct(v.ram)}</div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame opacity={widget.opacity / 100} dep={widget.style}>
      <div className="sw-cmp bar">
        <span><Dot l={level(v.cpu)} />CPU <b>{pct(v.cpu)}</b></span>
        {v.gpu != null && <span><Dot l={level(v.gpu)} />GPU <b>{pct(v.gpu)}</b></span>}
        <span><Dot l={level(v.ram)} />RAM <b>{pct(v.ram)}</b></span>
        <span><Icon name="down" size={13} /><b>{rx}</b><small>{rxu}</small></span>
      </div>
    </Frame>
  );
}

/* ---------- Overlay du mode jeu ---------- */

export function OverlayApp() {
  const { snap, info, get } = useLive();
  const { overlay, tempUnit } = useSettings();
  if (!snap || !info) return null;
  const v = values(snap, info);
  const f = snap.fps;
  const has = (i: string) => overlay.items.includes(i as never);
  const low = f != null && f.fps < overlay.fpsTarget;
  const fl: Level = f == null ? 'ok' : low ? 'warn' : 'ok';
  const g = mainGpu(info, snap)?.snap;
  const t = (x: number | null) => (has('temp') && x != null ? ` · ${tempStr(x, tempUnit)}` : '');
  const gb = (b: number) => bytes(b)[0];

  if (overlay.style === 'minimal') {
    return (
      <Frame dep={overlay.style}>
        <div className="sw-cmp pill sw-fps-min"><Dot l={fl} /><b>{f ? num(f.fps) : '—'}</b> FPS{low && <span className="sw-sec"> · sous la cible</span>}</div>
      </Frame>
    );
  }
  const detailed = overlay.style === 'detailed';
  const rows: [string, string][] = [];
  if (has('cpu')) rows.push(['CPU', `${num(v.cpu)} %${t(v.cpuT)}`]);
  if (has('gpu') && v.gpu != null) rows.push(['GPU', `${num(v.gpu)} %${t(v.gpuT)}`]);
  if (has('ram')) rows.push(['RAM', `${gb(snap.memory.used)} / ${bytes(snap.memory.total, { trim: true }).join(NBSP)}`]);
  if (has('vram') && g?.vramUsed != null && g.vramTotal) rows.push(['VRAM', `${gb(g.vramUsed)} / ${bytes(g.vramTotal, { trim: true }).join(NBSP)}`]);
  if (has('net') || detailed) rows.push(['Réseau', `↓ ${rateStr(snap.network.rxBps)}${snap.network.pingMs != null ? ` · ${num(snap.network.pingMs)} ms` : ''}`]);
  if (has('battery') && snap.batteries[0]) rows.push(['Batterie', `${num(snap.batteries[0].percent)} %`]);

  return (
    <Frame dep={`${overlay.style}${rows.length}${!!f}`}>
      <div className="sw-cmp sw-fps" style={{ width: detailed ? 272 : 218 }}>
        {has('fps') && (
          <>
            <div className={`big l-${fl}`}>
              <b>{f ? num(f.fps) : '—'}</b><span>FPS</span>
              {low && <span className="sw-below"><Dot l="warn" />sous la cible {overlay.fpsTarget}</span>}
            </div>
            {detailed && f && <div className={`l-${fl}`} style={{ margin: '6px 0 2px' }}><Spark values={tail(get('frametime'), 60)} min={0} h={38} /></div>}
            <div className="ft">
              {f ? (
                detailed
                  ? <><span>Temps de trame {num(f.frametimeMs, 1)} ms</span>{f.frametimePeakMs != null && <span>pic {num(f.frametimePeakMs)} ms</span>}</>
                  : <><span>{num(f.frametimeMs, 1)} ms</span>{f.low1 != null && <span>1 % bas {num(f.low1)}</span>}</>
              ) : <span>Aucun jeu détecté (MangoHud)</span>}
            </div>
            {rows.length > 0 && <hr />}
          </>
        )}
        {rows.map(([k, val]) => <div className="rw" key={k}><span>{k}</span><span>{val}</span></div>)}
      </div>
    </Frame>
  );
}
