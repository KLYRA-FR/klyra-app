"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PanneauConversations } from "@/components/chat/PanneauConversations";
import { ProjectPanel } from "@/components/project/ProjectPanel";
import { Visionneuse, type DemandeFichier } from "@/components/project/Visionneuse";
import { useIsClient } from "@/hooks/useIsClient";
import { cn } from "@/lib/cn";
import { entreePage, glissement } from "@/lib/mouvement";
import { CompteClaudeProvider } from "@/lib/compte-claude";
import { DIRECT, useChat, useProject, WorkspaceProvider } from "@/lib/workspace";
import type { Project } from "@/types/domain";
import { AppRail } from "./AppRail";

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

/** Dans les chats : la liste des chats, une conversation directe avec un agent, ou les fiches de l'équipe. */
function useEnConversation(): boolean {
  const pathname = usePathname();
  const id = useSearchParams().get("id");
  return pathname === "/chats" || pathname === "/equipe" || (pathname === "/chat" && !!id?.startsWith(DIRECT));
}

/** Le contenu de la page, qui arrive en douceur à chaque changement d'écran. */
function Page({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} ref={entreePage} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const project = useOpenProject();
  const enConversation = useEnConversation();

  /* Un fichier cliqué dans le panneau du projet ou l'aperçu : la visionneuse. */
  const [fichier, setFichier] = useState<DemandeFichier | null>(null);
  const fermerFichier = useCallback(() => setFichier(null), []);
  useEffect(() => {
    const ouvrir = (e: Event) => setFichier((e as CustomEvent<DemandeFichier>).detail);
    window.addEventListener("klyra:fichier", ouvrir);
    return () => window.removeEventListener("klyra:fichier", ouvrir);
  }, []);
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
        {/* Replié, il se rouvre par le bouton du menu. */}
        {filesOpen && (
          <div ref={glissement} className="flex shrink-0">
            <ProjectPanel project={project} onClose={() => setFilesOpen(false)} />
          </div>
        )}
        {/* La visionneuse d'un fichier s'ouvre par-dessus le contenu. */}
        <main className={cn("relative m-2", MAIN)}>
          <Page>{children}</Page>
          {fichier?.projectId === project.id && (
            <Visionneuse key={fichier.chemin} project={project} chemin={fichier.chemin} onFermer={fermerFichier} />
          )}
        </main>
      </div>
    );
  }

  /* Dans les chats : même principe, le menu se réduit en rail et le panneau
     des agents et des conversations s'ouvre à côté. */
  if (enConversation) {
    return (
      <div className="flex h-full">
        <AppRail panneau="conversations" filesOpen={conversationsOpen} onToggleFiles={() => setConversationsOpen((v) => !v)} />
        {conversationsOpen && (
          <div ref={glissement} className="flex shrink-0">
            <PanneauConversations onClose={() => setConversationsOpen(false)} />
          </div>
        )}
        <main className={cn("m-2", MAIN)}>
          <Page>{children}</Page>
        </main>
      </div>
    );
  }

  /* Ailleurs : le rail et le contenu. */
  return (
    <div className="flex h-full">
      <AppRail />
      {/* Le même écart de 8 px autour du contenu ; cette marge sert aussi à déplacer la fenêtre. */}
      <div className="flex min-w-0 flex-1 flex-col py-2 pr-2 pl-2 [-webkit-app-region:drag]">
        <main className={cn("[-webkit-app-region:no-drag]", MAIN)}>
          <Page>{children}</Page>
        </main>
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
      <CompteClaudeProvider>
        <div data-shell={isDesktopShell() ? "desktop" : "web"} className="h-full bg-fond-page">
          <Suspense>
            <ShellLayout>{children}</ShellLayout>
          </Suspense>
        </div>
      </CompteClaudeProvider>
    </WorkspaceProvider>
  );
}
