"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { modeleDe } from "@/lib/mobile";

/**
 * Hors de l'app de bureau : cette session dit qu'elle est ouverte, pour la liste « Téléphones
 * connectés » de Réglages › Mobile. À l'ouverture, puis à chaque retour au premier plan ; le
 * serveur n'écrit `vu` qu'une fois par minute. L'ordinateur se signale par `SignalPoste`.
 */
export function SignalTelephone({ actif }: { actif: boolean }) {
  const signaler = useMutation(api.telephones.signaler);

  useEffect(() => {
    if (!actif) return;
    const modele = modeleDe(navigator.userAgent);
    const envoyer = () => {
      if (document.visibilityState !== "visible") return;
      void signaler({ modele }).catch(() => {
        /* Le prochain retour au premier plan réessaie. */
      });
    };
    envoyer();
    document.addEventListener("visibilitychange", envoyer);
    return () => document.removeEventListener("visibilitychange", envoyer);
  }, [actif, signaler]);

  return null;
}
