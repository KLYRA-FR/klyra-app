"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { useModifiedFiles, useProjects, useWorkspace } from "@/lib/workspace";
import type { Project } from "@/types/domain";
import { FileTree } from "./FileTree";

/**
 * Panneau blanc du projet, à côté du rail : les projets pour passer de l'un à
 * l'autre, puis tout le contenu du dossier du projet.
 */
export function ProjectPanel({ project, onClose }: { project: Project; onClose: () => void }) {
  const projects = useProjects();
  const { chats } = useWorkspace().state;
  const modified = useModifiedFiles(project.id);

  return (
    <aside
      aria-label={`Projet ${project.name}`}
      className="my-2 ml-2 flex w-[272px] shrink-0 flex-col overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante"
    >
      {/* Projets */}
      <div className="flex flex-col gap-0.5 border-b border-bordure-subtile p-2 in-data-[shell=desktop]:pt-3">
        <div className="flex h-8 items-center justify-between pr-0.5 pl-2">
          <span className="text-ui font-semibold text-texte-principal">Projets</span>
          <BoutonIcone taille="mini" icone={<Icon name="plus-01" size={16} />} libelle="Nouveau projet" className="text-icone-secondaire" />
        </div>
        {projects.map((p) => {
          const active = p.id === project.id;
          const count = chats.filter((c) => c.projectId === p.id).length;
          return (
            <Link
              key={p.id}
              href={`/projet?id=${p.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-sm px-2 text-ui-s no-underline transition-colors duration-[120ms] ease-sortie",
                active ? "bg-fond-surface-grise font-medium text-texte-principal" : "text-texte-secondaire hover:bg-fond-survol",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-[1px]", p.pinned ? "bg-bleu-k1-500" : "border-[1.25px] border-current")}
              />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="klyra-mono text-ui-2xs text-texte-tertiaire">{count}</span>
            </Link>
          );
        })}
      </div>

      {/* Fichiers du projet */}
      <div className="flex items-center gap-1 pt-3 pr-2 pb-1 pl-4">
        <span className="flex-1 text-ui font-semibold text-texte-principal">Fichiers</span>
        <BoutonIcone taille="mini" icone={<Icon name="file-plus-01" size={16} />} libelle="Nouveau fichier" className="text-icone-secondaire" />
        <BoutonIcone taille="mini" icone={<Icon name="folder-plus-01" size={16} />} libelle="Nouveau dossier" className="text-icone-secondaire" />
        <BoutonIcone
          taille="mini"
          icone={<Icon name="chevron-left" size={16} />}
          libelle="Replier le panneau"
          onClick={onClose}
          className="text-icone-secondaire"
        />
      </div>
      <p className="m-0 px-4 pb-2 text-ui-2xs leading-[1.4] text-texte-tertiaire">
        <span className="klyra-mono">{project.folder}</span>
        <br />
        Clic pour un aperçu · double-clic pour éditer · ⌘P pour chercher
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <FileTree key={project.id} nodes={project.files} modified={modified} />
      </div>
    </aside>
  );
}
