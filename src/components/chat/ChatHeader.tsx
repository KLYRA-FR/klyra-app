"use client";

import { Avatar, Stack } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import type { Chat, Project } from "@/types/domain";

interface ChatHeaderProps {
  chat: Chat;
  project: Project | undefined;
  previewOpen: boolean;
  onTogglePreview: () => void;
}

export function ChatHeader({ chat, project, previewOpen, onTogglePreview }: ChatHeaderProps) {
  const roleCount = chat.roleIds.length;
  return (
    <header className="@container flex items-center gap-3 border-b border-bordure-subtile px-5 py-3">
      <Stack gap={2} className="min-w-0 flex-1">
        <h1 className="m-0 truncate text-ui font-semibold">{chat.title}</h1>
        <span className="truncate text-ui-xs text-texte-tertiaire">
          {project?.name} · {roleCount} {roleCount > 1 ? "rôles" : "rôle"} dans ce chat
        </span>
      </Stack>

      <div className="flex shrink-0 items-center gap-1.5">
        <Avatar.Group size="sm" aria-label="Rôles du chat" className="mr-1 hidden @xl:flex">
          {chat.roleIds.map((roleId) => (
            <RoleAvatar key={roleId} roleId={roleId} size="sm" className="ring-2 ring-fond-surface" />
          ))}
        </Avatar.Group>
        <Bouton variant="blanc" taille="compact" iconeGauche={<Icon name="users-profiles-01" size={16} />}>
          Rôles
        </Bouton>
        <BoutonIcone
          taille="compact"
          actif={previewOpen}
          icone={<Icon name="layout-right" size={16} />}
          libelle={previewOpen ? "Masquer l’aperçu" : "Afficher l’aperçu"}
          aria-pressed={previewOpen}
          onClick={onTogglePreview}
        />
        <BoutonIcone taille="compact" icone={<Icon name="dot-horizontal" size={16} />} libelle="Plus d’options" />
      </div>
    </header>
  );
}
