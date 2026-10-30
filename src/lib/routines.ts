"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBridge } from "@/lib/bridge";
import type { Routine, RoutineInput, RoutinePatch, RoutineRun } from "@/types/routines";

/** Source de l'écran : uniquement le moteur Electron, jamais les anciennes routines du workspace. */
export function useRoutines() {
  const api = getBridge()?.routines;
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [enCours, setEnCours] = useState<RoutineRun[]>([]);
  const [version, setVersion] = useState(0);
  const [charge, setCharge] = useState(false);
  const [actif, setActif] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const revision = useRef(0);
  const actualiser = useCallback(async () => {
    const id = ++revision.current;
    if (!api) {
      setErreur("Les routines s’exécutent dans l’app de bureau KLYRA, ouverte sur cet ordinateur.");
      setCharge(true);
      return;
    }
    try {
      const etat = await api.etat();
      if (id !== revision.current) return;
      if (!etat.ok) throw new Error(etat.message);
      setActif(etat.data.actif);
      setErreur(etat.data.erreur);
      if (etat.data.actif) {
        const [liste, runs] = await Promise.all([api.lister(), api.enCours()]);
        if (id !== revision.current) return;
        if (!liste.ok) throw new Error(liste.message);
        setRoutines(liste.data);
        if (!runs.ok) throw new Error(runs.message);
        setEnCours(runs.data);
        setVersion((v) => v + 1);
      }
      setCharge(true);
    } catch (error) {
      if (id === revision.current) {
        setErreur(error instanceof Error ? error.message : String(error));
        setCharge(true);
      }
    }
  }, [api]);
  useEffect(() => {
    // Abonnement à la source Electron ; le navigateur reçoit un état indisponible immédiat.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void actualiser();
    const stop = api?.onChange(() => void actualiser());
    // Compteur de requêtes asynchrones, pas une référence de nœud DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { ++revision.current; stop?.(); };
  }, [api, actualiser]);

  const demander = async <T,>(operation: (() => Promise<{ ok: true; data: T } | { ok: false; message: string; code?: string }>) | undefined): Promise<T> => {
    if (!api || !operation) throw new Error("Le moteur des routines n’est pas disponible.");
    const r = await operation();
    if (!r.ok) throw Object.assign(new Error(r.message), { code: r.code });
    return r.data;
  };
  return {
    routines, enCours, charge, actif, erreur, actualiser, revision: version,
    creer: (input: RoutineInput) => demander(() => api!.creer(input)),
    modifier: (id: string, patch: RoutinePatch) => demander(() => api!.modifier(id, patch)),
    supprimer: (id: string) => demander(() => api!.supprimer(id)),
    executer: (id: string) => demander(() => api!.executer(id)),
    interrompre: (id: string) => demander(() => api!.interrompre(id)),
    historique: (id: string): Promise<RoutineRun[]> => demander(() => api!.historique(id, 100)),
    prochaines: (id: string): Promise<string[]> => demander(() => api!.prochaines(id)),
  };
}
