"use client";

import { useEffect, useRef } from "react";
import type { KlyraBridge } from "@/lib/bridge";
import type { Message } from "@/types/domain";
import type { Routine as RoutineMoteur, RoutineRun, RunReport } from "@/types/routines";

/**
 * Le relais entre le moteur des routines (process principal) et les conversations,
 * que l'interface tient. Le moteur décide quand une exécution part ; ici, elle est
 * postée comme un message de la personne dans la conversation de l'agent, par le
 * chemin habituel (file d'attente si l'agent travaille, puis Claude Code), et l'état
 * de la réponse remonte au moteur : en file, en cours, réussie, échouée.
 *
 * Une exécution déjà postée (même id, après un rechargement) n'est jamais postée deux fois.
 */

const RESULTAT_MAX = 4_000;

interface Options {
  /** null : le moteur n'est pas actif, rien n'est branché. */
  bridge: KlyraBridge | null;
  /** Les conversations sont lues sur le disque. */
  pret: boolean;
  messages: Message[];
  file: Record<string, { id: string; routineRun?: string }[]>;
  /** Poste la consigne dans la conversation de l'agent ; renvoie la conversation, ou null si l'agent n'existe plus. */
  poster: (run: RoutineRun, routine: RoutineMoteur | null) => string | null;
  /** L'état le plus récent (pas encore rendu). */
  lire: () => { messages: Message[]; file: Record<string, { id: string; routineRun?: string }[]> };
  retirerDeFile: (chatId: string, id: string) => void;
  texte: (message: Message) => string;
}

export function useLivraisonRoutines(options: Options) {
  const courantes = useRef(options);
  useEffect(() => {
    courantes.current = options;
  });
  /** Exécutions suivies : leur conversation et le dernier état envoyé au moteur. */
  const suivis = useRef(new Map<string, { chatId: string; etat: RunReport["state"] | null }>());

  const verifier = useRef((messages: Message[]) => {
    const routines = courantes.current.bridge?.routines;
    if (!routines) return;
    for (const [runId, suivi] of suivis.current) {
      const reponse = messages.findLast((m) => m.routineRun === runId && m.author.kind === "role");
      let rapport: RunReport;
      if (!reponse) rapport = { state: "queued", chatId: suivi.chatId };
      else if (reponse.statut === "en-cours") rapport = { state: "running", chatId: reponse.chatId, messageId: reponse.id };
      else if (reponse.statut === "erreur")
        rapport = {
          state: "failed",
          chatId: reponse.chatId,
          messageId: reponse.id,
          error: reponse.erreur || "L’agent s’est arrêté sur une erreur.",
        };
      else
        rapport = {
          state: "succeeded",
          chatId: reponse.chatId,
          messageId: reponse.id,
          result: courantes.current.texte(reponse).slice(0, RESULTAT_MAX),
        };
      if (rapport.state === suivi.etat) continue;
      suivi.etat = rapport.state;
      void routines.signaler(runId, rapport);
      if (rapport.state === "succeeded" || rapport.state === "failed") suivis.current.delete(runId);
    }
  });

  const { bridge, pret, messages, file } = options;
  useEffect(() => {
    const routines = bridge?.routines;
    if (!routines || !pret) return;
    const finLivrer = routines.onLivrer((run, routine) => {
      if (suivis.current.has(run.id)) return;
      const etat = courantes.current.lire();
      const dejaPostee = etat.messages.find((m) => m.routineRun === run.id && m.author.kind === "user");
      const enFile = Object.entries(etat.file).find(([, liste]) => liste.some((e) => e.routineRun === run.id));
      const chatId = dejaPostee?.chatId ?? enFile?.[0] ?? courantes.current.poster(run, routine);
      if (!chatId) {
        void routines.signaler(run.id, {
          state: "failed",
          chatId: null,
          messageId: null,
          error: `L’agent « ${run.agentId} » est introuvable dans l’app : la consigne n’a pas été envoyée.`,
        });
        return;
      }
      suivis.current.set(run.id, { chatId, etat: null });
      verifier.current(etat.messages);
    });
    const finAnnuler = routines.onAnnuler((run) => {
      suivis.current.delete(run.id);
      const etat = courantes.current.lire();
      for (const [chatId, liste] of Object.entries(etat.file)) {
        for (const e of liste) if (e.routineRun === run.id) courantes.current.retirerDeFile(chatId, e.id);
      }
      const reponse = etat.messages.find((m) => m.routineRun === run.id && m.author.kind === "role" && m.statut === "en-cours");
      if (reponse) void courantes.current.bridge?.claude.cancel(reponse.id);
    });
    // Le moteur renvoie alors ce qu'il avait confié avant un rechargement, puis ce qui attend.
    void routines.pret();
    return () => {
      finLivrer();
      finAnnuler();
    };
  }, [bridge, pret]);

  useEffect(() => {
    if (bridge?.routines && pret) verifier.current(messages);
  }, [bridge, pret, messages, file]);
}
