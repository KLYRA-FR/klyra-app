"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { useIdDirect } from "@/lib/workspace";

/** Le début de la demande, que la personne complète avant d'envoyer (spec §9.2). */
export const DEBUT_DEMANDE_AGENT = "Aide-moi à créer un agent qui ";

/** Le début d'une demande d'équipe : l'assistant mène l'atelier d'équipe (proposer_equipe). */
export const DEBUT_DEMANDE_EQUIPE = "Aide-moi à composer mon équipe d’agents pour ";

/**
 * « Le décrire à Sam » : ouvre la conversation de l'assistant (`dm-principal`)
 * avec « Aide-moi à créer un agent qui » dans le composeur, curseur à la fin.
 * Rien n'est envoyé ; un brouillon déjà là est gardé, la demande s'ajoute à la ligne.
 */
export function useDecrireAAssistant(debut: string = DEBUT_DEMANDE_AGENT): () => void {
  const router = useRouter();
  const idDirect = useIdDirect();
  return useCallback(() => {
    const chatId = idDirect("principal");
    ajouterAuBrouillon(chatId, debut);
    router.push(`/chat?id=${encodeURIComponent(chatId)}`);
  }, [router, idDirect, debut]);
}
