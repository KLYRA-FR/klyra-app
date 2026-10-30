"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { idDirect } from "@/lib/workspace";

/** Le début de la demande, que la personne complète avant d'envoyer (spec §9.2). */
export const DEBUT_DEMANDE_AGENT = "Aide-moi à créer un agent qui ";

/**
 * « Le décrire à Sam » : ouvre la conversation de l'assistant (`dm-principal`)
 * avec « Aide-moi à créer un agent qui » dans le composeur, curseur à la fin.
 * Rien n'est envoyé ; un brouillon déjà là est gardé, la demande s'ajoute à la ligne.
 */
export function useDecrireAAssistant(): () => void {
  const router = useRouter();
  return useCallback(() => {
    const chatId = idDirect("principal");
    ajouterAuBrouillon(chatId, DEBUT_DEMANDE_AGENT);
    router.push(`/chat?id=${chatId}`);
  }, [router]);
}
