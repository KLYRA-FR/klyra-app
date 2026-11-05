"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useCompte } from "@/lib/compte";
import { supportOuOrdinateur, type PosteLu } from "@/lib/poste-texte";
import { useHorsLigne } from "./BandeauReseau";

/**
 * Le seuil de `convex/postes.ts` (25 s), avec une marge pour l'horloge du téléphone. La requête du
 * compte calcule `ouvert` quand un poste se signale, mais n'est pas relue quand le temps passe : un
 * poste qui se ferme resterait « ouvert ». Le téléphone le referme lui-même, sans jamais l'ouvrir.
 */
const SILENCE_MS = 35_000;

function useHorloge(pas: number): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const minuteur = setInterval(() => setMaintenant(Date.now()), pas);
    return () => clearInterval(minuteur);
  }, [pas]);
  return maintenant;
}

/** Les ordinateurs du compte. Le téléphone ne s'y signale pas. */
export function usePostes() {
  const { etat } = useCompte();
  const lus = useQuery(api.postes.etat, etat === "connecte" ? {} : "skip");
  const maintenant = useHorloge(5000);
  const horsLigne = useHorsLigne();
  const postes = useMemo(
    () => lus?.map((poste) => (poste.ouvert && maintenant - poste.dernierSignal > SILENCE_MS ? { ...poste, ouvert: false } : poste)),
    [lus, maintenant],
  );
  const principal = postes?.[0] ?? null;
  return {
    postes,
    principal,
    /* Hors ligne, aucune demande ne peut partir : la lecture montre sa vue gardée, les gestes attendent (§ 5.5). */
    ouvert: !horsLigne && (postes?.some((poste) => poste.ouvert) ?? false),
    horsLigne,
    charge: etat === "connecte" && postes === undefined,
  };
}

const CLE_POSTE_RETENU = "klyra:telephone:poste";

/**
 * Le système et le nom du poste principal, gardés sur ce téléphone : après une déconnexion
 * depuis l'ordinateur, le compte ne se lit plus, mais l'écran de connexion sait encore le nommer.
 */
export function useRetenirPoste() {
  const { principal } = usePostes();
  const [systeme, nom] = [principal?.systeme ?? null, principal?.nom ?? null];
  useEffect(() => {
    if (systeme === null || nom === null) return;
    try {
      localStorage.setItem(CLE_POSTE_RETENU, JSON.stringify({ systeme, nom }));
    } catch {
      /* sans stockage : « ton ordinateur » */
    }
  }, [systeme, nom]);
}

export function posteRetenu(): Pick<PosteLu, "systeme" | "nom"> | null {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_POSTE_RETENU) ?? "null") as Partial<PosteLu> | null;
    if (!brut || typeof brut.nom !== "string" || !["mac", "windows", "autre"].includes(brut.systeme as string)) return null;
    return { systeme: brut.systeme as PosteLu["systeme"], nom: brut.nom };
  } catch {
    return null;
  }
}

/** « ton PC », « ton Mac », « ton ordinateur », ou le nom du poste s'il y en a plusieurs. */
export function useSupport(): string {
  const { principal, postes } = usePostes();
  return supportOuOrdinateur(principal, (postes?.length ?? 0) > 1);
}
