"use client";

import { useCallback } from "react";
import { useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ecrireOptions, type OptionsMessage } from "./options";

export interface Envoi {
  conversationOrigine: string;
  texte: string;
  options?: OptionsMessage;
  /** Les fichiers joints sur le téléphone, déjà vérifiés (`ajouterPieces`). */
  pieces?: File[];
}

/**
 * La seule porte d'envoi du téléphone (spec mobile M-5, T-02) : les pièces partent dans le stockage
 * du compte, puis le message attend l'ordinateur dans la file (`messagesFile`), avec ses options.
 * Une conversation d'un VPS pourra y prendre la voie directe vers le serveur, ici et nulle part ailleurs.
 */
export function useEnvoyerMessage() {
  const convex = useConvex();
  return useCallback(
    async ({ conversationOrigine, texte, options = {}, pieces = [] }: Envoi): Promise<Id<"messagesFile">> => {
      const deposees: { fichier: Id<"_storage">; nom: string; type: string }[] = [];
      for (const piece of pieces) {
        const adresse = await convex.mutation(api.demandesPoste.adresseDepot, {});
        const type = piece.type || "application/octet-stream";
        const reponse = await fetch(adresse, { method: "POST", headers: { "Content-Type": type }, body: piece });
        if (!reponse.ok) throw new Error(`${piece.name} n’a pas pu partir vers ton compte. Réessaie.`);
        const { storageId } = (await reponse.json()) as { storageId: Id<"_storage"> };
        deposees.push({ fichier: storageId, nom: piece.name, type });
      }
      const ecrites = ecrireOptions(options);
      return await convex.mutation(api.conversationsCompte.laisser, {
        conversationOrigine,
        texte,
        ...(ecrites ? { options: ecrites } : {}),
        ...(deposees.length ? { pieces: deposees } : {}),
      });
    },
    [convex],
  );
}
