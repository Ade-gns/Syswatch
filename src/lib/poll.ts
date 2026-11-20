// Données lues à la demande (processus, démarrage) : un appel immédiat, puis toutes les
// `ms` millisecondes tant que le composant est affiché et la fenêtre visible.
import { useCallback, useEffect, useRef, useState } from 'react';
import { errText } from './api';

export function usePoll<T>(fn: () => Promise<T>, ms: number | null, key = '') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      if (document.visibilityState === 'visible') await refresh();
      if (alive && ms != null) timer = window.setTimeout(tick, ms);
    };
    tick();
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms, key, refresh]);

  return { data, error, refresh };
}
