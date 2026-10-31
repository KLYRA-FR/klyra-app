"use client";

import { Fragment, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import type { ContenuDossier } from "@/lib/arbre-projet";
import { cn } from "@/lib/cn";
import type { FileNode } from "@/types/domain";

/** Dossiers à ouvrir d'office : ceux qui mènent à un fichier modifié. */
function dossiersOuverts(modified: Set<string>): Set<string> {
  const ouverts = new Set<string>();
  for (const path of modified) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) ouverts.add(parts.slice(0, i).join("/"));
  }
  return ouverts;
}

/** Au-delà, un niveau n'affiche que ses premiers éléments et le dit : aucun nom ne disparaît en silence. */
const ELEMENTS_MAX = 1000;

interface FileTreeProps {
  nodes: FileNode[];
  /** Fichiers touchés par les agents : marqués en K1. */
  modified: Set<string>;
  /** Clic sur un fichier : on l'ouvre dans la visionneuse. */
  onOuvrir?: (path: string) => void;
  /** Contenu d'un dossier lu à son ouverture (cf. useArbreProjet) ; sinon `children`. */
  contenu?: (path: string) => ContenuDossier | undefined;
  charger?: (path: string) => void;
}

/**
 * Arborescence d'un projet : dossiers repliables, fichiers, et les fichiers
 * modifiés par les agents marqués d'un point K1 (leurs dossiers aussi, en plus
 * discret). Chaque niveau montre tous ses éléments ; un dossier se lit quand on
 * l'ouvre.
 */
export function FileTree({ nodes, modified, onOuvrir, contenu, charger }: FileTreeProps) {
  const [open, setOpen] = useState(() => dossiersOuverts(modified));
  const [selected, setSelected] = useState<string | null>(null);
  const modifiedFolders = dossiersOuverts(modified);

  // Un dossier ouvert (au clic, ou d'office vers un fichier modifié) : son contenu est lu.
  useEffect(() => {
    if (charger) for (const path of open) charger(path);
  }, [open, charger]);

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const message = (depth: number, texte: string, erreur = false) => (
    <li
      role="status"
      style={{ paddingLeft: 8 + depth * 14 + 20 }}
      className={cn("py-1 pr-2 text-ui-2xs leading-[1.4]", erreur ? "text-texte-erreur" : "text-texte-tertiaire")}
    >
      {texte}
    </li>
  );

  const enfants = (node: FileNode, depth: number) => {
    const lu = node.children ?? contenu?.(node.path);
    if (lu === undefined) return <ul className="m-0 list-none p-0">{message(depth, "Lecture…")}</ul>;
    if (!Array.isArray(lu)) return <ul className="m-0 list-none p-0">{message(depth, `Dossier illisible : ${lu.erreur}`, true)}</ul>;
    return <ul className="m-0 list-none p-0">{rows(lu, depth)}</ul>;
  };

  const rows = (list: FileNode[], depth: number) => [
    ...list.slice(0, ELEMENTS_MAX).map((node) => {
      const isFolder = node.kind === "dossier";
      const isOpen = open.has(node.path);
      const isModified = modified.has(node.path);
      return (
        <li key={node.path}>
          <button
            type="button"
            onClick={() => {
              if (isFolder) return toggle(node.path);
              setSelected(node.path);
              onOuvrir?.(node.path);
            }}
            aria-expanded={isFolder ? isOpen : undefined}
            style={{ paddingLeft: 8 + depth * 14 }}
            className={cn(
              "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent pr-2 text-left",
              "transition-colors duration-[120ms] ease-sortie hover:bg-fond-survol",
              selected === node.path && "bg-fond-teinte-bleue hover:bg-fond-teinte-bleue",
            )}
          >
            {/* Chevron des dossiers ; les fichiers gardent la même indentation. */}
            <span className="flex w-3.5 shrink-0 justify-center text-icone-secondaire">
              {isFolder && (
                <Icon
                  name="chevron-right"
                  size={14}
                  className={cn("transition-transform duration-[220ms] ease-sortie", isOpen && "rotate-90")}
                />
              )}
            </span>
            <Icon
              name={isFolder ? (isOpen ? "folder-open-01" : "folder") : "file-01"}
              size={16}
              className={isModified ? "text-icone-accent" : "text-icone-secondaire"}
            />
            <span
              className={cn(
                "flex-1 truncate text-ui-s",
                isModified ? "font-medium text-texte-accent" : "text-texte-principal",
                node.name.startsWith(".") && !isModified && "text-texte-secondaire",
              )}
            >
              {node.name}
            </span>
            {isModified && (
              <span title="Modifié par un agent" className="size-1.5 shrink-0 bg-bleu-k1-500" />
            )}
            {isFolder && !isOpen && modifiedFolders.has(node.path) && (
              <span title="Contient des fichiers modifiés" className="size-1.5 shrink-0 bg-bleu-k1-200" />
            )}
          </button>
          {isFolder && isOpen && enfants(node, depth + 1)}
        </li>
      );
    }),
    ...(list.length > ELEMENTS_MAX
      ? [
          <Fragment key="…">
            {message(depth, `Liste coupée : ${(list.length - ELEMENTS_MAX).toLocaleString("fr-FR")} autres éléments non affichés. Ouvre le dossier sur l’ordinateur pour tout voir.`)}
          </Fragment>,
        ]
      : []),
  ];

  return <ul className="m-0 flex list-none flex-col p-0">{rows(nodes, 0)}</ul>;
}
