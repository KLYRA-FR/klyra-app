import { cleJour, depuisCle } from "@/lib/dates";
import type { Routine, RoutineRun, RoutineSchedule } from "@/types/routines";

/**
 * Ce que le Planning des agents montre des routines : chaque départ à venir et
 * chaque exécution passée à son heure, et les routines qui partent plusieurs
 * fois par heure ou par jour sur une seule ligne par jour, pour ne pas noyer la grille.
 */

/** Un départ à venir (`run` nul) ou une exécution déjà créée, à son jour et sa minute (heure du poste). */
export interface BlocRoutine {
  id: string;
  routine: Routine;
  jour: string;
  minute: number;
  at: string;
  run: RoutineRun | null;
}

/** Une routine fréquente un jour donné : combien d'exécutions, dont combien en échec. */
export interface LigneFrequente {
  routine: Routine;
  jour: string;
  runs: number;
  echecs: number;
}

/** Plusieurs départs par jour : une ligne par jour plutôt qu'un bloc par départ. */
export function estFrequente(s: RoutineSchedule): boolean {
  if (s.kind === "hourly") return true;
  if (s.kind === "interval") return s.unit !== "days";
  if (s.kind === "advanced") return s.time.kind === "every";
  return false;
}

/** Une routine fréquente tombe-t-elle ce jour-là ? (0 = dimanche, comme le moteur.) */
function tombeLe(s: RoutineSchedule, d: Date): boolean {
  if (s.kind !== "advanced") return true;
  if (!s.months.includes(d.getMonth() + 1)) return false;
  if (s.days.kind === "days-of-week") return s.days.days.includes(d.getDay());
  if (s.days.kind === "days-of-month") return s.days.days.includes(d.getDate());
  return true;
}

const minuteDe = (d: Date) => d.getHours() * 60 + d.getMinutes();

export function calendrierRoutines({
  routines,
  passages,
  runs,
  debut,
  fin,
  maintenant,
  agent = null,
}: {
  routines: Routine[];
  /** Les départs à venir, calculés par le moteur. */
  passages: { routineId: string; at: string }[];
  runs: RoutineRun[];
  debut: Date;
  fin: Date;
  maintenant: Date;
  /** Seulement les routines de cet agent. */
  agent?: string | null;
}): { blocs: Map<string, BlocRoutine[]>; frequentes: Map<string, LigneFrequente[]> } {
  const blocs = new Map<string, BlocRoutine[]>();
  const frequentes = new Map<string, LigneFrequente[]>();
  const parId = new Map(routines.filter((r) => !agent || r.agentId === agent).map((r) => [r.id, r]));
  const dansPlage = (d: Date) => d >= debut && d < fin;
  const vus = new Set<string>();

  const pousserBloc = (routine: Routine, at: string, run: RoutineRun | null) => {
    const d = new Date(at);
    const jour = cleJour(d);
    blocs.set(jour, [...(blocs.get(jour) ?? []), { id: run?.id ?? `${routine.id}@${at}`, routine, jour, minute: minuteDe(d), at, run }]);
  };
  const ligne = (routine: Routine, jour: string) => {
    const liste = frequentes.get(jour) ?? [];
    let l = liste.find((x) => x.routine.id === routine.id);
    if (!l) {
      l = { routine, jour, runs: 0, echecs: 0 };
      frequentes.set(jour, [...liste, l]);
    }
    return l;
  };

  for (const run of runs) {
    const routine = parId.get(run.routineId);
    const d = new Date(run.scheduledFor);
    if (!routine || !dansPlage(d)) continue;
    vus.add(`${run.routineId}@${run.scheduledFor}`);
    if (estFrequente(routine.schedule)) {
      const l = ligne(routine, cleJour(d));
      /* Un résumé d'échéances manquées n'est pas une exécution. */
      if (!run.missed) l.runs++;
      if (run.status === "failed") l.echecs++;
    } else pousserBloc(routine, run.scheduledFor, run);
  }

  for (const p of passages) {
    const routine = parId.get(p.routineId);
    if (!routine || estFrequente(routine.schedule) || vus.has(`${p.routineId}@${p.at}`) || !dansPlage(new Date(p.at))) continue;
    pousserBloc(routine, p.at, null);
  }

  /* Les fréquentes actives : une ligne chaque jour à venir où elles tombent. */
  const auj = cleJour(maintenant);
  for (const routine of parId.values()) {
    if (!routine.active || routine.blockedReason || routine.relais?.length || !estFrequente(routine.schedule)) continue;
    for (const d = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate()); d < fin; d.setDate(d.getDate() + 1)) {
      if (cleJour(d) >= auj && tombeLe(routine.schedule, d)) ligne(routine, cleJour(d));
    }
  }

  for (const liste of blocs.values()) liste.sort((a, b) => a.at.localeCompare(b.at));
  for (const liste of frequentes.values()) liste.sort((a, b) => a.routine.name.localeCompare(b.routine.name, "fr"));
  return { blocs, frequentes };
}

/** Le jour de la semaine d'un créneau, comme le moteur (0 = dimanche). */
export const jourSemaine = (cle: string) => depuisCle(cle).getDay();

/** `/routines` sur le formulaire d'une nouvelle routine, chaque semaine ce jour-là à cette heure. */
export function lienNouvelleRoutine(cle: string, heure: string, agent: string | null): string {
  return `/routines?vue=routines${agent ? `&agent=${encodeURIComponent(agent)}` : ""}&creneau=${jourSemaine(cle)}-${heure}`;
}

/** Le créneau demandé par le Planning (`&creneau=2-09:30`), ou null. */
export function lireCreneau(valeur: string | null): { weekday: number; time: string } | null {
  const m = valeur?.match(/^([0-6])-([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? { weekday: Number(m[1]), time: `${m[2]}:${m[3]}` } : null;
}
