"use client";

import { useState } from "react";
import { EmptyState, Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Onglets, type Onglet } from "@/components/ui/Onglets";
import type { Project } from "@/types/domain";
import { SiteMock } from "./SiteMock";

type PreviewTab = "apercu" | "code" | "fichiers" | "taches";
type Device = "desktop" | "mobile";

const TABS: Onglet<PreviewTab>[] = [
  { id: "apercu", label: "Aperçu", icone: <Icon name="globe-01" size={16} /> },
  { id: "code", label: "Code", icone: <Icon name="code-01" size={16} /> },
  { id: "fichiers", label: "Fichiers", icone: <Icon name="file-code" size={16} /> },
  { id: "taches", label: "Tâches", icone: <Icon name="list" size={16} /> },
];

const EMPTY: Record<Exclude<PreviewTab, "apercu">, string> = {
  code: "Le code modifié par le Dev s’affichera ici, fichier par fichier.",
  fichiers: "Les fichiers du projet s’afficheront ici.",
  taches: "Les tâches réparties par le Principal s’afficheront ici.",
};

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
      className="@container flex h-full w-[clamp(380px,38vw,560px)] shrink-0 flex-col border-l border-bordure-subtile bg-fond-surface"
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <Onglets
          libelle="Vues du projet"
          onglets={TABS}
          valeur={tab}
          onChange={setTab}
          etiquettes="large"
          
        />
        <Bouton
          variant="sombre"
          taille="compact"
          iconeGauche={<Icon name="upload-01" size={16} />}
          title="Déployer"
          className="ml-auto"
        >
          <span className="sr-only @md:not-sr-only">Déployer</span>
        </Bouton>
      </div>

      {tab === "apercu" ? (
        <>
          <div className="flex items-center gap-1.5 px-4 pb-3">
            <BoutonIcone
              taille="compact"
              icone={<Icon name="refresh-01" size={16} />}
              libelle="Recharger l’aperçu"
              className="text-icone-secondaire hover:text-icone-defaut"
            />
            <div className="flex-1">
              <Input
                size="sm"
                readOnly
                aria-label="Adresse de l’aperçu"
                value={project?.previewUrl ?? ""}
                className="klyra-mono rounded-sm border-bordure-champ text-ui-2xs text-texte-secondaire"
              />
            </div>
            <BoutonIcone
              taille="compact"
              actif={device === "desktop"}
              icone={<Icon name="computer" size={16} />}
              libelle="Aperçu ordinateur"
              aria-pressed={device === "desktop"}
              onClick={() => setDevice("desktop")}
            />
            <BoutonIcone
              taille="compact"
              actif={device === "mobile"}
              icone={<Icon name="iphone-02" size={16} />}
              libelle="Aperçu téléphone"
              aria-pressed={device === "mobile"}
              onClick={() => setDevice("mobile")}
            />
          </div>
          <div className="flex min-h-0 flex-1 justify-center px-4 pb-4">
            <div
              className={
                device === "mobile"
                  ? "h-full w-[340px] overflow-hidden rounded-3xl border border-bordure-subtile shadow-ombre-ambiante"
                  : "h-full w-full overflow-hidden rounded-md border border-bordure-subtile shadow-ombre-ambiante"
              }
            >
              <SiteMock device={device} modifiedLabel={modifiedLabel} />
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState title={current.label} description={EMPTY[tab]} />
        </div>
      )}
    </aside>
  );
}
