"use client";

import { useMemo } from "react";
import { useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MODELES, useAgents } from "@/lib/agents";
import type { EtatBibliotheque, EtatDefinition } from "@/lib/bibliotheque";
import { getBridge, unwrap } from "@/lib/bridge";
import { messageErreur, useCompte } from "@/lib/compte";
import { lienDe } from "@/lib/lien-bibliotheque";
import { poste } from "@/lib/plateforme";
import { gestesAgents, type ChiffresEquipe, type DepsAgents } from "@/lib/telephone/gestes-agents";
import { useWorkspace } from "@/lib/workspace";
import type { Gestes } from "../types";

/** L'agent qui écrit les fiches : Lou (`prompty`), comme « Modifier avec Lou » du bureau. */
const LOU = "prompty";

const estAujourdhui = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

type BibliothequePoste = DepsAgents["bibliotheque"] & { etats: (ids: string[]) => Promise<Map<string, EtatDefinition>> };

/**
 * La Bibliothèque KLYRA vue de l'ordinateur pour le téléphone. `ServicePoste` est monté hors de
 * `BibliothequeProvider` : on lit le compte directement, au moment du geste, pour la session en cours.
 */
function useBibliothequePoste(): BibliothequePoste {
  const convex = useConvex();
  const { etat, moi } = useCompte();
  const moiId = etat === "connecte" ? (moi?._id ?? null) : null;
  return useMemo<BibliothequePoste>(() => {
    const traduire = (e: unknown) => new Error(messageErreur(e));
    return {
      get etat(): EtatBibliotheque {
        if (etat === "connecte") return convex.connectionState().isWebSocketConnected ? "pret" : "hors-ligne";
        return etat === "retire" ? "retire" : etat === "indisponible" ? "indisponible" : etat === "chargement" ? "chargement" : "deconnecte";
      },
      moiId,
      etats: async (ids) => {
        if (!moiId || !ids.length) return new Map();
        const r = await convex.query(api.bibliotheque.etats, { ids });
        return new Map(r.pour === moiId ? r.etats.map((e) => [e._id as string, e]) : []);
      },
      lire: async (definitionId) => {
        try {
          const r = await convex.query(api.bibliotheque.lire, { definitionId });
          return r.pour === moiId ? r.definition : null;
        } catch (e) {
          throw traduire(e);
        }
      },
      publier: async (p) => {
        try {
          return await convex.mutation(api.bibliotheque.publier, p);
        } catch (e) {
          throw traduire(e);
        }
      },
      mettreAJour: async (definitionId, versionAttendue, p) => {
        try {
          return await convex.mutation(api.bibliotheque.mettreAJour, { definitionId: definitionId as Id<"definitionsAgents">, versionAttendue, ...p });
        } catch (e) {
          throw traduire(e);
        }
      },
      retirer: async (definitionId) => {
        try {
          await convex.mutation(api.bibliotheque.retirer, { definitionId: definitionId as Id<"definitionsAgents"> });
        } catch (e) {
          throw traduire(e);
        }
      },
    };
  }, [convex, etat, moiId]);
}

/** Gestes « agents » que l'ordinateur fait pour le téléphone (T-08, T-09) : voir `gestesAgents`. */
export function useGestesAgents(): Gestes {
  const agents = useAgents();
  const { state, arreter } = useWorkspace();
  const bibliotheque = useBibliothequePoste();
  const bridge = getBridge();

  const chiffres = (): ChiffresEquipe => {
    const taches = state.messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "tasks" ? p.tasks : [])));
    return {
      agents: agents.roles.length - 1,
      chats: state.chats.length,
      chatsAujourdhui: state.chats.filter((c) => estAujourdhui(c.updatedAt)).length,
      projetsActifs: state.projects.filter((p) => p.status !== "livre").length,
      projets: state.projects.length,
      tachesEnCours: taches.filter((t) => t.status === "en-cours").length,
      tachesFaites: taches.filter((t) => t.status === "fait").length,
    };
  };

  return gestesAgents({
    ton: poste.ton,
    agents,
    fiches: async () => (bridge ? unwrap(await bridge.agents.list()).agents : []),
    liens: async () => {
      /* Les définitions liées à ce compte : celles des agents ajoutés ou publiés sous sa session. */
      const ids = new Set<string>();
      for (const e of Object.values(agents.mes?.agents ?? {})) {
        const o = e.origine;
        if ((o.type === "bibliotheque" || o.type === "copie") && o.compte === bibliotheque.moiId) ids.add(o.definitionId);
        if (o.type === "local" && o.publie?.compte === bibliotheque.moiId) ids.add(o.publie.definitionId);
      }
      const etats = await bibliotheque.etats([...ids].sort()).catch(() => new Map<string, EtatDefinition>());
      const session = { etat: bibliotheque.etat, moiId: bibliotheque.moiId, etats };
      return (agent) => lienDe(agent, session);
    },
    bibliotheque,
    modeles: MODELES,
    arreter: (id) => {
      for (const [chatId, travail] of Object.entries(state.travail)) if (travail.roleId === id) arreter(chatId);
    },
    enCours: (id) => Object.values(state.travail).some((t) => t.roleId === id),
    routinesDe: async (id) => {
      const r = await bridge?.routines?.lister(id);
      return r?.ok ? r.data.length : 0;
    },
    chiffres,
    lou: {
      blocage: async () => {
        if (!bridge) return `Lou travaille dans l’app de bureau, sur ${poste.ton}.`;
        const statut = await bridge.claude.status();
        if (!statut.ok || !statut.data.path) return `Claude Code est introuvable sur ${poste.ton}. Installe-le, puis réessaie.`;
        if (!agents.roles.some((r) => r.id === LOU && r.file)) return "Lou n’est pas dans tes agents. Ajoute-la depuis la Bibliothèque KLYRA (Modèles KLYRA), puis reviens ici.";
        return null;
      },
      lancer: async (requestId, prompt) => {
        if (!bridge) throw new Error(`Lou travaille dans l’app de bureau, sur ${poste.ton}.`);
        return unwrap(await bridge.claude.run(requestId, LOU, prompt));
      },
      annuler: (requestId) => void bridge?.claude.cancel(requestId),
    },
  });
}
