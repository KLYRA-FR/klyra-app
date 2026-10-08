"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar, Button, IconButton, Input, Kbd, Stack, cn } from "klyra-ui";
import {
  FolderIcon,
  HouseIcon,
  ImageIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { formatListDate } from "@/lib/format";
import { useChatPreview, useProjects, useRecentChats, useRoles, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

const RECENT_CHATS = 4;

/* Rangée cliquable de la barre latérale (nav, projet, chat). */
function SidebarLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-ui text-fg-1 no-underline",
        "transition-colors duration-[120ms] hover:bg-surface-2",
        active && "bg-surface-3",
      )}
    >
      {children}
    </Link>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction="row" align="center" justify="between" className="px-2.5 pt-5 pb-1.5">
      <span className="klyra-mono text-ui-2xs uppercase tracking-[0.06em] text-fg-3">{children}</span>
      {action}
    </Stack>
  );
}

function RecentChatLink({ chat, active }: { chat: Chat; active: boolean }) {
  const preview = useChatPreview(chat.id);
  return (
    <SidebarLink href={`/chat?id=${chat.id}`} active={active}>
      <RoleAvatar roleId={preview.roleId} size="md" />
      <Stack gap={1} className="min-w-0 flex-1">
        <span className="truncate text-ui-s font-medium">{chat.title}</span>
        <span className="truncate text-ui-xs text-fg-3">{preview.text}</span>
      </Stack>
      <span className="klyra-mono self-start pt-0.5 text-ui-3xs text-fg-3">{formatListDate(chat.updatedAt)}</span>
    </SidebarLink>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentId = searchParams.get("id");
  const { state } = useWorkspace();
  const projects = useProjects();
  const roles = useRoles();
  const recentChats = useRecentChats(RECENT_CHATS);

  const nav = [
    { href: "/", label: "Accueil", icon: <HouseIcon size={16} />, count: null },
    { href: "/chats", label: "Chats", icon: <MessageSquareIcon size={16} />, count: state.chats.length },
    { href: "/projets", label: "Projets", icon: <FolderIcon size={16} />, count: projects.length },
    { href: "/fichiers", label: "Fichiers", icon: <ImageIcon size={16} />, count: null },
    { href: "/equipe", label: "Équipe", icon: <UsersIcon size={16} />, count: roles.length },
  ];

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col gap-1 border-r border-border-1 bg-surface-1 px-3 pt-4 pb-3 in-data-[shell=desktop]:pt-11">
      {/* Zone de la barre de titre : sert à déplacer la fenêtre dans l'app de bureau. */}
      <div className="flex items-center gap-1.5 px-2 pb-3 [-webkit-app-region:drag]">
        <span className="text-ui font-semibold tracking-[0.06em]">KLYRA</span>
        <span className="text-ui-s text-fg-3">studio</span>
        <IconButton
          variant="ghost"
          size="sm"
          icon={<PanelLeftIcon size={16} />}
          ariaLabel="Masquer la barre latérale"
          className="ml-auto [-webkit-app-region:no-drag]"
        />
      </div>

      <Button
        variant="dark"
        size="sm"
        fullWidth
        iconLeft={<PlusIcon size={15} />}
        iconRight={<Kbd onDark>⌘N</Kbd>}
        className="justify-between"
      >
        <span className="mr-auto">Nouveau chat</span>
      </Button>

      <div className="mt-1 mb-2">
        <Input
          size="sm"
          placeholder="Rechercher"
          aria-label="Rechercher"
          leftIcon={<SearchIcon size={14} />}
          rightIcon={<Kbd>⌘K</Kbd>}
        />
      </div>

      <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
        {nav.map((item) => (
          <SidebarLink key={item.href} href={item.href} active={pathname === item.href}>
            <span className="text-fg-2">{item.icon}</span>
            <span className="flex-1 font-medium">{item.label}</span>
            {item.count !== null && <span className="klyra-mono text-ui-2xs text-fg-3">{item.count}</span>}
          </SidebarLink>
        ))}
      </nav>

      <SectionTitle
        action={<IconButton variant="ghost" size="sm" icon={<PlusIcon size={14} />} ariaLabel="Nouveau projet" />}
      >
        Projets
      </SectionTitle>
      <div className="flex flex-col gap-0.5">
        {projects.map((project) => (
          <SidebarLink
            key={project.id}
            href={`/projet?id=${project.id}`}
            active={pathname === "/projet" && currentId === project.id}
          >
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-[2px] border-[1.25px] border-ink", project.pinned && "bg-ink")}
            />
            <span className="text-ui-s">{project.name}</span>
          </SidebarLink>
        ))}
      </div>

      <SectionTitle>Chats récents</SectionTitle>
      <div className="flex flex-col gap-0.5">
        {recentChats.map((chat) => (
          <RecentChatLink key={chat.id} chat={chat} active={pathname === "/chat" && currentId === chat.id} />
        ))}
      </div>
      <Link href="/chats" className="px-2.5 py-1.5 text-ui-xs text-fg-3 no-underline hover:text-fg-1">
        Voir tous les chats →
      </Link>

      <div className="mt-auto flex items-center gap-2.5 rounded-sm border border-border-1 bg-white px-2.5 py-2">
        <Avatar shape="circle" size="md" initials={state.currentUser.initial} alt={state.currentUser.name} gradient={false} />
        <Stack gap={1} className="min-w-0 flex-1">
          <span className="text-ui-s font-medium">{state.currentUser.name}</span>
          <span className="text-ui-xs text-fg-3">{state.currentUser.title}</span>
        </Stack>
        <IconButton variant="ghost" size="sm" icon={<SettingsIcon size={16} />} ariaLabel="Réglages" />
      </div>
    </aside>
  );
}
