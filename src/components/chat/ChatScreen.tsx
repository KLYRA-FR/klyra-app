"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, EmptyState } from "klyra-ui";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { formatTime } from "@/lib/format";
import { useChat, useChatMessages, useProjects, useRoles } from "@/lib/workspace";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { MessageThread } from "./MessageThread";

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

export function ChatScreen() {
  const chatId = useSearchParams().get("id");
  const chat = useChat(chatId);
  const project = useProjects().find((p) => p.id === chat?.projectId);
  const [previewOpen, setPreviewOpen] = useState(true);
  const modifiedLabel = useModifiedLabel(chat?.id ?? "");

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <EmptyState
          title="Ce chat n’existe pas"
          description="Il a peut-être été supprimé. Choisis un chat récent dans la barre latérale."
          action={
            <Button asChild href="/" variant="dark" size="sm">
              Retour à l’accueil
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <section aria-label={chat.title} className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          chat={chat}
          project={project}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((v) => !v)}
        />
        <MessageThread key={chat.id} chatId={chat.id} />
        <Composer key={`composer-${chat.id}`} chat={chat} project={project} />
      </section>
      {previewOpen && <PreviewPanel project={project} modifiedLabel={modifiedLabel} />}
    </div>
  );
}
