"use client";

import { Suspense, type ReactNode } from "react";
import { useIsClient } from "@/hooks/useIsClient";
import { WorkspaceProvider } from "@/lib/workspace";
import { AppSidebar } from "./AppSidebar";

/** Vrai dans la fenêtre Electron : la barre de titre est intégrée à l'app. */
function isDesktopShell(): boolean {
  return navigator.userAgent.includes("Electron");
}

/**
 * Cadre de l'app : barre latérale + contenu de la page.
 * Les données n'existent qu'à l'ouverture de l'app : rien n'est rendu
 * pendant le pré-rendu du build (cf. useIsClient).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const isClient = useIsClient();
  if (!isClient) return <div className="h-full bg-white" />;

  return (
    <WorkspaceProvider>
      <div data-shell={isDesktopShell() ? "desktop" : "web"} className="flex h-full bg-white">
        <Suspense>
          <AppSidebar />
        </Suspense>
        <main className="flex h-full min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
