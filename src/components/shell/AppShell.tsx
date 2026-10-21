"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PanneauConversations } from "@/components/chat/PanneauConversations";
import { ProjectPanel } from "@/components/project/ProjectPanel";
import { useIsClient } from "@/hooks/useIsClient";
import { cn } from "@/lib/cn";
import { DIRECT, useChat, useProject, WorkspaceProvider } from "@/lib/workspace";
import type { Project } from "@/types/domain";
import { AppRail } from "./AppRail";
import { AppSidebar } from "./AppSidebar";
import { AppTopBar } from "./AppTopBar";

/** Vrai dans la fenêtre Electron : la barre de titre est intégrée à l'app. */
function isDesktopShell(): boolean {
  return navigator.userAgent.includes("Electron");
}

/** Projet ouvert : celui du chat (`/chat?id=`) ou de la page projet (`/projet?id=`). */
function useOpenProject(): Project | undefined {
  const pathname = usePathname();
  const id = useSearchParams().get("id");
  const chat = useChat(pathname === "/chat" ? id : null);
  return useProject(pathname === "/projet" ? id : (chat?.projectId ?? null));
}

/** Largeur de fenêtre sous laquelle le panneau des fichiers se replie. */
const FILES_MIN_WIDTH = 1280;

const MAIN =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante";

/** Dans les chats : la liste des chats, ou une conversation directe avec un agent. */
function useEnConversation(): boolean {
  const pathname = usePathname();
  const id = useSearchParams().get("id");
  return pathname === "/chats" || (pathname === "/chat" && !!id?.startsWith(DIRECT));
}

function ShellLayout({ children }: { children: ReactNode }) {
  const project = useOpenProject();
  const enConversation = useEnConversation();
  const [conversationsOpen, setConversationsOpen] = useState(true);
  // Sous 1280 px, chat + aperçu + fichiers ne tiennent pas : le panneau des
  // fichiers part replié, et se replie si la fenêtre passe sous ce seuil.
  const [filesOpen, setFilesOpen] = useState(() => window.innerWidth >= FILES_MIN_WIDTH);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < FILES_MIN_WIDTH) setFilesOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* Dans un projet : menu réduit en rail noir, panneau du projet (projets et
     fichiers), puis le contenu (chat et aperçu). */
  if (project) {
    return (
      <div className="flex h-full">
        <AppRail panneau="fichiers" filesOpen={filesOpen} onToggleFiles={() => setFilesOpen((v) => !v)} />
        {filesOpen && <ProjectPanel project={project} onClose={() => setFilesOpen(false)} />}
        <main className={cn("m-2", MAIN)}>{children}</main>
      </div>
    );
  }

  /* Dans les chats : même principe, le menu se réduit en rail et le panneau
     des agents et des conversations s'ouvre à côté. */
  if (enConversation) {
    return (
      <div className="flex h-full">
        <AppRail panneau="conversations" filesOpen={conversationsOpen} onToggleFiles={() => setConversationsOpen((v) => !v)} />
        {conversationsOpen && <PanneauConversations onClose={() => setConversationsOpen(false)} />}
        <main className={cn("m-2", MAIN)}>{children}</main>
      </div>
    );
  }

  /* Ailleurs : menu complet, barre du haut, contenu en panneau blanc. */
  return (
    <div className="flex h-full flex-col">
      {/* App de bureau : bande de titre où se posent les boutons fermer /
          réduire / agrandir. Elle sert à déplacer la fenêtre. */}
      <div aria-hidden="true" className="hidden h-7 shrink-0 [-webkit-app-region:drag] in-data-[shell=desktop]:block" />
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopBar />
          <main className={cn("mr-2 mb-2", MAIN)}>{children}</main>
        </div>
      </div>
    </div>
  );
}

/**
 * Cadre de l'app. Les données n'existent qu'à l'ouverture de l'app : rien
 * n'est rendu pendant le pré-rendu du build (cf. useIsClient).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const isClient = useIsClient();
  if (!isClient) return <div className="h-full bg-fond-page" />;

  return (
    <WorkspaceProvider>
      <div data-shell={isDesktopShell() ? "desktop" : "web"} className="h-full bg-fond-page">
        <Suspense>
          <ShellLayout>{children}</ShellLayout>
        </Suspense>
      </div>
    </WorkspaceProvider>
  );
}
