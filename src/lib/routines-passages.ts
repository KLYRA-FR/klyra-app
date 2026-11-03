"use client";

import { useEffect, useState } from "react";
import { getBridge } from "@/lib/bridge";
import type { Routine, RoutineRun } from "@/types/routines";

export interface PassageRoutine {
  routine: Routine;
  at: string;
}

const AUCUN: PassageRoutine[] = [];

/** Les passages viennent du moteur, avec son fuseau et ses gardes d'exécution. */
export function usePassagesRoutines(debut: Date, fin: Date): PassageRoutine[] {
  const bridge = getBridge();
  const api = bridge?.routines;
  const depuis = debut.toISOString();
  const jusqua = fin.toISOString();
  const plage = `${depuis}/${jusqua}`;
  const [lecture, setLecture] = useState<{ plage: string; passages: PassageRoutine[] } | null>(null);

  useEffect(() => {
    if (!api) return;
    let generation = 0;
    const actualiser = async () => {
      const id = ++generation;
      try {
        const [liste, echeances] = await Promise.all([api.lister(), api.passages(depuis, jusqua)]);
        if (id !== generation) return;
        if (!liste.ok || !echeances.ok) {
          setLecture({ plage, passages: AUCUN });
          return;
        }
        const routines = new Map(liste.data.map((routine) => [routine.id, routine]));
        const passages = echeances.data.flatMap(({ routineId, at }) => {
          const routine = routines.get(routineId);
          // Les passages horaires restent masqués, comme dans le calendrier précédent.
          if (!routine?.active || routine.relais?.length || routine.schedule.kind === "hourly") return [];
          return [{ routine, at }];
        });
        setLecture({ plage, passages });
      } catch {
        // Ne jamais conserver un ancien planning comme si le moteur fonctionnait encore.
        if (id === generation) setLecture({ plage, passages: AUCUN });
      }
    };
    void actualiser();
    const arreterRoutines = api.onChange(() => void actualiser());
    const arreterAgents = bridge?.agents.onChange(() => void actualiser());
    return () => {
      ++generation;
      arreterRoutines();
      arreterAgents?.();
    };
  }, [api, bridge, depuis, jusqua, plage]);

  return api && lecture?.plage === plage ? lecture.passages : AUCUN;
}

export interface CalendrierRoutines {
  routines: Routine[];
  passages: { routineId: string; at: string }[];
  runs: RoutineRun[];
}

const VIDE: CalendrierRoutines = { routines: [], passages: [], runs: [] };

/**
 * Le Planning des agents : les routines, leurs départs à venir et, si la
 * période commence dans le passé, leurs exécutions de la période (historique
 * du moteur ou du VPS qui les tient ; une routine injoignable est montrée sans son passé).
 */
export function useCalendrierRoutines(debut: Date, fin: Date): CalendrierRoutines {
  const bridge = getBridge();
  const api = bridge?.routines;
  const depuis = debut.toISOString();
  const jusqua = fin.toISOString();
  const plage = `${depuis}/${jusqua}`;
  const [lecture, setLecture] = useState<{ plage: string; donnees: CalendrierRoutines } | null>(null);

  useEffect(() => {
    if (!api) return;
    let generation = 0;
    const actualiser = async () => {
      const id = ++generation;
      try {
        const [liste, echeances] = await Promise.all([api.lister(), api.passages(depuis, jusqua)]);
        if (id !== generation) return;
        if (!liste.ok || !echeances.ok) {
          setLecture({ plage, donnees: VIDE });
          return;
        }
        const passe = Date.parse(depuis) < Date.now();
        const historiques = passe ? await Promise.allSettled(liste.data.map((r) => api.historique(r.id, 200))) : [];
        if (id !== generation) return;
        const runs = historiques
          .flatMap((h) => (h.status === "fulfilled" && h.value.ok ? h.value.data : []))
          .filter((r) => r.scheduledFor >= depuis && r.scheduledFor < jusqua);
        setLecture({ plage, donnees: { routines: liste.data, passages: echeances.data, runs } });
      } catch {
        // Ne jamais conserver un ancien planning comme si le moteur fonctionnait encore.
        if (id === generation) setLecture({ plage, donnees: VIDE });
      }
    };
    void actualiser();
    const arreterRoutines = api.onChange(() => void actualiser());
    const arreterAgents = bridge?.agents.onChange(() => void actualiser());
    return () => {
      ++generation;
      arreterRoutines();
      arreterAgents?.();
    };
  }, [api, bridge, depuis, jusqua, plage]);

  return api && lecture?.plage === plage ? lecture.donnees : VIDE;
}
