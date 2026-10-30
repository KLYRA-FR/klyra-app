/**
 * Les routines du moteur (process principal), telles que l'interface les reçoit.
 * Reflet de `electron/routines/types.ts` et `schedule.ts` : les deux changent ensemble.
 */

export type RoutineSchedule =
  /** Propre à KLYRA (l'ancienne fréquence « manuel ») : jamais d'elle-même, seulement « Exécuter ». */
  | { kind: "manual" }
  | { kind: "once"; date: string; time: string }
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "interval"; amount: number; unit: "minutes" | "hours" | "days"; anchorAt: string }
  | {
      kind: "advanced";
      months: number[];
      days:
        | { kind: "every-day" }
        | { kind: "days-of-week"; days: number[] }
        | { kind: "days-of-month"; days: number[] };
      time: { kind: "at-time"; time: string } | { kind: "every"; amount: number; unit: "minutes" | "hours" };
    }
  | { kind: "custom"; expression: string };

export type MissedPolicy = "skip" | "run-once";

/** Un relais de l'ancienne chaîne (« quand X a répondu, sa réponse part à Y ») : gardé tel quel, pas encore exécuté par le moteur. */
export interface RelaisRoutine {
  id: string;
  de: string;
  vers: string;
  consigne: string;
}

/** Une routine : un agent, une consigne autonome, un déclencheur. Ce n'est pas un workflow. */
export interface Routine {
  id: string;
  /** L'agent propriétaire : « principal » ou le nom de sa fiche (`~/.claude/agents/<nom>.md`). */
  agentId: string;
  name: string;
  instruction: string;
  schedule: RoutineSchedule;
  /** Fuseau IANA : les heures du planning sont lues dans ce fuseau. */
  timezone: string;
  active: boolean;
  /** Prochaine échéance (UTC), null en pause, pour une routine manuelle ou une « une fois » passée. */
  nextRunAt: string | null;
  missedPolicy: MissedPolicy;
  /** Rangée dans un projet : elle part dans la conversation d'équipe du projet (comportement existant). */
  projectId: string | null;
  relais?: RelaisRoutine[];
  positions?: Record<string, { x: number; y: number }>;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = "queued" | "running" | "needs-attention" | "succeeded" | "failed" | "interrupted" | "cancelled";

/** Pourquoi des échéances n'ont pas été exécutées. */
export type MissedReason = "app-closed" | "sleep" | "busy";

export interface RoutineRun {
  id: string;
  routineId: string;
  agentId: string;
  kind: "scheduled" | "manual";
  /** L'échéance visée ; pour un lancement manuel, l'instant du clic. */
  scheduledFor: string;
  /** Instantanés au lancement : l'historique survit à une modification de la routine. */
  routineName: string;
  instruction: string;
  projectId: string | null;
  status: RunStatus;
  /** Message lisible (échec, interruption, raison de l'annulation). */
  error: string | null;
  /** Exécutée en retard, au retour de l'app (politique run-once). */
  late?: boolean;
  /** Un enregistrement « cancelled » qui résume des échéances non exécutées. */
  missed?: { count: number; capped: boolean; until: string | null; reason: MissedReason };
  /** Confiée à l'interface : elle doit la poster dans la conversation de l'agent. */
  dispatchedAt: string | null;
  /** Où lire le résultat : la conversation et la réponse de l'agent. */
  delivery: { chatId: string; messageId: string | null } | null;
  /** Début de la réponse de l'agent (le texte complet reste dans la conversation). */
  result: string | null;
  outcome?: "no-update" | "failed";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

/** Ce que l'interface dit d'une exécution qu'on lui a confiée. */
export type RunReport =
  | { state: "queued"; chatId: string }
  | { state: "running"; chatId: string; messageId: string }
  | { state: "succeeded"; chatId: string; messageId: string; result: string }
  /** Sans conversation : l'exécution n'a pas pu être postée (agent introuvable…). */
  | { state: "failed"; chatId: string | null; messageId: string | null; error: string };

export type RoutineInput = {
  agentId: string;
  name: string;
  instruction: string;
  schedule: RoutineSchedule;
  timezone?: string;
  active?: boolean;
  missedPolicy?: MissedPolicy;
  projectId?: string | null;
};

export type RoutinePatch = Partial<RoutineInput> & {
  relais?: RelaisRoutine[];
  positions?: Record<string, { x: number; y: number }>;
};
