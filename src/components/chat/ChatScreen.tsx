"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "klyra-ui";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { formatTime } from "@/lib/format";
import { useChat, useChatMessages, useProjects, useRoles } from "@/lib/workspace";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { MessageThread } from "./MessageThread";
import { PanneauLateral, usePanneauLateral } from "./PanneauLateral";

/** « Modifié par Dev · 09:52 » : dernier journal de travail du chat. */
function useModifiedLabel(chatId: string): string | null {
  const messages = useChatMessages(chatId);
  const roles = useRoles();
  return useMemo(() => {
    const last = messages.findLast((m) => m.parts.some((p) => p.type === "worklog"));
    if (!last || last.author.kind !== "role") return null;
    const { roleId } = last.author;
    const name = roles.find((r) => r.id === roleId)?.name;
    return `Modifié par ${name} · ${formatTime(last.createdAt)}`;
  }, [messages, roles]);
}

/** Largeur de fenêtre sous laquelle le panneau de l'agent part fermé. */
const PANNEAU_MIN_FENETRE = 1280;

export function ChatScreen() {
  const chatId = useSearchParams().get("id");
  const chat = useChat(chatId);
  const project = useProjects().find((p) => p.id === chat?.projectId);
  const [previewOpen, setPreviewOpen] = useState(true);
  const modifiedLabel = useModifiedLabel(chat?.id ?? "");
  /* Conversation directe : le panneau de l'agent (réglages, fichiers, tâches) à droite. */
  // Sous 1280 px, conversation + panneaux ne tiennent pas : le panneau part fermé.
  const [panneauOuvert, setPanneauOuvert] = useState(() => window.innerWidth >= PANNEAU_MIN_FENETRE);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < PANNEAU_MIN_FENETRE) setPanneauOuvert(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [maximise, setMaximise] = useState(false);
  const [etatPanneau, setEtatPanneau] = usePanneauLateral();
  const fermerPanneau = useCallback(() => {
    setPanneauOuvert(false);
    setMaximise(false);
  }, []);

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <EmptyState
          title="Ce chat n’existe pas"
          description="Il a peut-être été supprimé. Choisis un chat récent dans la barre latérale."
          action={<BoutonPrincipal href="/">Retour à l’accueil</BoutonPrincipal>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Panneau agrandi : il prend toute la place, la conversation se cache. */}
      <section aria-label={chat.title} className={maximise ? "hidden" : "relative flex min-w-0 flex-1 flex-col"}>
        <ChatHeader
          chat={chat}
          project={project}
          previewOpen={chat.kind === "direct" ? panneauOuvert : previewOpen}
          onTogglePreview={() =>
            chat.kind === "direct" ? setPanneauOuvert((v) => !v) : setPreviewOpen((v) => !v)
          }
        />
        <MessageThread key={chat.id} chatId={chat.id} />
        <Composer key={`composer-${chat.id}`} chat={chat} project={project} />
      </section>
      {/* Conversation directe : pas de projet, donc pas d'aperçu. */}
      {previewOpen && chat.kind === "equipe" && <PreviewPanel project={project} modifiedLabel={modifiedLabel} />}
      {panneauOuvert && chat.kind === "direct" && (
        <PanneauLateral
          chat={chat}
          maximise={maximise}
          onMaximiser={() => setMaximise((v) => !v)}
          onFermer={fermerPanneau}
          etat={etatPanneau}
          setEtat={setEtatPanneau}
        />
      )}
    </div>
  );
}
