"use client";

import { useCallback, useEffect, useState } from "react";
import { getBridge, type CompetencesAgent, type ContexteConnaissances, type EntreeConsommation, type MemoireAgent } from "@/lib/bridge";
import { dossierDeConversation } from "@/lib/dossier-conversation";
import type { Chat, Project } from "@/types/domain";

/*
 * Ce que le panneau lit de l'agent par le process principal : sa mémoire et ses compétences dans le
 * dossier de la conversation, sa consommation dans le journal. Rien n'est gardé sur le disque par l'écran.
 */

/**
 * Le dossier où la conversation fait travailler l'agent. Sur un VPS : le serveur (`lieu`) et le dossier du
 * projet là-bas, comme pour l'envoi d'un message (cf. `dossierVps` dans workspace.tsx).
 */
export function contexteDe(chat: Chat, projet: Project | undefined, agentId: string): ContexteConnaissances {
  const sessionId = chat.sessions[agentId] ?? null;
  const { dossier, dossierVps } = dossierDeConversation(chat, projet);
  if (chat.lieu) return { dossier: dossierVps, sessionId, lieu: chat.lieu };
  return { dossier, sessionId };
}

type Lecture<T> = { etat: "chargement" } | { etat: "pret"; valeur: T } | { etat: "erreur"; message: string } | { etat: "indisponible" };

/** La mémoire de l'agent (null : il n'en a pas), sur ce PC ou sur le VPS de la conversation ; relue à la demande et quand `cle` change (fin d'un travail…). */
export function useMemoireAgent(agentId: string, contexte: ContexteConnaissances | null, cle: unknown) {
  const [lecture, setLecture] = useState<Lecture<MemoireAgent | null>>({ etat: "chargement" });
  const dossier = contexte?.dossier ?? null;
  const sessionId = contexte?.sessionId ?? null;
  const lieu = contexte?.lieu ?? null;
  const disponible = contexte !== null;
  const [tour, setTour] = useState(0);
  const actualiser = useCallback(() => setTour((t) => t + 1), []);

  useEffect(() => {
    const lire = getBridge()?.agents?.memoire;
    let actif = true;
    if (!disponible || !lire) {
      queueMicrotask(() => actif && setLecture({ etat: "indisponible" }));
      return () => {
        actif = false;
      };
    }
    void lire(agentId, lieu ? { dossier, sessionId, lieu } : { dossier, sessionId }).then((r) => {
      if (!actif) return;
      setLecture(r.ok ? { etat: "pret", valeur: r.data } : { etat: "erreur", message: r.message });
    });
    return () => {
      actif = false;
    };
  }, [agentId, dossier, sessionId, lieu, disponible, cle, tour]);

  return { lecture, actualiser };
}

/**
 * Ses compétences : celles de sa fiche, du projet et du poste (ou du VPS de la conversation, lues là-bas) ;
 * relues quand `cle` change (fiche réécrite).
 */
export function useCompetencesAgent(agentId: string, contexte: ContexteConnaissances | null, cle?: unknown) {
  const [lecture, setLecture] = useState<Lecture<CompetencesAgent>>({ etat: "chargement" });
  const dossier = contexte?.dossier ?? null;
  const lieu = contexte?.lieu ?? null;
  const disponible = contexte !== null;
  useEffect(() => {
    const lire = getBridge()?.agents?.competences;
    let actif = true;
    if (!disponible || !lire) {
      queueMicrotask(() => actif && setLecture({ etat: "indisponible" }));
      return () => {
        actif = false;
      };
    }
    void lire(agentId, lieu ? { dossier, lieu } : { dossier }).then((r) => {
      if (actif) setLecture(r.ok ? { etat: "pret", valeur: r.data } : { etat: "erreur", message: r.message });
    });
    return () => {
      actif = false;
    };
  }, [agentId, dossier, lieu, disponible, cle]);
  return lecture;
}

/** Les appels de cet agent passés par l'app, d'après le journal de consommation (jamais d'estimation). */
export function useConsommationAgent(agentId: string) {
  const [lecture, setLecture] = useState<Lecture<EntreeConsommation[]>>({ etat: "chargement" });
  useEffect(() => {
    const lire = getBridge()?.consommation?.lire;
    let actif = true;
    if (!lire) {
      queueMicrotask(() => actif && setLecture({ etat: "indisponible" }));
      return () => {
        actif = false;
      };
    }
    void lire().then((r) => {
      if (!actif) return;
      setLecture(r.ok ? { etat: "pret", valeur: r.data.entrees.filter((e) => e.agent === agentId && e.klyra !== false) } : { etat: "erreur", message: r.message });
    });
    return () => {
      actif = false;
    };
  }, [agentId]);
  return lecture;
}

export type { Lecture };
