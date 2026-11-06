"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace";
import { RenduFil } from "@/components/ui/Markdown";

/**
 * Un identifiant de fil cité dans un message (« Rapport hebdo (klyra-fil-0f830d35) ») : un clic ouvre ce fil
 * dans un onglet du chat de son agent, comme « Ouvrir le fil » d'un ticket. Un fil que cet appareil ne connaît
 * pas (supprimé, ou d'un autre poste) le dit à côté de l'identifiant, sans quitter la conversation.
 */
export function LienFil({ id }: { id: string }) {
  const router = useRouter();
  const { state } = useWorkspace();
  const [introuvable, setIntrouvable] = useState(false);
  const titre = state.chats.find((c) => c.id === id && c.fil)?.title;
  const ouvrir = () => {
    if (!state.chats.some((c) => c.id === id && c.fil)) {
      setIntrouvable(true);
      return;
    }
    setIntrouvable(false);
    router.push(`/chat?id=${encodeURIComponent(id)}`);
  };
  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        title={titre ? `Ouvrir le fil « ${titre} »` : "Ouvrir le fil"}
        className="cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-texte-accent underline decoration-current/40 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-current"
      >
        {id}
      </button>
      {introuvable && (
        <span role="status" className="text-texte-tertiaire">
          {" "}
          (fil introuvable : supprimé, ou ouvert sur un autre appareil)
        </span>
      )}
    </>
  );
}

const rendreLienFil = (id: string) => <LienFil id={id} />;

/** Autour d'un texte de message : ses identifiants de fils deviennent cliquables. */
export function AvecLiensFils({ children }: { children: ReactNode }) {
  return <RenduFil.Provider value={rendreLienFil}>{children}</RenduFil.Provider>;
}
