"use client";

import { Avatar, Button, IconButton, Stack } from "klyra-ui";
import { MoreHorizontalIcon, PanelRightIcon, UsersIcon } from "lucide-react";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
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
    <header className="flex items-center gap-3 border-b border-border-1 px-5 py-3 in-data-[shell=desktop]:[-webkit-app-region:drag]">
      <Stack gap={2} className="min-w-0 flex-1">
        <h1 className="truncate text-ui font-semibold">{chat.title}</h1>
        <span className="truncate text-ui-xs text-fg-3">
          {project?.name} · {roleCount} {roleCount > 1 ? "rôles" : "rôle"} dans ce chat
        </span>
      </Stack>

      <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
        <Avatar.Group size="sm" aria-label="Rôles du chat">
          {chat.roleIds.map((roleId) => (
            <RoleAvatar key={roleId} roleId={roleId} size="sm" className="ring-2 ring-white" />
          ))}
        </Avatar.Group>
        <Button variant="ghost" size="sm" iconLeft={<UsersIcon size={14} />}>
          Rôles
        </Button>
        <IconButton
          variant={previewOpen ? "outline" : "ghost"}
          size="sm"
          icon={<PanelRightIcon size={16} />}
          ariaLabel={previewOpen ? "Masquer l’aperçu" : "Afficher l’aperçu"}
          aria-pressed={previewOpen}
          onClick={onTogglePreview}
        />
        <IconButton variant="ghost" size="sm" icon={<MoreHorizontalIcon size={18} />} ariaLabel="Plus d’options" />
      </div>
    </header>
  );
}
