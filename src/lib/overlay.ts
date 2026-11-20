// État « overlay du mode jeu affiché », partagé entre l'interrupteur « Mode jeu » de
// l'Accueil, l'icône de notification et le raccourci global (événement du backend).
import { useEffect, useState } from 'react';
import { be } from './api';

export function useOverlayShown(): [boolean, (v: boolean) => void] {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    be().getOverlayShown().then(setShown);
    be().onOverlayShown(setShown).then(f => (off = f));
    return () => off?.();
  }, []);
  return [shown, v => { setShown(v); be().setOverlayShown(v); }];
}
