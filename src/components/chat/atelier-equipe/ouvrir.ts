"use client";

import { createContext, useContext } from "react";

/**
 * L'atelier d'une équipe en grand : la table prend l'écran de la conversation, la conversation
 * avec l'assistant passe dans une colonne à droite. La carte du fil l'ouvre par cet événement
 * (ChatScreen l'écoute pour sa conversation) ; dans la colonne, les cartes se replient en une ligne.
 */

export const OUVRIR_ATELIER_EQUIPE = "klyra:atelier-equipe";

export interface DemandeAtelierEquipe {
  chatId: string;
  /** Le membre à montrer (sa clé), sinon celui que l'atelier montrait. */
  membre?: string;
}

export function ouvrirAtelierEquipe(chatId: string, membre?: string): void {
  window.dispatchEvent(new CustomEvent<DemandeAtelierEquipe>(OUVRIR_ATELIER_EQUIPE, { detail: { chatId, membre } }));
}

/** Vrai dans la colonne de conversation de l'atelier en grand. */
export const DansAtelierEquipe = createContext(false);

export const useDansAtelierEquipe = () => useContext(DansAtelierEquipe);
