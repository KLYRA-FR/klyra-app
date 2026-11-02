"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getBridge } from "@/lib/bridge";
import { PLATEFORME } from "@/lib/plateforme";

const CLE = "klyra:poste:cle";

/** La clé de cet ordinateur, si `SignalPoste` l'a déjà créée (Réglages › Mobile retrouve sa ligne). */
export function lireClePoste(): string | null {
  try {
    const gardee = localStorage.getItem(CLE);
    return gardee && /^[\w-]{8,80}$/.test(gardee) ? gardee : null;
  } catch {
    return null;
  }
}

function clePoste(): string {
  const gardee = localStorage.getItem(CLE);
  if (gardee && /^[\w-]{8,80}$/.test(gardee)) return gardee;
  const neuve = crypto.randomUUID();
  localStorage.setItem(CLE, neuve);
  return neuve;
}

/** L'ordinateur dit qu'il est ouvert. Le téléphone n'appelle pas ça. */
export function SignalPoste({ actif }: { actif: boolean }) {
  const signaler = useMutation(api.postes.signaler);
  const nom = useRef("Cet ordinateur");

  useEffect(() => {
    if (!actif) return;
    let arrete = false;
    const cle = clePoste();
    const envoyer = () => {
      if (arrete) return;
      void signaler({ cle, systeme: PLATEFORME, nom: nom.current }).catch(() => {
        /* Le prochain signal réessaie. */
      });
    };
    void getBridge()
      ?.systeme.utilisateur()
      .then((reponse) => {
        if (reponse.ok && reponse.data.nom.trim()) nom.current = reponse.data.nom.trim().slice(0, 80);
        envoyer();
      });
    const minuteur = setInterval(envoyer, 10_000);
    return () => {
      arrete = true;
      clearInterval(minuteur);
    };
  }, [actif, signaler]);

  return null;
}
