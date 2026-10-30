"use client";

import { useEffect, useRef } from "react";
import type { KlyraBridge } from "@/lib/bridge";
import type { Message } from "@/types/domain";
import type { Routine, RoutineRun } from "@/types/routines";

interface Options {
  bridge: KlyraBridge | null;
  pret: boolean;
  messages: Message[];
  file: Record<string, { id: string; routineRun?: string }[]>;
  poster: (run: RoutineRun, routine: Routine | null) => string | null;
  lire: () => { messages: Message[]; file: Record<string, { id: string; routineRun?: string }[]> };
  retirerDeFile: (chatId: string, id: string) => void;
  texte: (message: Message) => string;
}

/**
 * Transport vers la conversation. Electron réserve durablement le run avant
 * Claude et observe lui-même son résultat : le rendu ne prouve aucun lancement.
 */
export function useLivraisonRoutines(options: Options) {
  const courantes = useRef(options);
  useEffect(() => { courantes.current = options; });
  const livrees = useRef(new Set<string>());
  const { bridge, pret } = options;
  useEffect(() => {
    const routines = bridge?.routines;
    if (!routines || !pret) return;
    const finLivrer = routines.onLivrer((run, routine) => {
      if (livrees.current.has(run.id)) return;
      livrees.current.add(run.id);
      const etat = courantes.current.lire();
      const enFile = Object.entries(etat.file).find(([, liste]) => liste.some((e) => e.routineRun === run.id));
      // Une consigne persistée sans claim n'a pas été envoyée. Elle reprend avec
      // les mêmes ids de messages ; l'upsert et le claim empêchent tout doublon.
      const chatId = enFile?.[0] ?? courantes.current.poster(run, routine);
      void routines.signaler(run.id, chatId
        ? { state: "queued", chatId }
        : { state: "failed", chatId: null, messageId: null, error: `L’agent « ${run.agentId} » est absent ou désactivé : la consigne n’a pas été envoyée.` });
    });
    const finAnnuler = routines.onAnnuler((run) => {
      const etat = courantes.current.lire();
      for (const [chatId, liste] of Object.entries(etat.file)) {
        for (const e of liste) if (e.routineRun === run.id) courantes.current.retirerDeFile(chatId, e.id);
      }
      // Le main arrête aussi Claude avant de prévenir la fenêtre.
      const reponse = etat.messages.find((m) => m.routineRun === run.id && m.author.kind === "role" && m.statut === "en-cours");
      if (reponse) void bridge.claude.cancel(reponse.id);
    });
    void routines.pret();
    return () => { finLivrer(); finAnnuler(); };
  }, [bridge, pret]);
}
