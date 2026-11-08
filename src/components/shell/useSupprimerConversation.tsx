"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConfirmation } from "@/components/ui/Modale";
import { annoncer } from "@/lib/annonces";
import { useRoles, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

/**
 * Supprimer une conversation d'équipe, après confirmation. Un agent y travaille : on propose de l'arrêter
 * d'abord, la suppression se refait ensuite. Supprimée pendant qu'elle est ouverte : retour à son projet, ou à l'accueil.
 */
export function useSupprimerConversation(): [(chat: Chat) => Promise<boolean>, ReactNode] {
  const router = useRouter();
  const chemin = usePathname();
  const ouverte = useSearchParams().get("id");
  const roles = useRoles();
  const { state, arreter, supprimerConversation } = useWorkspace();
  const [demander, fenetre] = useConfirmation();

  const supprimer = async (chat: Chat) => {
    const travail = state.travail[chat.id];
    if (travail) {
      const qui = roles.find((r) => r.id === travail.roleId)?.name ?? "L’agent";
      const arreterAvant = await demander({
        titre: `${qui} travaille dans « ${chat.title} »`,
        texte: "On ne supprime pas une conversation où un agent écrit. Arrête-le d’abord, puis supprime-la.",
        confirmer: `Arrêter ${qui}`,
      });
      if (arreterAvant) arreter(chat.id);
      return false;
    }
    const oui = await demander({
      titre: `Supprimer « ${chat.title} » ?`,
      texte: `La conversation et tous ses messages seront supprimés${chat.lieu ? ", sur ce PC comme sur son serveur" : ""}. Les livrables publiés restent dans Artefacts. C’est définitif.`,
      confirmer: "Supprimer",
    });
    if (!oui) return false;
    const refus = supprimerConversation(chat.id);
    if (refus) {
      annoncer(refus);
      return false;
    }
    // Ouverte : retour au projet (sa conversation suivante), sinon à l'accueil.
    if (chemin === "/chat" && ouverte === chat.id) router.replace(chat.projectId ? `/projet?id=${encodeURIComponent(chat.projectId)}` : "/");
    annoncer(`Conversation supprimée : ${chat.title}.`);
    return true;
  };

  return [supprimer, fenetre];
}
