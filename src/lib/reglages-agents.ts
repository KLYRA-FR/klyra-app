"use client";

import { useCallback, useEffect, useState } from "react";
import { useAgents } from "@/lib/agents";
import { getBridge, unwrap } from "@/lib/bridge";
import { useLieuActif } from "@/lib/lieux";
import { useReglages } from "@/lib/reglages";
import { consigneKlyra, validerConfiguration, type ConfigurationKlyra } from "../../electron/configuration-klyra";
import { validerSkillsParAgent, type SkillsParAgent } from "../../electron/skills-par-agent";

export interface ReglagesAgents {
  configuration: ConfigurationKlyra;
  skillsParAgent: SkillsParAgent;
}

/**
 * Les réglages des agents du serveur affiché : la configuration KLYRA et les skills de chaque agent.
 * Ceux de ce PC par `useReglages`, ceux d'un VPS sur le VPS (`POST /klyra/v1/equipe/reglages`).
 * Un serveur pas encore à jour reçoit encore ceux de ce PC.
 * `lieuVoulu` : ceux d'un serveur précis (le VPS d'une conversation, null pour ce PC) plutôt que du serveur affiché.
 */
export function useReglagesAgents(lieuVoulu?: string | null) {
  const pc = useReglages();
  const actif = useLieuActif();
  const lieu = lieuVoulu === undefined ? actif : lieuVoulu;
  const { serveurAncien } = useAgents();
  /* `serveurAncien` ne parle que du serveur affiché. */
  const surVps = !!lieu && !(serveurAncien && lieu === actif) && !!getBridge()?.agents.vps;
  const [lus, setLus] = useState<{ lieu: string; reglages: ReglagesAgents } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const lire = (brut: unknown): ReglagesAgents => {
    const r = (brut ?? {}) as { configuration?: unknown; skillsParAgent?: unknown };
    return { configuration: validerConfiguration(r.configuration), skillsParAgent: validerSkillsParAgent(r.skillsParAgent) };
  };

  useEffect(() => {
    if (!surVps || !lieu) return;
    let actif = true;
    void getBridge()!.agents.vps!(lieu, "reglages", {}).then((r) => {
      if (!actif) return;
      try {
        setLus({ lieu, reglages: lire(unwrap(r)) });
        setErreur(null);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      actif = false;
    };
  }, [surVps, lieu]);

  /** Faux si l'écriture a échoué (l'erreur est dans `erreur`). */
  const ecrire = useCallback(
    async (corps: Record<string, unknown>): Promise<boolean> => {
      if (!lieu) return false;
      setErreur(null);
      try {
        setLus({ lieu, reglages: lire(unwrap(await getBridge()!.agents.vps!(lieu, "reglages-ecrire", corps))) });
        return true;
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [lieu],
  );

  const courants = surVps && lus?.lieu === lieu ? lus.reglages : null;
  const changerConfigurationVps = useCallback(
    async (patch: Partial<ConfigurationKlyra>) => {
      if (!courants) return;
      const suite = { ...courants.configuration, ...patch };
      await ecrire({
        /* Le VPS reçoit ce qu'il applique, et garde le choix de l'écran pour le relire. */
        configuration: { memoireAgents: suite.memoireAgents, consignes: consigneKlyra(suite.consignes) },
        configurationEcran: suite,
      });
    },
    [courants, ecrire],
  );
  const changerSkillsVps = useCallback((skillsParAgent: SkillsParAgent) => ecrire({ skillsParAgent }), [ecrire]);

  if (!surVps) return { lieu: null, reglages: pc.reglages, erreur: pc.erreur, changerConfiguration: pc.changerConfiguration, changerSkills: pc.changerSkills };
  return { lieu, reglages: courants, erreur, changerConfiguration: changerConfigurationVps, changerSkills: changerSkillsVps };
}
