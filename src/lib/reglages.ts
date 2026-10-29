"use client";

import { useCallback, useEffect, useState } from "react";
import { getBridge, unwrap, type PreferencesNotifications, type Reglages } from "@/lib/bridge";

/**
 * Les réglages de l'app gardés par le process principal (electron/reglages.ts).
 * Dans un navigateur (pnpm dev), ils restent dans le localStorage : l'écran se
 * règle, mais rien ne part vers le système.
 */

export const REGLAGES_PAR_DEFAUT: Reglages = {
  notifications: { actives: true, pastille: true, son: true, agentFini: true, agentErreur: true, workflow: true, majPrete: true },
  computerUse: { actif: false },
};

const CLE_NAVIGATEUR = "klyra:reglages";

let cache: Reglages | null = null;
const abonnes = new Set<(r: Reglages) => void>();

function completer(brut: Partial<Reglages> | null | undefined): Reglages {
  return {
    notifications: { ...REGLAGES_PAR_DEFAUT.notifications, ...brut?.notifications },
    computerUse: { actif: brut?.computerUse?.actif === true },
  };
}

/** Les réglages actuels, lus une fois puis gardés en mémoire. */
export async function reglagesActuels(): Promise<Reglages> {
  if (cache) return cache;
  const pont = getBridge()?.reglages;
  try {
    cache = pont ? unwrap(await pont.lire()) : completer(JSON.parse(localStorage.getItem(CLE_NAVIGATEUR) ?? "null") as Reglages | null);
  } catch {
    cache = completer(null);
  }
  return cache;
}

async function enregistrer(reglages: Reglages): Promise<Reglages> {
  const pont = getBridge()?.reglages;
  const ecrits = pont ? unwrap(await pont.ecrire(reglages)) : reglages;
  if (!pont) localStorage.setItem(CLE_NAVIGATEUR, JSON.stringify(ecrits));
  cache = ecrits;
  abonnes.forEach((f) => f(ecrits));
  return ecrits;
}

/** Les réglages, et de quoi changer une préférence de notification. */
export function useReglages() {
  const [reglages, setReglages] = useState<Reglages | null>(cache);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    void reglagesActuels().then((r) => actif && setReglages(r));
    abonnes.add(setReglages);
    return () => {
      actif = false;
      abonnes.delete(setReglages);
    };
  }, []);

  const changerNotification = useCallback(async (cle: keyof PreferencesNotifications, valeur: boolean) => {
    const actuels = await reglagesActuels();
    setErreur(null);
    try {
      await enregistrer({ ...actuels, notifications: { ...actuels.notifications, [cle]: valeur } });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const changerComputerUse = useCallback(async (actif: boolean) => {
    const actuels = await reglagesActuels();
    setErreur(null);
    try {
      await enregistrer({ ...actuels, computerUse: { actif } });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { reglages, erreur, changerNotification, changerComputerUse, systeme: !!getBridge()?.reglages };
}
