"use client";

import { useCallback, useEffect, useState } from "react";
import { getBridge, unwrap, type PreferencesNotifications, type PreferencesSons, type Reglages } from "@/lib/bridge";
import { CONFIGURATION_PAR_DEFAUT, validerConfiguration, type ConfigurationKlyra } from "../../electron/configuration-klyra";
import { SKILLS_PAR_DEFAUT, validerSkillsParAgent, type SkillsParAgent } from "../../electron/skills-par-agent";

/**
 * Les réglages de l'app gardés par le process principal (electron/reglages.ts).
 * Dans un navigateur (pnpm dev), ils restent dans le localStorage : l'écran se
 * règle, mais rien ne part vers le système.
 */

export const REGLAGES_PAR_DEFAUT: Reglages = {
  notifications: { actives: true, pastille: true, son: true, agentFini: true, agentErreur: true, workflow: true, majPrete: true },
  computerUse: { actif: false },
  navigateur: { agents: true, moteur: "integre" },
  sons: { finDeTache: true, theme: "chaleureux", volume: 0.7 },
  configuration: CONFIGURATION_PAR_DEFAUT,
  skillsParAgent: SKILLS_PAR_DEFAUT,
};

const CLE_NAVIGATEUR = "klyra:reglages";

let cache: Reglages | null = null;
const abonnes = new Set<(r: Reglages) => void>();

function completer(brut: Partial<Reglages> | null | undefined): Reglages {
  return {
    notifications: { ...REGLAGES_PAR_DEFAUT.notifications, ...brut?.notifications },
    computerUse: { actif: brut?.computerUse?.actif === true },
    navigateur: { agents: brut?.navigateur?.agents !== false, moteur: brut?.navigateur?.moteur === "chrome" ? "chrome" : "integre" },
    sons: { ...REGLAGES_PAR_DEFAUT.sons, ...brut?.sons },
    configuration: validerConfiguration(brut?.configuration),
    skillsParAgent: validerSkillsParAgent(brut?.skillsParAgent),
  };
}

/** Suit les réglages enregistrés (le module de sons, hors React). Renvoie de quoi arrêter. */
export function surReglages(f: (r: Reglages) => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
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

  const changerNavigateur = useCallback(async (patch: Partial<Reglages["navigateur"]>) => {
    const actuels = await reglagesActuels();
    setErreur(null);
    try {
      await enregistrer({ ...actuels, navigateur: { ...actuels.navigateur, ...patch } });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const changerSons = useCallback(async (patch: Partial<PreferencesSons>) => {
    const actuels = await reglagesActuels();
    setErreur(null);
    try {
      await enregistrer({ ...actuels, sons: { ...actuels.sons, ...patch } });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** La configuration KLYRA : la carte l'adopte en un clic, chaque réglage se change aussi seul. */
  const changerConfiguration = useCallback(async (patch: Partial<ConfigurationKlyra>) => {
    const actuels = await reglagesActuels();
    setErreur(null);
    try {
      await enregistrer({ ...actuels, configuration: { ...actuels.configuration, ...patch } });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Les skills reçues par chaque agent. Faux si l'écriture a échoué (l'erreur est dans `erreur`). */
  const changerSkills = useCallback(async (skillsParAgent: SkillsParAgent): Promise<boolean> => {
    const actuels = await reglagesActuels();
    setErreur(null);
    try {
      await enregistrer({ ...actuels, skillsParAgent });
      return true;
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  return { reglages, erreur, changerNotification, changerComputerUse, changerNavigateur, changerSons, changerConfiguration, changerSkills, systeme: !!getBridge()?.reglages };
}
