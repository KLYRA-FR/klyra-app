"use client";

import { contexteDe } from "@/components/chat/reglages-agent/donnees";
import { LOCAL } from "@/components/ui/Lien";
import { getBridge } from "@/lib/bridge";
import { moteurDe, PAR_DEFAUT } from "@/lib/fournisseurs";
import { lireCatalogueMoteurs } from "@/lib/moteurs";
import { useWorkspace } from "@/lib/workspace";
import { chaine, ErreurPoste, objet, type Gestes } from "../types";

const DECISIONS = ["oui", "toujours", "non"] as const;

/**
 * Gestes « fil » que l'ordinateur fait pour le téléphone (spec mobile T-01 à T-03) : arrêter l'agent
 * qui travaille, répondre à sa demande d'accord, dire où se voit l'aperçu du projet. Le téléphone
 * n'envoie qu'un id de conversation, de message et de demande, tous relus ici.
 */
export function useGestesFil(): Gestes {
  const { state, arreter, repondreAutorisation } = useWorkspace();
  const chatDe = (args: unknown) => {
    const id = chaine(objet(args), "conversation", 200);
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) throw new ErreurPoste("introuvable", "Cette conversation n’est plus sur l’ordinateur.");
    return chat;
  };
  return {
    "fil.modeles": async (args) => {
      const a = objet(args);
      const id = chaine(a, "conversation", 200);
      const chat = state.chats.find((c) => c.id === id);
      return lireCatalogueMoteurs(chat?.lieu ?? null);
    },
    "fil.arreter": async (args) => {
      const conversation = chaine(objet(args), "conversation", 200);
      if (!state.travail[conversation]) throw new ErreurPoste("fini", "L’agent a déjà fini.");
      arreter(conversation);
      return { ok: true };
    },
    "fil.autoriser": async (args) => {
      const a = objet(args);
      const conversation = chaine(a, "conversation", 200);
      const messageId = chaine(a, "messageId", 200);
      const demandeId = chaine(a, "demandeId", 200);
      const decision = chaine(a, "decision", 20);
      if (!(DECISIONS as readonly string[]).includes(decision)) throw new ErreurPoste("arguments", "Demande illisible.");
      const message = state.messages.find((m) => m.id === messageId && m.chatId === conversation);
      const demande = message?.parts.find((p) => p.type === "autorisation" && p.id === demandeId);
      if (demande?.type !== "autorisation") throw new ErreurPoste("introuvable", "Cette demande n’existe plus.");
      if (demande.statut !== "attente") throw new ErreurPoste("deja", demande.statut === "acceptee" ? "Déjà accordé." : "Déjà refusé.");
      /* L'agent ne tourne plus (KLYRA relancée depuis) : sa demande ne peut plus être entendue (P-11). */
      if (state.travail[conversation]?.messageId !== messageId) throw new ErreurPoste("expiree", "Demande expirée : l’agent ne tourne plus.");
      repondreAutorisation(messageId, demandeId, decision as (typeof DECISIONS)[number]);
      return { ok: true };
    },
    /* La liste « / » du composeur (E2-32) : les mêmes skills que le composeur du bureau, noms et descriptions. */
    "fil.competences": async (args) => {
      const a = objet(args);
      const chat = chatDe(args);
      const agent = chaine(a, "agent", 200);
      const lire = getBridge()?.agents?.competences;
      const contexte = contexteDe(chat, state.projects.find((p) => p.id === chat.projectId), agent);
      if (!lire) throw new ErreurPoste("indisponible", "Les compétences ne se lisent pas ici.");
      const r = await lire(agent, contexte.lieu ? { dossier: contexte.dossier, lieu: contexte.lieu } : { dossier: contexte.dossier });
      if (!r.ok) throw new ErreurPoste("erreur", r.message);
      const { fiche, projet, poste, plugins } = r.data;
      const toutes = [...fiche.filter((s) => s.dossier), ...projet, ...poste, ...(plugins ?? [])];
      return { skills: toutes.map((s) => ({ nom: s.nom, description: s.description })), avecClaude: moteurDe(chat) === PAR_DEFAUT };
    },
    /* L'aperçu du projet (T-03) : une adresse publique s'ouvre sur le téléphone ; une adresse locale ne quitte pas l'ordinateur (P-8). */
    "fil.apercu": async (args) => {
      const chat = chatDe(args);
      const adresse = state.projects.find((p) => p.id === chat.projectId)?.previewUrl?.trim() ?? "";
      if (!adresse) return { adresse: null, locale: false };
      if (LOCAL.test(adresse) || !/^https:\/\/[^\s]+$/.test(adresse)) return { adresse: null, locale: true };
      return { adresse, locale: false };
    },
  };
}
