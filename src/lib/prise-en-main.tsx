"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChoixPriseEnMain, PriseEnMain } from "../../electron/prise-en-main-modele";
import { getBridge, unwrap } from "@/lib/bridge";

interface Parcours {
  etat: PriseEnMain | null;
  charge: boolean;
  erreur: string | null;
  relire: () => Promise<void>;
  changer: (choix: ChoixPriseEnMain) => Promise<PriseEnMain>;
}
const Context = createContext<Parcours | null>(null);

export function PriseEnMainProvider({ children }: { children: ReactNode }) {
  const pont = getBridge()?.priseEnMain;
  const [etat, setEtat] = useState<PriseEnMain | null>(null);
  const [charge, setCharge] = useState(!pont);
  const [erreur, setErreur] = useState<string | null>(null);
  const version = useRef(0);
  const relire = useCallback(async () => {
    if (!pont) return;
    const lecture = ++version.current;
    try {
      const lu = unwrap(await pont.lire());
      if (lecture !== version.current) return;
      setEtat(lu);
      setErreur(null);
    } catch (e) {
      if (lecture === version.current) setErreur(e instanceof Error ? e.message : "La prise en main n’a pas pu être lue.");
    } finally {
      if (lecture === version.current) setCharge(true);
    }
  }, [pont]);
  useEffect(() => { const timer = setTimeout(() => { void relire(); }, 0); return () => clearTimeout(timer); }, [relire]);
  const changer = useCallback(async (choix: ChoixPriseEnMain) => {
    if (!pont) throw new Error("Relance KLYRA pour commencer la prise en main.");
    const ecriture = ++version.current;
    const suivant = unwrap(await pont.ecrire(choix));
    if (ecriture === version.current) { setEtat(suivant); setErreur(null); }
    return suivant;
  }, [pont]);
  return <Context.Provider value={{ etat, charge, erreur, relire, changer }}>{children}</Context.Provider>;
}

export function usePriseEnMain(): Parcours {
  const contexte = useContext(Context);
  if (!contexte) throw new Error("PriseEnMainProvider absent.");
  return contexte;
}
