"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useWorkspace } from "@/lib/workspace";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Fermer un ticket depuis l'interface : le fil est archivé, et le rappel d'où il
 * vient (« Confier à un agent ») est coché, sur ce poste ou dans le compte.
 * « Supprimer » ne coche rien. Les rappels du compte passent par Convex, que
 * l'espace de travail ne voit pas : d'où ce geste côté écran.
 */
export function useFermerTicket() {
  const { state, archiverFil, enregistrerTache } = useWorkspace();
  const modifier = useMutation(api.rappels.modifier);
  return useCallback(
    /* Rend ce qu'il est advenu du rappel lié : l'accusé pour le téléphone le dit sans faux succès. */
    async (chatId: string, supprime = false): Promise<"aucun" | "coche" | "inaccessible"> => {
      const rappel = state.chats.find((c) => c.id === chatId)?.fil?.rappel;
      archiverFil(chatId, supprime);
      if (supprime || !rappel) return "aucun";
      if (rappel.source === "local") {
        const tache = state.taches.find((t) => t.id === rappel.id);
        if (!tache) return "inaccessible";
        if (!tache.faite) enregistrerTache({ ...tache, faite: true, faiteLe: new Date().toISOString() });
        return "coche";
      }
      // Retiré ou réassigné entre-temps : le fil se ferme quand même.
      try {
        await modifier({ rappelId: rappel.id as Id<"rappels">, fait: true });
        return "coche";
      } catch {
        return "inaccessible";
      }
    },
    [state.chats, state.taches, archiverFil, enregistrerTache, modifier],
  );
}
