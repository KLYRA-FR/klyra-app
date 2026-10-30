"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PLATEFORME } from "@/lib/plateforme";
import { ouvrirRecherche } from "@/lib/recherche-session";

/** Vrai sur Mac : ⌘ plutôt que Ctrl (même lecture du système que `plateforme.ts`). */
export function estMac(): boolean {
  return PLATEFORME === "mac";
}

/** ⌘ sur Mac, Ctrl ailleurs, sans les autres modificateurs. */
export function avecCommande(e: KeyboardEvent): boolean {
  return (estMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey;
}

/** ⌘ , (Ctrl , sous Windows) ouvre les Réglages, comme dans les apps du système. */
export function useRaccourciReglages() {
  const router = useRouter();
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== "," || !avecCommande(e) || e.shiftKey) return;
      e.preventDefault();
      router.push("/reglages");
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [router]);
}

/** ⌘K (Ctrl+K sous Windows) ouvre ou ferme la recherche dans les conversations, de partout, même depuis le composeur. */
export function useRaccourciRecherche() {
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !avecCommande(e) || e.shiftKey) return;
      /* Une autre fenêtre est ouverte : pas d'empilement. */
      if (document.querySelector('[aria-modal="true"]:not([data-recherche])')) return;
      e.preventDefault();
      ouvrirRecherche(true);
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);
}
