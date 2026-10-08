"use client";

import { useState, type ReactNode } from "react";
import { Button, EmptyState, IconButton, Input } from "klyra-ui";
import {
  CodeIcon,
  FileCodeIcon,
  GlobeIcon,
  ListTodoIcon,
  MonitorIcon,
  RefreshCwIcon,
  RocketIcon,
  SmartphoneIcon,
} from "lucide-react";
import type { Project } from "@/types/domain";
import { SiteMock } from "./SiteMock";

type PreviewTab = "apercu" | "code" | "fichiers" | "taches";
type Device = "desktop" | "mobile";

const TABS: { id: PreviewTab; label: string; icon: ReactNode; empty: string }[] = [
  { id: "apercu", label: "Aperçu", icon: <GlobeIcon size={14} />, empty: "" },
  { id: "code", label: "Code", icon: <CodeIcon size={14} />, empty: "Le code modifié par le Dev s’affichera ici, fichier par fichier." },
  { id: "fichiers", label: "Fichiers", icon: <FileCodeIcon size={14} />, empty: "Les fichiers du projet s’afficheront ici." },
  { id: "taches", label: "Tâches", icon: <ListTodoIcon size={14} />, empty: "Les tâches réparties par le Principal s’afficheront ici." },
];

interface PreviewPanelProps {
  project: Project | undefined;
  /** « Modifié par Dev · 09:52 », affiché sur la zone touchée. */
  modifiedLabel: string | null;
}

/** Panneau de droite du chat : aperçu en direct du site du projet. */
export function PreviewPanel({ project, modifiedLabel }: PreviewPanelProps) {
  const [tab, setTab] = useState<PreviewTab>("apercu");
  const [device, setDevice] = useState<Device>("desktop");
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <aside
      aria-label="Aperçu du projet"
      className="flex h-full w-[clamp(380px,38vw,560px)] shrink-0 flex-col border-l border-border-1 bg-surface-1"
    >
      <div className="flex items-center gap-1 px-4 py-3 in-data-[shell=desktop]:[-webkit-app-region:drag]">
        <div role="tablist" aria-label="Vues du projet" className="flex gap-1 [-webkit-app-region:no-drag]">
          {TABS.map((t) => (
            <Button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab}
              variant={t.id === tab ? "dark" : "ghost"}
              size="sm"
              iconLeft={t.icon}
              onClick={() => setTab(t.id)}
              className="px-3 py-1.5"
            >
              {t.label}
            </Button>
          ))}
        </div>
        <Button
          variant="dark"
          size="sm"
          iconLeft={<RocketIcon size={14} />}
          className="ml-auto px-3 py-1.5 [-webkit-app-region:no-drag]"
        >
          Déployer
        </Button>
      </div>

      {tab === "apercu" ? (
        <>
          <div className="flex items-center gap-2 px-4 pb-3">
            <IconButton variant="ghost" size="sm" icon={<RefreshCwIcon size={14} />} ariaLabel="Recharger l’aperçu" />
            <div className="flex-1">
              <Input
                size="sm"
                readOnly
                aria-label="Adresse de l’aperçu"
                value={project?.previewUrl ?? ""}
                className="klyra-mono rounded-pill text-ui-2xs"
              />
            </div>
            <IconButton
              variant={device === "desktop" ? "outline" : "ghost"}
              size="sm"
              icon={<MonitorIcon size={14} />}
              ariaLabel="Aperçu ordinateur"
              aria-pressed={device === "desktop"}
              onClick={() => setDevice("desktop")}
            />
            <IconButton
              variant={device === "mobile" ? "outline" : "ghost"}
              size="sm"
              icon={<SmartphoneIcon size={14} />}
              ariaLabel="Aperçu téléphone"
              aria-pressed={device === "mobile"}
              onClick={() => setDevice("mobile")}
            />
          </div>
          <div className="flex min-h-0 flex-1 justify-center px-4 pb-4">
            <div
              className={
                device === "mobile"
                  ? "h-full w-[340px] overflow-hidden rounded-xl border border-border-1"
                  : "h-full w-full overflow-hidden rounded-md border border-border-1"
              }
            >
              <SiteMock device={device} modifiedLabel={modifiedLabel} />
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState title={current.label} description={current.empty} />
        </div>
      )}
    </aside>
  );
}
