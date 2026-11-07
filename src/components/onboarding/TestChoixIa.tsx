"use client";

import { useEffect, useRef, useState } from "react";
import type { EtatMoteur } from "@/lib/moteurs";
import { FOURNISSEURS } from "@/lib/fournisseurs";
import { VueChoixIa, type ChoixIaProps, type VueChoixIaProps } from "./VueChoixIa";

/** Contrôleur local distinct : le mode test ne monte jamais le contrôleur des vrais comptes. */
export function TestChoixIa(props: ChoixIaProps) {
  const [moteurs, setMoteurs] = useState<EtatMoteur[]>(() => FOURNISSEURS.map((f) => ({
    moteur: { id: f.id, nom: f.moteur, fournisseur: f.nom, chemin: null, gere: true, installable: true },
    compte: null, modeles: null, erreur: null,
  })));
  const [action, setAction] = useState<VueChoixIaProps["action"]>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [cle, setCle] = useState("");
  const vivant = useRef(true);
  const verrou = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annulerAttente = useRef<(() => void) | null>(null);
  useEffect(() => {
    vivant.current = true;
    return () => {
      vivant.current = false;
      if (timer.current) clearTimeout(timer.current);
      annulerAttente.current?.();
    };
  }, []);
  const avancer = async () => {
    const id = props.choix;
    if (!id || verrou.current) return;
    const courant = moteurs.find((m) => m.moteur.id === id)!;
    verrou.current = true;
    setErreur(null);
    try {
      if (courant.compte?.connecte) { await props.continuer(id); return; }
      const installe = !!courant.moteur.chemin;
      setAction(installe ? "connexion" : "installation");
      await new Promise<void>((resolve) => {
        annulerAttente.current = resolve;
        timer.current = setTimeout(resolve, 500);
      });
      if (!vivant.current) return;
      setMoteurs((avant) => avant.map((m) => m.moteur.id !== id ? m : {
        ...m, moteur: { ...m.moteur, chemin: "simulation" },
        compte: { installe: true, chemin: "simulation", version: null, connecte: installe, methode: null, email: null, organisation: null, abonnement: null, verifieLe: Date.now() },
      }));
    } catch {
      if (vivant.current) setErreur("Le test n’a pas abouti. Réessaie.");
    } finally {
      verrou.current = false;
      if (vivant.current) { setAction(null); setCle(""); }
    }
  };
  return <VueChoixIa {...props} simulation moteurs={moteurs} lecture={null} erreur={erreur} action={action} progression={null} cle={cle} setCle={setCle} setErreur={setErreur} avancer={avancer} actualiser={async () => { setErreur(null); }} />;
}
