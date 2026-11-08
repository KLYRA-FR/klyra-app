"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBridge, type EtatGit } from "@/lib/bridge";
import { useWorkspace } from "@/lib/workspace";
import type { Project } from "@/types/domain";

/** Un geste a changé le dépôt d'un projet (récupérer, publier) : ceux qui l'affichent le relisent. */
const EVENEMENT = "klyra:depot";
export function signalerDepot(projetId: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENEMENT, { detail: projetId }));
}

/**
 * L'état git d'un projet (branche, ce qui attend, fichiers modifiés), lu là où il vit : par la connexion GitHub
 * de sa machine pour un dépôt ouvert depuis GitHub (PC ou VPS), par le git du poste pour un dossier de ce PC.
 * Relu quand un geste le change, quand la fenêtre revient au premier plan et quand un agent du projet finit.
 */
export function useEtatDepot(project: Project) {
  const git = getBridge()?.git;
  const github = getBridge()?.github;
  const natif = !!project.githubConnecte && !!github;
  const disponible = natif || (!project.lieu && !!git?.recuperer);
  const [etat, setEtat] = useState<EtatGit | null>(null);
  const [lecture, setLecture] = useState(0);
  const relire = useCallback(() => setLecture((n) => n + 1), []);

  /* Un agent du projet au travail : à sa fin, ses fichiers modifiés comptent. */
  const { state } = useWorkspace();
  const occupe = Object.keys(state.travail).some((id) => state.chats.find((c) => c.id === id)?.projectId === project.id);
  const [occupeAvant, setOccupeAvant] = useState(occupe);
  if (occupe !== occupeAvant) {
    setOccupeAvant(occupe);
    if (!occupe) setLecture((n) => n + 1);
  }

  /* La dernière lecture : revenir à la fenêtre ne relit pas un état tout frais (un VPS répond par le réseau). */
  const derniere = useRef(0);
  useEffect(() => {
    if (!disponible) return;
    derniere.current = Date.now();
    let actif = true;
    void (natif ? github!.etatDepot(project.lieu ?? null, project.folder) : git!.etat(project.folder)).then((r) => actif && r.ok && setEtat(r.data));
    return () => {
      actif = false;
    };
  }, [disponible, natif, git, github, project.folder, project.lieu, lecture]);

  useEffect(() => {
    const surSignal = (e: Event) => (e as CustomEvent<string>).detail === project.id && relire();
    const surFocus = () => Date.now() - derniere.current > 15_000 && relire();
    window.addEventListener(EVENEMENT, surSignal);
    window.addEventListener("focus", surFocus);
    return () => {
      window.removeEventListener(EVENEMENT, surSignal);
      window.removeEventListener("focus", surFocus);
    };
  }, [project.id, relire]);

  /** `git pull --ff-only` (rien n'est écrasé) ; les autres vues du dépôt relisent. */
  const recuperer = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (natif) {
      const r = await github!.recuperer(project.lieu ?? null, project.folder, project.depot);
      if (!r.ok) return { ok: false, message: r.message };
      setEtat(r.data);
      signalerDepot(project.id);
      return { ok: true, message: "Nouveautés récupérées." };
    }
    if (!git?.recuperer) return { ok: false, message: "Récupérer marche dans l’app de bureau." };
    const r = await git.recuperer(project.folder);
    if (!r.ok) return { ok: false, message: r.message };
    setEtat(r.data.etat);
    signalerDepot(project.id);
    return { ok: r.data.ok, message: r.data.message };
  }, [natif, git, github, project.id, project.folder, project.lieu, project.depot]);

  return { etat, natif, disponible, relire, recuperer };
}
