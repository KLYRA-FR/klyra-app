"use client";

import { useCallback, useEffect, useState } from "react";
import { getBridge, unwrap, type EtatMaj } from "@/lib/bridge";

/**
 * L'état de la mise à jour de l'app (electron/maj.ts), suivi en direct : le
 * rail en tire sa pastille « Mettre à jour », les Réglages leur section. Dans
 * un navigateur : null.
 */
export function useMaj() {
  const pont = getBridge()?.maj;
  const [etat, setEtat] = useState<EtatMaj | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!pont) return;
    let actif = true;
    void pont.etat().then((r) => actif && r.ok && setEtat(r.data));
    const arreter = pont.onEtat?.((e) => setEtat(e));
    // Une app d'avant `onEtat` : on relit de temps en temps.
    const minuteur = pont.onEtat ? null : window.setInterval(() => void pont.etat().then((r) => r.ok && setEtat(r.data)), 5000);
    return () => {
      actif = false;
      arreter?.();
      if (minuteur) window.clearInterval(minuteur);
    };
  }, [pont]);

  const rechercher = useCallback(async () => {
    if (!pont) return;
    setErreur(null);
    try {
      setEtat(unwrap(await pont.verifier()));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, [pont]);

  const installer = useCallback(async () => {
    if (!pont) return;
    setErreur(null);
    const r = await pont.installer();
    if (!r.ok) setErreur(r.message);
  }, [pont]);

  return { etat, erreur, rechercher, installer, disponible: !!pont };
}
