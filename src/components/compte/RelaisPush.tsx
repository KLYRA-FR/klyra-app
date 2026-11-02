"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useCompte } from "@/lib/compte";
import { EVENEMENT_POUSSER, type DemandePush } from "@/lib/push";

/**
 * L'ordinateur prévient les téléphones du compte (spec mobile § 8) : il relaie au compte ce que
 * `pousserAuTelephone` demande. Le compte n'envoie qu'aux téléphones abonnés à cet événement.
 * Le téléphone ne monte pas ce composant.
 */
export function RelaisPush() {
  const { etat } = useCompte();
  const pousser = useMutation(api.notificationsPush.pousser);

  useEffect(() => {
    if (etat !== "connecte") return;
    const relayer = (e: Event) => {
      void pousser((e as CustomEvent<DemandePush>).detail).catch(() => {
        /* Hors ligne ou refusé : la notification du bureau a eu lieu, le téléphone s'en passe. */
      });
    };
    window.addEventListener(EVENEMENT_POUSSER, relayer);
    return () => window.removeEventListener(EVENEMENT_POUSSER, relayer);
  }, [etat, pousser]);

  return null;
}
