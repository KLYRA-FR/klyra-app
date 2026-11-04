"use client";

import { useAgents } from "@/lib/agents";
import { getBridge, unwrap } from "@/lib/bridge";
import { useCompteClaude } from "@/lib/compte-claude";
import { calculer } from "@/lib/consommation";
import { poste } from "@/lib/plateforme";
import { reglagesActuels, useReglages } from "@/lib/reglages";
import { tagLisible } from "@/lib/telephone/agents";
import { gestesReglages } from "@/lib/telephone/gestes-reglages";
import { useWorkspace } from "@/lib/workspace";
import type { Gestes } from "../types";

/**
 * Gestes « reglages » que l'ordinateur fait pour le téléphone (T-22) : voir `gestesReglages`.
 * Les changements passent par les mêmes fonctions que les Réglages du bureau.
 */
export function useGestesReglages(): Gestes {
  const { state, choisirAcces } = useWorkspace();
  const { roles, changerModele } = useAgents();
  const { changerNotification, changerComputerUse, changerSons } = useReglages();
  const { compte } = useCompteClaude();
  const bridge = getBridge();

  return gestesReglages({
    ton: poste.ton,
    acces: () => state.acces,
    choisirAcces,
    reglages: reglagesActuels,
    changerNotification,
    changerComputerUse,
    changerSonFinTache: (actif) => changerSons({ finDeTache: actif }),
    essaiNotification: async () => {
      if (!bridge?.reglages) throw new Error("Les notifications se règlent dans l’app de bureau.");
      unwrap(await bridge.reglages.essaiNotification());
    },
    autorisations: async () => {
      const r = await bridge?.reglages?.autorisationsComputerUse();
      return r?.ok ? r.data : null;
    },
    maj: async () => {
      const r = await bridge?.maj?.etat();
      return r?.ok ? r.data : null;
    },
    verifierMaj: async () => (bridge?.maj ? unwrap(await bridge.maj.verifier()) : null),
    claude: async () => {
      const r = await bridge?.claude.utilisation();
      return { compte, utilisation: r?.ok ? r.data : null };
    },
    consommation: async (vue) => {
      const r = await bridge?.consommation?.lire();
      if (!r?.ok) return null;
      const entrees = r.data.entrees.filter((e) => vue === "tout" || e.klyra !== false);
      const stats = calculer(state.messages, entrees);
      return {
        vue,
        jetons: stats.jetons,
        messages: stats.messages,
        joursActifs: stats.joursActifs,
        serieActuelle: stats.serieActuelle.jours,
        plusLongueSerie: stats.plusLongueSerie.jours,
        coutUsd: stats.coutUsd,
        modeles: stats.modeles.slice(0, 4).map((m) => ({ nom: m.nom, jetons: m.jetons })),
        depuis: r.data.depuis,
      };
    },
    agents: () => ({
      acces: state.acces,
      assistant: { nom: roles[0].name, teinte: roles[0].teinte },
      agents: roles.slice(1).map((r) => ({ id: r.id, nom: r.name, tag: tagLisible(r), teinte: r.teinte, modele: r.model || "inherit" })),
    }),
    changerModele,
  });
}
