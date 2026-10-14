"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { PuceSelect, type PuceOption } from "@/components/ui/PuceSelect";
import { findMention } from "@/lib/mentions";
import { useRoles, useWorkspace } from "@/lib/workspace";
import type { Chat, Project, RoleId } from "@/types/domain";
import { PromptBox } from "./PromptBox";

const AUTO = "auto";

/** Composeur sous le fil d'un chat. */
export function Composer({ chat, project }: { chat: Chat; project: Project | undefined }) {
  const roles = useRoles();
  const { sendMessage } = useWorkspace();
  const [text, setText] = useState("");
  const [to, setTo] = useState<RoleId | typeof AUTO>(AUTO);

  const submit = () => {
    const recipient = to === AUTO ? findMention(text, roles) : to;
    sendMessage(chat.id, text.trim(), recipient);
    setText("");
  };

  const recipientOptions: PuceOption<RoleId | typeof AUTO>[] = [
    { value: AUTO, label: "Principal" },
    ...roles.filter((r) => r.id !== "principal").map((r) => ({ value: r.id, label: `${r.name} · ${r.tag}` })),
  ];

  return (
    <div className="@container px-5 pt-1 pb-4">
      <PromptBox
        value={text}
        onChange={setText}
        onSubmit={submit}
        placeholder="Écris à l’équipe ou @mentionne un rôle…"
        puces={
          <>
            <PuceSelect
              libelle="Destinataire"
              icone={<Icon name="users-profiles-01" size={16} />}
              options={recipientOptions}
              value={to}
              onChange={setTo}
            />
            {/* Label gris du design system (k-label--gris) : le projet du chat.
                Masqué quand la colonne est étroite : le panneau du projet le montre déjà. */}
            {project && (
              <span className="hidden h-8 items-center gap-1.5 rounded-xs bg-fond-surface-grise px-2.5 text-ui-s font-medium text-texte-principal @lg:inline-flex">
                <Icon name="folder" size={16} className="text-icone-secondaire" />
                {project.name}
              </span>
            )}
          </>
        }
      />
      <p className="mt-2 px-1 text-ui-2xs text-texte-tertiaire">
        Sans mention, le Principal répartit le travail · Entrée pour envoyer, Maj + Entrée pour aller à la ligne.
      </p>
    </div>
  );
}
