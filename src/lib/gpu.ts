// Choix et libellés des GPU, partagés par la page GPU et l'Accueil.
import type { GpuInfo, GpuSnapshot, GpuState, SensorReading, Snapshot, SystemInfo } from './types';

/** Carte dédiée d'abord, puis GPU intégré. */
export const orderedGpus = (gpus: GpuInfo[]) => [...gpus].sort((a, b) => Number(a.integrated) - Number(b.integrated));

/** GPU affiché sur l'Accueil : la carte dédiée si elle est active, sinon le premier GPU actif. */
export function mainGpu(info: SystemInfo, snap: Snapshot): { info: GpuInfo; snap: GpuSnapshot } | null {
  const pairs = orderedGpus(info.gpus)
    .map(i => ({ info: i, snap: snap.gpus.find(s => s.id === i.id) }))
    .filter((p): p is { info: GpuInfo; snap: GpuSnapshot } => !!p.snap);
  return pairs.find(p => p.snap.state === 'active' && p.snap.usage != null) ?? pairs[0] ?? null;
}

export const gpuStateWord = (s: GpuState | undefined) => (s === 'sleeping' ? 'En veille' : s === 'active' ? 'Actif' : 'Indisponible');

/** Capteurs de température d'un GPU, retrouvés par leur libellé (« GPU intégré · … »). */
export function gpuSensors(sensors: SensorReading[], gi: GpuInfo) {
  return sensors.filter(s => s.kind === 'gpu' && s.label.startsWith('GPU intégré') === gi.integrated);
}
