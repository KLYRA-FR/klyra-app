"use client";

import { useEffect, useState } from "react";
import { useLecturePoste, type LecturePoste } from "@/lib/poste/client";
import { texteErreurPoste } from "@/lib/poste-texte";

/** Ce que dit un geste qui n'a pas abouti : P-10 sans réponse, sinon la phrase de l'ordinateur (C-1f). */
export function messageGeste(r: { code: string; message: string }, sur: string): string {
  return texteErreurPoste(r, sur);
}

/**
 * Une lecture du poste pour les écrans Automatisations : relue au retour dans l'app, suivie tant
 * qu'une exécution tourne (rien n'arrive tout seul du poste, M-7), et, pendant une relecture, l'écran
 * garde ce qu'il montrait au lieu de repasser par « Demande à ton Mac… ».
 * `garde` : ce qui compte comme « la même lecture » (par défaut, le type et les arguments).
 */
export function useLectureSuivie<T>(
  type: string,
  args: unknown | null,
  options: { suivre?: (data: T) => boolean; intervalle?: number; garde?: string } = {},
): LecturePoste<T> & { relancer: () => void; relecture: boolean } {
  const lecture = useLecturePoste<T>(type, args);
  const { relancer } = lecture;
  const cle = args === null ? null : `${type}|${options.garde ?? JSON.stringify(args)}`;
  const [gardee, setGardee] = useState<{ cle: string; data: T } | null>(null);
  /* Ce qu'on a lu en dernier, retenu pendant le rendu (pas d'effet) : la relecture le montre aussitôt. */
  if (lecture.etat === "ok" && cle !== null && (gardee?.cle !== cle || gardee.data !== lecture.data)) setGardee({ cle, data: lecture.data });
  const relecture = lecture.etat === "attente" && gardee !== null && gardee.cle === cle;
  const vue: LecturePoste<T> & { relancer: () => void; relecture: boolean } =
    relecture && gardee ? { etat: "ok", data: gardee.data, relancer, relecture: true } : { ...lecture, relecture: false };

  const suivre = lecture.etat === "ok" && !!options.suivre?.(lecture.data);
  const intervalle = options.intervalle ?? 5000;
  const donnees = lecture.etat === "ok" ? lecture.data : null;
  useEffect(() => {
    if (!suivre) return;
    const minuteur = setTimeout(relancer, intervalle);
    return () => clearTimeout(minuteur);
  }, [suivre, donnees, relancer, intervalle]);

  useEffect(() => {
    const revenir = () => {
      if (document.visibilityState === "visible") relancer();
    };
    document.addEventListener("visibilitychange", revenir);
    return () => document.removeEventListener("visibilitychange", revenir);
  }, [relancer]);

  return vue;
}
