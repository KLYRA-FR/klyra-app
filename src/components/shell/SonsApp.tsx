"use client";

import { useEffect, useRef } from "react";
import { useMaj } from "@/lib/maj";
import { demarrerSons, jouer, notificationSonore } from "@/lib/sons/sons";

/**
 * Démarre les sons de l'app (réglages, système), une fois, et fait entendre
 * la mise à jour prête : seulement quand elle le devient pendant que l'app
 * est ouverte, et si la notification du système ne sonne pas déjà.
 */
export function SonsApp() {
  useEffect(() => demarrerSons(), []);

  const { etat } = useMaj();
  const statut = useRef<string | null>(null);
  useEffect(() => {
    if (!etat) return;
    const avant = statut.current;
    statut.current = etat.statut;
    if (avant && avant !== "prete" && etat.statut === "prete" && !notificationSonore("majPrete")) jouer("maj-prete");
  }, [etat]);

  return null;
}
