import type { RoutineSchedule } from "./schedule";
import type { RelaisRoutine, RoutineInput } from "./types";

/**
 * Les routines de l'ancien minuteur de l'interface (gardées dans `conversations.json`),
 * converties pour le moteur. L'historique d'avant n'est pas repris (il n'a ni statut ni résultat).
 */

/** L'ancienne fréquence : `semaine.jour` va de 1 (lundi) à 7 (dimanche). */
export type AncienneFrequence =
  | { type: "manuel" }
  | { type: "heure" }
  | { type: "jour"; heure: string }
  | { type: "jours-ouvres"; heure: string }
  | { type: "semaine"; jour: number; heure: string }
  | { type: "mois"; jour: number; heure: string };

export interface AncienneRoutine {
  id: string;
  nom: string;
  roleId: string;
  consigne: string;
  frequence: AncienneFrequence;
  projectId: string | null;
  active: boolean;
  prochaine?: string;
  relais?: RelaisRoutine[];
  positions?: Record<string, { x: number; y: number }>;
}

export function convertirFrequence(f: AncienneFrequence): RoutineSchedule {
  switch (f.type) {
    case "manuel": return { kind: "manual" };
    // L'ancien calcul partait à chaque heure pile.
    case "heure": return { kind: "hourly", minute: 0 };
    case "jour": return { kind: "daily", time: f.heure };
    case "jours-ouvres": return { kind: "weekdays", time: f.heure };
    case "semaine": return { kind: "weekly", weekday: f.jour % 7, time: f.heure };
    case "mois": return { kind: "monthly", day: f.jour, time: f.heure };
  }
}

/** Les champs du moteur, plus ce que le moteur garde sans l'exécuter (relais, positions). */
export function convertirRoutine(ancienne: AncienneRoutine, timezone: string): {
  input: RoutineInput;
  extras: { relais?: RelaisRoutine[]; positions?: Record<string, { x: number; y: number }>; nextRunAt?: string };
} {
  return {
    input: {
      agentId: ancienne.roleId,
      name: ancienne.nom,
      instruction: ancienne.consigne,
      schedule: convertirFrequence(ancienne.frequence),
      timezone,
      active: ancienne.active,
      // L'ancien minuteur rattrapait une fois l'heure passée app fermée.
      missedPolicy: "run-once",
      projectId: ancienne.projectId ?? null,
    },
    extras: { relais: ancienne.relais, positions: ancienne.positions, nextRunAt: ancienne.prochaine },
  };
}
