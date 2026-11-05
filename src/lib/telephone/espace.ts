"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { roleAssistant, roleFromContent } from "@/lib/agents";
import { carteAgent } from "@/lib/copie-compte";
import { dansEspace, useLieuActif } from "@/lib/lieux";
import { lireEquipeServeur } from "@/lib/serveur-vps";
import type { AgentsMeta, MesAgents } from "@/lib/bridge";
import { idDirectDe } from "./chats";

/**
 * L'espace du serveur que ce téléphone a choisi (Plus › Serveurs). Chaque appareil retient le sien : celui de
 * l'ordinateur ne change rien ici. Les rappels et le calendrier restent communs : ils sont à la personne.
 */

/** Les conversations du compte, sur le serveur choisi. */
export function useConversationsEspace(actif = true) {
  const conversations = useQuery(api.conversationsCompte.liste, actif ? {} : "skip");
  const lieu = useLieuActif();
  return useMemo(() => conversations?.filter((c) => dansEspace(c.lieu, lieu)), [conversations, lieu]);
}

/** Les projets du compte, sur le serveur choisi. */
export function useProjetsEspace(actif = true) {
  const projets = useQuery(api.conversationsCompte.projets, actif ? {} : "skip");
  const lieu = useLieuActif();
  return useMemo(() => projets?.filter((p) => dansEspace(p.lieu, lieu)), [projets, lieu]);
}

/** La conversation directe avec un agent, sur le serveur choisi. */
export function useDirectEspace(): (roleId: string) => string {
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const lieu = useLieuActif();
  return (roleId) => idDirectDe(roleId, lieu, conversations ?? []);
}

/** Les cartes d'une équipe lue sur un VPS, comme celles que l'ordinateur copie dans le compte. */
export function cartesDeLEquipe(lue: { fiches: { name: string; content: string }[]; mes: MesAgents; meta: AgentsMeta }) {
  const fiches = lue.fiches.flatMap((f) => {
    const entree = lue.mes.agents[f.name];
    if (!entree) return [];
    return [carteAgent(roleFromContent(f.name, f.content, lue.meta, null), entree.actif)];
  });
  return [carteAgent(roleAssistant(lue.mes.assistant), true), ...fiches].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Les cartes des agents du serveur choisi : lues sur le VPS lui-même quand ce téléphone y est relié ; sinon, ou le
 * temps de les lire, rien plutôt que les agents d'un autre serveur. Sans réponse du VPS : celles du compte.
 */
export function useCartesEspace() {
  const compte = useQuery(api.conversationsCompte.agents, {});
  const lieu = useLieuActif();
  const [lues, setLues] = useState<{ lieu: string; cartes: ReturnType<typeof cartesDeLEquipe> | null } | null>(null);
  useEffect(() => {
    if (!lieu) return;
    let actif = true;
    void lireEquipeServeur(lieu).then((equipe) => {
      if (actif) setLues({ lieu, cartes: equipe ? cartesDeLEquipe(equipe) : null });
    });
    return () => {
      actif = false;
    };
  }, [lieu]);
  if (!lieu) return compte;
  if (lues?.lieu !== lieu) return undefined;
  return lues.cartes ?? compte;
}

/** Les routines du serveur choisi ; une nouvelle y va, quel que soit celui de l'ordinateur. */
export function routinesDeLEspace<T extends { routines: { lieu?: string | null }[]; lieu: string | null }>(lues: T | null, lieu: string | null): T | null {
  return lues && { ...lues, routines: lues.routines.filter((r) => dansEspace(r.lieu, lieu)), lieu };
}
