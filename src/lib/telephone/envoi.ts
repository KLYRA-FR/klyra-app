"use client";

import { useCallback } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ecrireOptions, type OptionsMessage } from "./options";
import { envoiSimple, envoyerAuVps } from "./vps-direct";
import { lieuDeHote, lireIdDirect } from "@/lib/lieux";

export interface Envoi {
  conversationOrigine: string;
  texte: string;
  options?: OptionsMessage;
  /** Les fichiers joints sur le téléphone, déjà vérifiés (`ajouterPieces`). */
  pieces?: File[];
  /** Après le dépôt de chaque pièce : combien sont réellement dans le compte (pas de progression en octets, `fetch` n'en donne pas). */
  surPiece?: (deposees: number) => void;
}

/**
 * La seule porte d'envoi du téléphone (spec mobile M-5, T-02) : les pièces partent dans le stockage
 * du compte, puis le message attend l'ordinateur dans la file (`messagesFile`), avec ses options.
 * Exception : une conversation directe qui tourne sur un VPS, avec un téléphone relié
 * à ce VPS. Le message part alors au VPS lui-même (`vps-direct.ts`), et la fonction rend null.
 */
export function useEnvoyerMessage() {
  const convex = useConvex();
  const conversations = useQuery(api.conversationsCompte.liste, {});
  return useCallback(
    async ({ conversationOrigine, texte, options = {}, pieces = [], surPiece }: Envoi): Promise<Id<"messagesFile"> | null> => {
      const conversation = conversations?.find((c) => c.origine === conversationOrigine);
      /* Une conversation directe pas encore copiée dans le compte : son id dit son serveur (`dm-<agent>@<hôte>`). */
      const direct = lireIdDirect(conversationOrigine);
      const lieu = conversation ? (conversation.lieu ?? null) : direct?.hote ? lieuDeHote(direct.hote) : null;
      if ((conversation || lieu) && direct && envoiSimple(options, pieces.length)) {
        if (lieu) {
          const agentId = direct.roleId;
          const r = await envoyerAuVps({
            adresse: lieu,
            conversation: conversationOrigine,
            agentId,
            titre: conversation?.titre ?? agentId,
            texte,
            modele: options.modele,
            effort: options.effort,
          });
          if (!r.ok) throw new Error(r.message);
          return null;
        }
      }
      const deposees: { fichier: Id<"_storage">; nom: string; type: string }[] = [];
      for (const piece of pieces) {
        const adresse = await convex.mutation(api.demandesPoste.adresseDepot, {});
        const type = piece.type || "application/octet-stream";
        const reponse = await fetch(adresse, { method: "POST", headers: { "Content-Type": type }, body: piece });
        if (!reponse.ok) throw new Error(`${piece.name} n’a pas pu partir vers ton compte. Réessaie.`);
        const { storageId } = (await reponse.json()) as { storageId: Id<"_storage"> };
        deposees.push({ fichier: storageId, nom: piece.name, type });
        surPiece?.(deposees.length);
      }
      const ecrites = ecrireOptions(options);
      return await convex.mutation(api.conversationsCompte.laisser, {
        conversationOrigine,
        texte,
        ...(ecrites ? { options: ecrites } : {}),
        ...(deposees.length ? { pieces: deposees } : {}),
      });
    },
    [convex, conversations],
  );
}
