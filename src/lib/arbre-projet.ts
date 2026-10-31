"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBridge } from "@/lib/bridge";
import type { FileNode, Project } from "@/types/domain";

/** Le contenu d'un dossier ouvert : ses éléments, ou l'erreur de lecture. */
export type ContenuDossier = FileNode[] | { erreur: string };

export interface ArbreProjet {
  noeuds: FileNode[];
  erreur: string | null;
  /** Le contenu déjà lu d'un dossier (undefined : pas encore lu). */
  contenu: (chemin: string) => ContenuDossier | undefined;
  /** Lit un dossier qu'on ouvre ; sans effet s'il est déjà lu ou en cours. */
  charger: (chemin: string) => void;
}

const SANS_CHARGEMENT = () => undefined;

/**
 * Le contenu réel du dossier d'un projet (app de bureau) : la racine d'abord,
 * puis chaque dossier quand on l'ouvre. Tout est relu quand on revient sur
 * l'app. Dans un navigateur : l'arborescence d'exemple du projet.
 */
export function useArbreProjet(project: Project): ArbreProjet {
  const bridge = getBridge();
  const [etat, setEtat] = useState<{ dossier: string; noeuds: FileNode[]; erreur: string | null } | null>(null);
  const [dossiers, setDossiers] = useState<{ dossier: string; contenus: Record<string, ContenuDossier> }>({ dossier: project.folder, contenus: {} });
  const enCours = useRef(new Set<string>());
  const lus = useRef(new Set<string>());

  const lireDossier = useCallback(
    (chemin: string) => {
      if (!bridge) return;
      const dossier = project.folder;
      enCours.current.add(chemin);
      void bridge.projets.arbre(dossier, chemin).then((r) => {
        enCours.current.delete(chemin);
        lus.current.add(chemin);
        // Un autre projet entre-temps : ses dossiers lus repartent de zéro.
        const lu = r.ok ? r.data : { erreur: r.message };
        setDossiers((d) => ({ dossier, contenus: { ...(d.dossier === dossier ? d.contenus : {}), [chemin]: lu } }));
      });
    },
    [bridge, project.folder],
  );

  useEffect(() => {
    if (!bridge) return;
    let actif = true;
    enCours.current.clear();
    lus.current.clear();
    const lire = () =>
      void bridge.projets.arbre(project.folder).then((r) => {
        if (!actif) return;
        setEtat(r.ok ? { dossier: project.folder, noeuds: r.data, erreur: null } : { dossier: project.folder, noeuds: [], erreur: r.message });
      });
    lire();
    // Au retour sur l'app : la racine et chaque dossier déjà ouvert, relus.
    const auRetour = () => {
      if (document.visibilityState !== "visible") return;
      lire();
      for (const chemin of lus.current) lireDossier(chemin);
    };
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      actif = false;
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [bridge, project.folder, lireDossier]);

  const contenu = useCallback(
    (chemin: string) => (dossiers.dossier === project.folder ? dossiers.contenus[chemin] : undefined),
    [dossiers, project.folder],
  );
  const charger = useCallback(
    (chemin: string) => {
      if (!enCours.current.has(chemin) && !lus.current.has(chemin)) lireDossier(chemin);
    },
    [lireDossier],
  );

  if (!bridge) return { noeuds: project.files, erreur: null, contenu: SANS_CHARGEMENT, charger: SANS_CHARGEMENT };
  if (!etat || etat.dossier !== project.folder) return { noeuds: [], erreur: null, contenu, charger };
  return { noeuds: etat.noeuds, erreur: etat.erreur, contenu, charger };
}
