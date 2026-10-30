"use client";

import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { annoncer } from "@/lib/annonces";
import { cn } from "@/lib/cn";
import { estEpinglee } from "@/lib/epinglage";
import { useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

const eclairages = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Même retour pour les deux listes et le menu ; seul un geste clavier suit la ligne. */
export function useBasculerEpingle() {
  const { epinglerChat } = useWorkspace();
  return (chat: Chat, liste?: Element | null) => {
    if (chat.kind !== "equipe" || chat.fil) return;
    const epingler = !estEpinglee(chat);
    epinglerChat(chat.id, epingler);
    const titre = chat.title.length > 60 ? `${chat.title.slice(0, 60)}…` : chat.title;
    annoncer(`${epingler ? "Conversation épinglée" : "Épingle retirée"} : ${titre}.`);
    requestAnimationFrame(() => {
      const id = CSS.escape(chat.id);
      document.querySelectorAll<HTMLElement>(`[data-conversation="${id}"]`).forEach((ligne) => {
        clearTimeout(eclairages.get(ligne));
        ligne.removeAttribute("data-eclaire");
        // Relance l'animation si la même conversation est basculée deux fois rapidement.
        void ligne.offsetWidth;
        ligne.setAttribute("data-eclaire", "");
        eclairages.set(ligne, setTimeout(() => {
          ligne.removeAttribute("data-eclaire");
          eclairages.delete(ligne);
        }, 1800));
      });
      if (liste) {
        const bouton = liste.querySelector<HTMLElement>(`[data-epingle="${id}"]`);
        bouton?.focus({ preventScroll: true });
        bouton?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
    });
  };
}

export function BoutonEpingle({ chat, className }: { chat: Chat; className?: string }) {
  const basculer = useBasculerEpingle();
  const epinglee = estEpinglee(chat);
  return (
    <BoutonIcone
      variant="discret"
      taille="mini"
      data-epingle={chat.id}
      icone={<Icon name={epinglee ? "pin-off-01" : "pin-01"} size={16} />}
      libelle={epinglee ? `Retirer l'épingle de ${chat.title}` : `Épingler ${chat.title}`}
      title={epinglee ? "Retirer l'épingle" : "Épingler"}
      className={cn("absolute top-1/2 -translate-y-1/2 text-icone-secondaire opacity-0 transition-[opacity,background-color,color] duration-[120ms] ease-sortie group-hover/conv:opacity-100 group-has-[:focus-visible]/conv:opacity-100 hover:text-texte-principal", className)}
      onClick={(e) => {
        if (e.detail > 1) return;
        basculer(chat, e.detail === 0 ? e.currentTarget.closest("[data-liste-conversations]") : null);
      }}
    />
  );
}
