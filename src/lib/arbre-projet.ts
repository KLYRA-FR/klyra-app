"use client";

import { useEffect, useState } from "react";
import { getBridge } from "@/lib/bridge";
import type { FileNode, Project } from "@/types/domain";

/**
 * Le contenu réel du dossier d'un projet (app de bureau), relu quand on
 * revient sur l'app. Dans un navigateur : l'arborescence d'exemple du projet.
 */
export function useArbreProjet(project: Project): { noeuds: FileNode[]; erreur: string | null } {
  const bridge = getBridge();
  const [etat, setEtat] = useState<{ dossier: string; noeuds: FileNode[]; erreur: string | null } | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let actif = true;
    const lire = () =>
      void bridge.projets.arbre(project.folder).then((r) => {
        if (!actif) return;
        setEtat(r.ok ? { dossier: project.folder, noeuds: r.data, erreur: null } : { dossier: project.folder, noeuds: [], erreur: r.message });
      });
    lire();
    const auRetour = () => document.visibilityState === "visible" && lire();
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      actif = false;
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [bridge, project.folder]);

  if (!bridge) return { noeuds: project.files, erreur: null };
  if (!etat || etat.dossier !== project.folder) return { noeuds: [], erreur: null };
  return { noeuds: etat.noeuds, erreur: etat.erreur };
}
