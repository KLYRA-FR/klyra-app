"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Badge, Button, IconButton, Select, Textarea } from "klyra-ui";
import { ArrowUpIcon, AtSignIcon, MicIcon, PaperclipIcon } from "lucide-react";
import { useRoles, useWorkspace } from "@/lib/workspace";
import type { Chat, Project, Role, RoleId } from "@/types/domain";

const AUTO = "auto";

/** Premier rôle mentionné : « @Dev », « @UX/UI », « @uxui »… */
function findMention(text: string, roles: Role[]): RoleId | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  for (const match of text.matchAll(/@([\p{L}/]+)/gu)) {
    const role = roles.find((r) => normalize(r.name) === normalize(match[1]) || r.id === normalize(match[1]));
    if (role) return role.id;
  }
  return null;
}

export function Composer({ chat, project }: { chat: Chat; project: Project | undefined }) {
  const roles = useRoles();
  const { sendMessage } = useWorkspace();
  const [text, setText] = useState("");
  const [to, setTo] = useState<RoleId | typeof AUTO>(AUTO);
  const canSend = text.trim().length > 0;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    const recipient = to === AUTO ? findMention(text, roles) : to;
    sendMessage(chat.id, text.trim(), recipient);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const recipientOptions = [
    { value: AUTO, label: "À : Principal" },
    ...roles.filter((r) => r.id !== "principal").map((r) => ({ value: r.id, label: `À : ${r.name}` })),
  ];

  return (
    <form onSubmit={submit} className="px-5 pt-1 pb-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border-1 bg-white px-3.5 pt-3 pb-2.5 transition-colors duration-[120ms] focus-within:border-ink">
        <div className="flex items-center gap-2">
          <div className="w-[150px]">
            <Select
              size="sm"
              variant="outline"
              aria-label="Destinataire"
              value={to}
              onChange={(e) => setTo(e.target.value as RoleId | typeof AUTO)}
              options={recipientOptions}
              className="py-1.5"
            />
          </div>
          {project && (
            <Badge variant="ghost" size="sm">
              {project.name}
            </Badge>
          )}
        </div>

        <Textarea
          variant="ghost"
          size="sm"
          autoGrow
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Écris à l’équipe ou @mentionne un rôle…"
          aria-label="Message"
          className="max-h-[200px] border-0 px-0 text-ui focus:border-0"
        />

        <div className="flex items-center gap-1">
          <IconButton variant="ghost" size="sm" icon={<PaperclipIcon size={17} />} ariaLabel="Joindre un fichier" />
          <IconButton
            variant="ghost"
            size="sm"
            icon={<AtSignIcon size={17} />}
            ariaLabel="Mentionner un rôle"
            onClick={() => setText((t) => (t.endsWith(" ") || t === "" ? `${t}@` : `${t} @`))}
          />
          <IconButton variant="ghost" size="sm" icon={<MicIcon size={17} />} ariaLabel="Dicter" />
          <Button type="submit" variant="dark" size="sm" disabled={!canSend} aria-label="Envoyer" className="ml-auto px-2.5">
            <ArrowUpIcon size={16} />
          </Button>
        </div>
      </div>
      <p className="mt-2 text-ui-2xs text-fg-3">
        Sans mention, le Principal répartit le travail · Entrée pour envoyer, Maj + Entrée pour aller à la ligne.
      </p>
    </form>
  );
}
