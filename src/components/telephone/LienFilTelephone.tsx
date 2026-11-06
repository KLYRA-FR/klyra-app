"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RenduFil } from "@/components/ui/Markdown";
import { cibleFil } from "@/lib/liens-fils";
import { useConversationsEspace } from "@/lib/telephone/espace";

/**
 * Sur le téléphone, un identifiant de fil cité dans une réponse (`klyra-fil-…`) ouvre ce fil, comme sa ligne
 * dans les tickets. Un fil que le compte ne connaît pas sur ce serveur le dit à côté, sans quitter la conversation.
 */
export function LienFilTelephone({ id }: { id: string }) {
  const router = useRouter();
  const conversations = useConversationsEspace();
  const [message, setMessage] = useState<string | null>(null);
  const titre = conversations?.find((c) => c.origine === id)?.titre;
  const ouvrir = () => {
    const cible = cibleFil(id, conversations);
    if (cible === "ouvrir") {
      setMessage(null);
      router.push(`/chat?id=${encodeURIComponent(id)}`);
      return;
    }
    setMessage(cible === "attente" ? "(conversations en cours de chargement, réessaie dans un instant)" : "(fil introuvable sur ce serveur : supprimé, ou pas encore copié)");
  };
  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        title={titre ? `Ouvrir le fil « ${titre} »` : "Ouvrir le fil"}
        className="cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-texte-accent underline decoration-current/40 underline-offset-2 [overflow-wrap:anywhere]"
      >
        {id}
      </button>
      {message && (
        <span role="status" className="text-texte-tertiaire">
          {" "}
          {message}
        </span>
      )}
    </>
  );
}

const rendreLienFil = (id: string) => <LienFilTelephone id={id} />;

/** Autour d'une réponse du téléphone : ses identifiants de fils deviennent cliquables. */
export function AvecLiensFilsTelephone({ children }: { children: ReactNode }) {
  return <RenduFil.Provider value={rendreLienFil}>{children}</RenduFil.Provider>;
}
