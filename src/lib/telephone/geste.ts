"use client";

import { useCallback, useRef, useState } from "react";
import { useBandeau } from "@/components/telephone/etats";
import { usePostes, useSupport } from "@/components/telephone/poste";
import { useGestePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { texteErreurFiche } from "./agents";

/**
 * Un geste à la fois (§ 3) : un second appui ne part pas, même avant que l'écran se redessine.
 * `uneFois(geste)` ne le lance que si aucun autre n'est en cours.
 */
export function useUneFois() {
  const verrou = useRef(false);
  return useCallback(async (geste: () => Promise<void>) => {
    if (verrou.current) return;
    verrou.current = true;
    try {
      await geste();
    } finally {
      verrou.current = false;
    }
  }, []);
}

/**
 * Un geste du téléphone sur l'ordinateur, avec ce que l'écran en montre : « occupé », le bandeau
 * de succès (« Enregistré »), l'erreur dite en clair (P-10, conflit de la fiche…). Poste fermé, les
 * boutons sont désactivés par l'écran (`ouvert`, P-7), jamais mis en attente (M-6).
 */
export function useGesteTelephone() {
  const { faire, occupe } = useGestePoste();
  const { ouvert } = usePostes();
  const sur = useSupport();
  const [bandeau, montrer] = useBandeau();
  const [erreur, setErreur] = useState<{ code: string; message: string } | null>(null);

  const agir = useCallback(
    async <T>(type: string, args: unknown, succes?: string | ((data: T) => string | null), options?: { delai?: number }): Promise<T | null> => {
      setErreur(null);
      const r = await faire<T>(type, args, options);
      if (!r.ok) {
        setErreur({ code: r.code, message: r.code === "delai" ? `${majuscule(sur)} ne répond pas.` : texteErreurFiche(r.code, r.message, sur) });
        return null;
      }
      const texte = typeof succes === "function" ? succes(r.data) : succes;
      if (texte) montrer(texte);
      return r.data;
    },
    [faire, montrer, sur],
  );

  return { agir, occupe, ouvert, bandeau, montrer, erreur, setErreur };
}
