"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { lieuRetenu, retenirLieu, useLieuActif, useServeursRelies } from "@/lib/lieux";
import { useAnnonce } from "./Annonce";
import { useSupport } from "./poste";

/**
 * Le serveur affiché sur ce téléphone (lot 8, E8-07 à E8-14) : celui que retient `useLieuActif`, propre à
 * cet appareil ; les listes le suivent par les hooks de `src/lib/telephone/espace`. `choisir` annonce le
 * changement une fois. Ce téléphone ne change d'espace que sur un geste, sauf si le serveur n'est plus relié.
 */
export function useEspaceAffiche() {
  const lieu = useLieuActif();
  const serveurs = useServeursRelies();
  const annoncer = useAnnonce();
  const sur = useSupport();
  const serveur = lieu ? (serveurs.find((s) => s.adresse === lieu) ?? null) : null;
  const adresses = useMemo(() => serveurs.map((s) => s.adresse), [serveurs]);
  const choisir = useCallback(
    (cible: string | null) => {
      retenirLieu(cible);
      const nom = cible ? serveurs.find((s) => s.adresse === cible)?.nom : null;
      annoncer(nom ? { texte: `Tu vois ${nom} : ses chats, ses projets et ses routines.`, icone: "globe-01" } : { texte: `Tu vois de nouveau ${sur}.`, icone: "computer" });
    },
    [annoncer, serveurs, sur],
  );
  return { lieu, serveur, serveurs, adresses, choisir };
}

/**
 * E8-14 : le serveur affiché n'est plus relié (retiré ou quitté) : retour sur l'ordinateur, sans rien garder de
 * cet espace (les listes le filtrent déjà), et une annonce. Un retour choisi efface le lieu retenu : pas d'annonce.
 */
export function SuiviEspace() {
  const lieu = useLieuActif();
  const serveurs = useServeursRelies();
  const annoncer = useAnnonce();
  const sur = useSupport();
  const avant = useRef<{ lieu: string | null; nom: string | null }>({ lieu: null, nom: null });
  useEffect(() => {
    const precedent = avant.current;
    if (precedent.lieu && !lieu && lieuRetenu() === precedent.lieu) {
      retenirLieu(null);
      annoncer(`${precedent.nom ?? "Ce serveur"} n’est plus relié à ce téléphone : tu vois de nouveau ${sur}.`);
    }
    avant.current = { lieu, nom: lieu ? (serveurs.find((s) => s.adresse === lieu)?.nom ?? precedent.nom) : null };
  }, [lieu, serveurs, annoncer, sur]);
  return null;
}
