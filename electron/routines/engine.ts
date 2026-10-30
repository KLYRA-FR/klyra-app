import { randomUUID } from "node:crypto";
import { nextOccurrence, upcomingOccurrences, validateSchedule } from "./schedule";
import type { RoutineStore } from "./store";
import {
  isTerminal,
  type MissedReason,
  type Routine,
  type RoutineInput,
  type RoutinePatch,
  type RoutineRun,
  type RunReport,
} from "./types";

/**
 * Le planificateur des routines, dans le process principal. Sans Electron :
 * l'horloge, le minuteur et l'interface sont fournis de l'extérieur (tests).
 *
 * - Un seul minuteur, vers la prochaine échéance de toutes les routines.
 * - Une échéance = au plus une exécution (contrôle avant écriture + contrainte du store).
 * - L'app fermée ou l'ordinateur en veille à l'heure prévue : jamais de rattrapage
 *   en rafale. `skip` résume les échéances manquées dans un seul enregistrement,
 *   `run-once` exécute la plus récente, en retard.
 * - Une exécution part dans la conversation de l'agent par l'interface (`host`),
 *   qui la poste par le chemin habituel des messages et rend compte de son état.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const HOUR = 60 * MINUTE;
/**
 * Le minuteur se réveille au plus tard toutes les minutes : sur macOS et Linux, un `setTimeout`
 * ne compte pas le temps de veille, et l'horloge peut être corrigée. Un réveil sans échéance ne fait rien.
 */
export const MAX_TIMER_MS = MINUTE;
/** Une échéance tombée il y a moins que ça part normalement (minuteur en retard, App Nap, ouverture à l'heure pile). */
export const GRACE_MS = 5 * MINUTE;
/** Au-delà, l'historique dit « plus de 999 ». */
const MISSED_CAP = 999;
const NAME_MAX = 80;
const INSTRUCTION_MAX = 100_000;
const RESULT_MAX = 4_000;
const ERROR_MAX = 2_000;
const AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class RoutineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface EngineHost {
  /** Confie l'exécution à l'interface. false : aucune interface prête, elle attend en file. */
  deliver(run: RoutineRun, routine: Routine | undefined): boolean;
  /** Retire l'exécution de la file de la conversation, ou arrête la réponse en cours. */
  cancel(run: RoutineRun): void;
}

export interface EngineOptions {
  store: RoutineStore;
  host: EngineHost;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  newId?: () => string;
  defaultTimezone?: () => string;
  onChange?: () => void;
  log?: (message: string, error?: unknown) => void;
}

export class RoutineEngine {
  private readonly store: RoutineStore;
  private readonly host: EngineHost;
  private readonly now: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly newId: () => string;
  private readonly defaultTimezone: () => string;
  private readonly onChange: () => void;
  private readonly log: (message: string, error?: unknown) => void;
  private timer: unknown = null;
  private started = false;
  private hostReady = false;
  /** Routines dont l'échéance n'a pas pu être traitée (écriture impossible) : nouvel essai à `at`, délai doublé jusqu'à 1 h. */
  private readonly retry = new Map<string, { at: number; delay: number }>();

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.host = options.host;
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.newId = options.newId ?? randomUUID;
    this.defaultTimezone = options.defaultTimezone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    this.onChange = options.onChange ?? (() => {});
    this.log = options.log ?? (() => {});
  }

  /* ─── Cycle de vie ─────────────────────────────────────────── */

  /** Au lancement : reprise après un arrêt, échéances manquées, puis le minuteur. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const now = this.now();
    try {
      // Le Claude Code d'une exécution en cours s'arrête avec l'app : elle ne reprendra pas.
      this.interruptRunning("L’app s’est fermée pendant l’exécution.");
      this.catchUpAll(now, "app-closed");
      this.dispatch();
    } finally {
      this.arm();
      this.onChange();
    }
  }

  stop(): void {
    this.started = false;
    this.disarm();
  }

  /**
   * Mise en veille : rien à faire, le minuteur ne part pas pendant la veille et le
   * réveil passe par `resume` ou par le minuteur d'une minute. Gardé pour la lisibilité.
   */
  suspend(): void {}

  /** Réveil (avec ou sans mise en veille signalée) : le manqué est regroupé tout de suite. */
  resume(): void {
    this.tick();
  }

  /** La fenêtre est partie (fermée, rechargée) : ses réponses en cours ne reviendront pas. */
  interruptRunning(reason: string): RoutineRun[] {
    const now = this.now();
    const running = this.store.runs.filter((r) => r.status === "running").map((r) => structuredClone(r));
    if (!running.length) return [];
    this.store.transaction((data) => {
      for (const run of data.runs) if (run.status === "running") Object.assign(run, finish(now, "interrupted", reason));
    });
    this.dispatch();
    this.onChange();
    return running;
  }

  /** L'interface est chargée : elle reçoit les exécutions confiées et celles en attente. */
  setHostReady(ready: boolean): void {
    this.hostReady = ready;
    if (!ready || !this.started) return;
    for (const run of this.store.runs) {
      if (isTerminal(run.status) || !run.dispatchedAt) continue;
      // L'interface ignore une exécution déjà postée (même id) : seul son état revient.
      this.host.deliver(run, this.store.routine(run.routineId));
    }
    this.dispatch();
  }

  /* ─── Lecture ──────────────────────────────────────────────── */

  list(agentId?: string): Routine[] {
    return this.store.routines
      .filter((r) => !agentId || r.agentId === agentId)
      .map((r) => structuredClone(r))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): Routine {
    return structuredClone(this.routine(id));
  }

  history(routineId: string, limit = 50): RoutineRun[] {
    this.routine(routineId);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RoutineError("invalide", "Nombre d’exécutions invalide.");
    return this.store.history(routineId, limit);
  }

  /** Les prochaines exécutions sur `days` jours ; aucune en pause. */
  upcoming(routineId: string, days = 7, limit = 200): string[] {
    const routine = this.routine(routineId);
    if (!routine.active || !routine.nextRunAt) return [];
    const end = this.now().getTime() + days * DAY;
    const first = routine.nextRunAt;
    const rest = upcomingOccurrences(routine.schedule, routine.timezone, new Date(first), Math.max(0, limit - 1));
    return [first, ...rest].filter((at) => Date.parse(at) <= end);
  }

  /** Exécutions confiées à l'interface et pas encore finies. */
  activeRuns(): RoutineRun[] {
    return this.store.runs.filter((r) => !isTerminal(r.status)).map((r) => structuredClone(r));
  }

  /* ─── Écriture ─────────────────────────────────────────────── */

  create(input: RoutineInput): Routine {
    const now = this.now();
    if (!input || typeof input !== "object") throw new RoutineError("invalide", "Routine invalide.");
    const agentId = agent(input.agentId);
    const timezone = input.timezone ?? this.defaultTimezone();
    const schedule = this.schedule(input.schedule, timezone, now);
    const active = input.active ?? true;
    if (typeof active !== "boolean") throw new RoutineError("invalide", "État actif invalide.");
    const routine: Routine = {
      id: this.newId(),
      agentId,
      name: name(input.name),
      instruction: instruction(input.instruction),
      schedule,
      timezone,
      active,
      nextRunAt: active ? nextOccurrence(schedule, timezone, now) : null,
      missedPolicy: schedule.kind === "once" ? "run-once" : missedPolicy(input.missedPolicy ?? "skip"),
      projectId: projectId(input.projectId ?? null),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.store.transaction((data) => void data.routines.push(routine));
    this.arm();
    this.onChange();
    return structuredClone(routine);
  }

  /** Champs omis inchangés. Planning, fuseau ou reprise : prochaine échéance recalculée depuis maintenant. */
  update(id: string, patch: RoutinePatch): Routine {
    const now = this.now();
    const current = this.routine(id);
    if (!patch || typeof patch !== "object") throw new RoutineError("invalide", "Modification invalide.");
    const next: Routine = { ...structuredClone(current), updatedAt: now.toISOString() };
    if (patch.name !== undefined) next.name = name(patch.name);
    if (patch.instruction !== undefined) next.instruction = instruction(patch.instruction);
    if (patch.projectId !== undefined) next.projectId = projectId(patch.projectId);
    if (patch.relais !== undefined) next.relais = structuredClone(patch.relais);
    if (patch.positions !== undefined) next.positions = structuredClone(patch.positions);
    if (patch.active !== undefined && typeof patch.active !== "boolean") throw new RoutineError("invalide", "État actif invalide.");
    const planning = patch.schedule !== undefined || patch.timezone !== undefined;
    if (planning) {
      next.timezone = patch.timezone ?? current.timezone;
      next.schedule = this.schedule(patch.schedule ?? current.schedule, next.timezone, now);
    }
    if (patch.missedPolicy !== undefined) next.missedPolicy = missedPolicy(patch.missedPolicy);
    if (next.schedule.kind === "once") next.missedPolicy = "run-once";
    const reprise = patch.active === true && !current.active;
    next.active = patch.active ?? current.active;
    if (!next.active) next.nextRunAt = null;
    else if (planning || reprise) {
      next.nextRunAt = nextOccurrence(next.schedule, next.timezone, now);
      if (!next.nextRunAt && next.schedule.kind === "once") {
        throw new RoutineError("date-passee", "Choisissez une nouvelle date future pour réactiver cette routine.");
      }
    }
    this.store.transaction((data) => {
      data.routines = data.routines.map((r) => (r.id === id ? next : r));
    });
    this.retry.delete(id);
    this.arm();
    this.onChange();
    return structuredClone(next);
  }

  /** Supprime la routine et son historique. Refusé pendant qu'une exécution tourne. */
  remove(id: string): void {
    this.routine(id);
    const runs = this.store.runs.filter((r) => r.routineId === id && !isTerminal(r.status));
    if (runs.some((r) => r.status === "running")) {
      throw new RoutineError("en-cours", "Interrompez d’abord l’exécution en cours.");
    }
    for (const run of runs) if (run.dispatchedAt) this.host.cancel(run);
    try {
      this.store.transaction((data) => {
        data.routines = data.routines.filter((r) => r.id !== id);
        data.runs = data.runs.filter((r) => r.routineId !== id);
      });
      this.retry.delete(id);
      this.dispatch();
    } finally {
      this.arm();
      this.onChange();
    }
  }

  /**
   * Reprend les routines de l'ancien minuteur (une seule fois, en une transaction).
   * Les identifiants sont gardés : la conversation `routine-<id>` d'une routine de projet continue.
   * Une routine invalide est signalée et laissée dans l'ancien fichier, jamais perdue.
   */
  importLegacy(items: { id: string; input: RoutineInput; extras: RoutinePatch }[]): { imported: number; errors: string[] } {
    const now = this.now();
    const errors: string[] = [];
    const routines: Routine[] = [];
    for (const item of items) {
      try {
        if (typeof item.id !== "string" || !item.id || item.id.length > 200) throw new RoutineError("invalide", "Identifiant invalide.");
        if (this.store.routine(item.id) || routines.some((r) => r.id === item.id)) continue;
        const timezone = item.input.timezone ?? this.defaultTimezone();
        const schedule = this.schedule(item.input.schedule, timezone, now);
        const active = item.input.active ?? true;
        routines.push({
          id: item.id,
          agentId: agent(item.input.agentId),
          name: name(item.input.name),
          instruction: instruction(item.input.instruction),
          schedule,
          timezone,
          active,
          nextRunAt: active ? nextOccurrence(schedule, timezone, now) : null,
          missedPolicy: schedule.kind === "once" ? "run-once" : missedPolicy(item.input.missedPolicy ?? "skip"),
          projectId: projectId(item.input.projectId ?? null),
          ...(item.extras.relais?.length ? { relais: structuredClone(item.extras.relais) } : {}),
          ...(item.extras.positions ? { positions: structuredClone(item.extras.positions) } : {}),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
      } catch (error) {
        errors.push(`${String(item?.input?.name ?? item?.id)} : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.store.transaction((data) => void data.routines.push(...routines));
    this.arm();
    this.onChange();
    return { imported: routines.length, errors };
  }

  /** « Exécuter maintenant » : une exécution manuelle, sans toucher à la programmation. */
  runNow(id: string): RoutineRun {
    const routine = this.routine(id);
    if (this.store.runs.some((r) => r.routineId === id && !isTerminal(r.status))) {
      throw new RoutineError("deja-en-cours", "Cette routine a déjà une exécution en cours ou en attente.");
    }
    const now = this.now();
    const run = this.newRun(routine, "manual", now.toISOString(), now);
    this.store.transaction((data) => void data.runs.push(run));
    this.dispatch();
    this.onChange();
    return structuredClone(this.store.run(run.id) ?? run);
  }

  /** Arrête une exécution : retirée de la file si elle n'a pas commencé, interrompue sinon. Distinct de la pause. */
  interrupt(runId: string): RoutineRun {
    const run = this.store.run(runId);
    if (!run) throw new RoutineError("introuvable", "Exécution introuvable.");
    if (isTerminal(run.status)) throw new RoutineError("terminee", "Cette exécution est déjà terminée.");
    if (run.dispatchedAt) this.host.cancel(run);
    const now = this.now();
    const commencee = run.status === "running";
    this.store.transaction((data) => {
      const cible = data.runs.find((r) => r.id === runId)!;
      Object.assign(
        cible,
        finish(now, commencee ? "interrupted" : "cancelled", commencee ? "Interrompue." : "Annulée avant son lancement."),
      );
    });
    this.dispatch();
    this.onChange();
    return structuredClone(this.store.run(runId)!);
  }

  /** Ce que l'interface dit d'une exécution qu'on lui a confiée. Une exécution finie ne change plus. */
  report(runId: string, report: RunReport): void {
    const run = this.store.run(runId);
    if (!run || isTerminal(run.status) || !report || typeof report !== "object") return;
    const sansConversation = report.state === "failed" && report.chatId === null;
    if (!sansConversation && (typeof report.chatId !== "string" || !report.chatId)) return;
    const now = this.now();
    this.store.transaction((data) => {
      const cible = data.runs.find((r) => r.id === runId)!;
      cible.updatedAt = now.toISOString();
      switch (report.state) {
        case "queued":
          cible.delivery = { chatId: report.chatId, messageId: cible.delivery?.messageId ?? null };
          break;
        case "running":
          cible.status = "running";
          cible.startedAt ??= now.toISOString();
          cible.delivery = { chatId: report.chatId, messageId: String(report.messageId) };
          break;
        case "succeeded":
          Object.assign(cible, finish(now, "succeeded", null));
          cible.startedAt ??= now.toISOString();
          cible.delivery = { chatId: report.chatId, messageId: String(report.messageId) };
          cible.result = String(report.result ?? "").slice(0, RESULT_MAX);
          break;
        case "failed":
          Object.assign(
            cible,
            finish(now, "failed", String(report.error || "L’agent s’est arrêté sur une erreur.").slice(0, ERROR_MAX)),
          );
          cible.delivery = report.chatId ? { chatId: report.chatId, messageId: report.messageId ? String(report.messageId) : null } : null;
          break;
      }
    });
    if (report.state === "succeeded" || report.state === "failed") this.dispatch();
    this.onChange();
  }

  /* ─── Minuteur ─────────────────────────────────────────────── */

  /** Un seul minuteur, vers l'échéance la plus proche ; réarmé à chaque changement. */
  private arm(): void {
    this.disarm();
    if (!this.started) return;
    let prochaine = Infinity;
    for (const r of this.store.routines) {
      if (!r.active || !r.nextRunAt) continue;
      prochaine = Math.min(prochaine, this.retry.get(r.id)?.at ?? Date.parse(r.nextRunAt));
    }
    if (!Number.isFinite(prochaine)) return;
    const delai = Math.min(MAX_TIMER_MS, Math.max(0, prochaine - this.now().getTime()));
    this.timer = this.setTimer(() => this.tick(), delai);
  }

  private disarm(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  /** Échéances dues : celles à l'heure partent, celles trop en retard (veille non signalée) sont regroupées. */
  tick(): void {
    this.disarm();
    if (!this.started) return;
    try {
      this.catchUpAll(this.now(), "sleep");
      this.dispatch();
    } finally {
      this.arm();
      this.onChange();
    }
  }

  private catchUpAll(now: Date, reason: MissedReason): void {
    for (const routine of [...this.store.routines]) {
      if (!routine.active || !routine.nextRunAt || Date.parse(routine.nextRunAt) > now.getTime()) continue;
      if ((this.retry.get(routine.id)?.at ?? 0) > now.getTime()) continue;
      // Une routine en erreur n'arrête pas les autres.
      try {
        this.catchUp(routine.id, now, reason);
        this.retry.delete(routine.id);
      } catch (error) {
        this.log(`Routine ${routine.id} : échéance non traitée.`, error);
        this.skipAhead(routine.id, now, error);
      }
    }
  }

  /**
   * Toutes les échéances dues d'une routine, en une transaction : au plus une exécution,
   * les autres résumées dans un enregistrement « cancelled », et le déclencheur avancé.
   */
  private catchUp(id: string, now: Date, reason: MissedReason): void {
    this.store.transaction((data) => {
      const routine = data.routines.find((r) => r.id === id);
      if (!routine?.active || !routine.nextRunAt) return;
      const first = Date.parse(routine.nextRunAt);
      const t = now.getTime();
      if (first > t) return;
      const { schedule, timezone } = routine;
      const latest = lastBetween(routine, first, t);
      const onTime = t - latest <= GRACE_MS ? latest : null;
      const missedEnd = onTime === null ? latest : onTime - 1;
      const missed = missedEnd >= first ? countBetween(routine, first, missedEnd) : null;

      let run: { scheduledFor: number; late: boolean } | null = null;
      let summary = missed;
      if (onTime !== null) run = { scheduledFor: onTime, late: false };
      else if (routine.missedPolicy === "run-once" && missed) {
        run = { scheduledFor: missed.last, late: true };
        summary = missed.count > 1 ? { ...missed, count: missed.count - 1, last: lastBetween(routine, first, missed.last - 1) } : null;
      }

      if (summary) this.recordMissed(data.runs, routine, first, summary, reason, now);
      if (run) {
        const scheduledFor = new Date(run.scheduledFor).toISOString();
        const deja = data.runs.some((r) => r.routineId === id && r.kind === "scheduled" && !r.missed && r.scheduledFor === scheduledFor);
        const enAttente = data.runs.some((r) => r.routineId === id && r.status === "queued");
        if (deja) {
          // Déjà créée (deux minuteurs, reprise) : rien de plus.
        } else if (enAttente) {
          // La précédente attend encore son tour : pas de seconde exécution en file.
          this.recordMissed(data.runs, routine, run.scheduledFor, { count: 1, capped: false, last: run.scheduledFor }, "busy", now);
        } else {
          const nouvelle = this.newRun(routine, "scheduled", scheduledFor, now);
          if (run.late) nouvelle.late = true;
          data.runs.push(nouvelle);
        }
      }
      if (schedule.kind === "once") {
        routine.active = false;
        routine.nextRunAt = null;
      } else {
        routine.nextRunAt = nextOccurrence(schedule, timezone, now);
      }
      routine.updatedAt = now.toISOString();
    });
  }

  /**
   * Après une erreur : l'échéance est notée en échec et le déclencheur avance. Si même cela
   * échoue (écriture impossible), nouvel essai plus tard (1 min, puis le double, 1 h au plus).
   */
  private skipAhead(id: string, now: Date, cause: unknown): void {
    try {
      this.store.transaction((data) => {
        const routine = data.routines.find((r) => r.id === id);
        if (!routine?.nextRunAt) return;
        const scheduledFor = routine.nextRunAt;
        if (!data.runs.some((r) => r.routineId === id && r.kind === "scheduled" && !r.missed && r.scheduledFor === scheduledFor)) {
          const run = this.newRun(routine, "scheduled", scheduledFor, now);
          Object.assign(run, finish(now, "failed", `Échéance non traitée : ${cause instanceof Error ? cause.message : String(cause)}`.slice(0, ERROR_MAX)));
          data.runs.push(run);
        }
        routine.nextRunAt = routine.schedule.kind === "once" ? null : nextOccurrence(routine.schedule, routine.timezone, now);
        if (!routine.nextRunAt) routine.active = false;
        routine.updatedAt = now.toISOString();
      });
      this.retry.delete(id);
    } catch (error) {
      const delay = Math.min(HOUR, (this.retry.get(id)?.delay ?? MINUTE / 2) * 2);
      this.retry.set(id, { at: now.getTime() + delay, delay });
      this.log(`Routine ${id} : échéance toujours bloquée, nouvel essai dans ${Math.round(delay / MINUTE)} min.`, error);
    }
  }

  /** Un seul enregistrement par série de manqués : celui d'avant est complété s'il est le dernier de la routine. */
  private recordMissed(
    runs: RoutineRun[],
    routine: Routine,
    first: number,
    missed: { count: number; capped: boolean; last: number },
    reason: MissedReason,
    now: Date,
  ): void {
    // La dernière écrite ; à la même milliseconde, l'ordre du tableau départage.
    let dernier: RoutineRun | undefined;
    for (const r of runs) if (r.routineId === routine.id && (!dernier || r.createdAt >= dernier.createdAt)) dernier = r;
    if (dernier?.missed && dernier.missed.reason === reason && dernier.status === "cancelled") {
      const total = dernier.missed.count + missed.count;
      dernier.missed = {
        count: Math.min(MISSED_CAP, total),
        capped: dernier.missed.capped || missed.capped || total > MISSED_CAP,
        until: new Date(missed.last).toISOString(),
        reason,
      };
      dernier.updatedAt = now.toISOString();
      return;
    }
    const run = this.newRun(routine, "scheduled", new Date(first).toISOString(), now);
    run.status = "cancelled";
    run.finishedAt = now.toISOString();
    run.error = MISSED_TEXT[reason];
    run.missed = { count: Math.min(MISSED_CAP, missed.count), capped: missed.capped || missed.count > MISSED_CAP, until: new Date(missed.last).toISOString(), reason };
    runs.push(run);
  }

  /* ─── File par agent ───────────────────────────────────────── */

  /** Une exécution de routine à la fois par agent ; les suivantes attendent en file. */
  private dispatch(): void {
    if (!this.started || !this.hostReady) return;
    const occupes = new Set(
      this.store.runs.filter((r) => r.status === "running" || (r.status === "queued" && r.dispatchedAt)).map((r) => r.agentId),
    );
    const enFile = this.store.runs
      .filter((r) => r.status === "queued" && !r.dispatchedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const run of enFile) {
      if (occupes.has(run.agentId)) continue;
      let confiee = false;
      try {
        confiee = this.host.deliver(run, this.store.routine(run.routineId));
      } catch (error) {
        this.log(`Exécution ${run.id} : l’interface ne l’a pas reçue.`, error);
      }
      if (!confiee) return;
      occupes.add(run.agentId);
      const at = this.now().toISOString();
      try {
        this.store.transaction((data) => {
          const cible = data.runs.find((r) => r.id === run.id);
          if (cible) Object.assign(cible, { dispatchedAt: at, updatedAt: at });
        });
      } catch (error) {
        // Confiée quand même : l'interface ne la poste qu'une fois (même id) si elle revient.
        this.log(`Exécution ${run.id} : confiée, mais non notée sur le disque.`, error);
      }
    }
  }

  /* ─── Outils ───────────────────────────────────────────────── */

  private routine(id: string): Routine {
    const routine = typeof id === "string" ? this.store.routine(id) : undefined;
    if (!routine) throw new RoutineError("introuvable", "Routine introuvable.");
    return routine;
  }

  private schedule(value: unknown, timezone: string, now: Date) {
    try {
      return validateSchedule(value, timezone, now);
    } catch (error) {
      throw new RoutineError("programmation", error instanceof Error ? error.message : String(error));
    }
  }

  private newRun(routine: Routine, kind: RoutineRun["kind"], scheduledFor: string, now: Date): RoutineRun {
    const at = now.toISOString();
    return {
      id: this.newId(),
      routineId: routine.id,
      agentId: routine.agentId,
      kind,
      scheduledFor,
      routineName: routine.name,
      instruction: routine.instruction,
      projectId: routine.projectId,
      status: "queued",
      error: null,
      dispatchedAt: null,
      delivery: null,
      result: null,
      createdAt: at,
      startedAt: null,
      finishedAt: null,
      updatedAt: at,
    };
  }

}

function finish(now: Date, status: RoutineRun["status"], error: string | null): Partial<RoutineRun> {
  return { status, error, finishedAt: now.toISOString(), updatedAt: now.toISOString() };
}

const MISSED_TEXT: Record<MissedReason, string> = {
  "app-closed": "Non exécutée : l’app était fermée.",
  sleep: "Non exécutée : l’ordinateur était en veille.",
  busy: "Non exécutée : l’exécution précédente attendait encore son tour.",
};

/** La dernière échéance dans [from, to] ; `from` en est une. Fenêtres croissantes pour rester rapide. */
function lastBetween(routine: Routine, from: number, to: number): number {
  for (const fenetre of [DAY, 32 * DAY, 400 * DAY, Infinity]) {
    const debut = Math.max(from, to - fenetre);
    let last: number | null = null;
    let next = nextOccurrence(routine.schedule, routine.timezone, new Date(debut - 1));
    while (next && Date.parse(next) <= to) {
      last = Date.parse(next);
      next = nextOccurrence(routine.schedule, routine.timezone, new Date(last));
    }
    if (last !== null) return last;
  }
  return from;
}

/** Nombre d'échéances dans [from, to], plafonné. */
function countBetween(routine: Routine, from: number, to: number): { count: number; capped: boolean; last: number } {
  let count = 1;
  let cursor = from;
  while (count <= MISSED_CAP) {
    const next = nextOccurrence(routine.schedule, routine.timezone, new Date(cursor));
    if (!next || Date.parse(next) > to) return { count, capped: false, last: cursor };
    cursor = Date.parse(next);
    count++;
  }
  return { count: MISSED_CAP, capped: true, last: lastBetween(routine, cursor, to) };
}

function agent(value: unknown): string {
  if (typeof value !== "string" || !AGENT.test(value)) throw new RoutineError("invalide", "Agent invalide.");
  return value;
}

function name(value: unknown): string {
  const texte = typeof value === "string" ? value.trim() : "";
  if (!texte || texte.length > NAME_MAX) throw new RoutineError("invalide", `Le nom doit faire de 1 à ${NAME_MAX} caractères.`);
  return texte;
}

function instruction(value: unknown): string {
  const texte = typeof value === "string" ? value.trim() : "";
  if (!texte) throw new RoutineError("invalide", "La consigne est vide.");
  if (texte.length > INSTRUCTION_MAX) throw new RoutineError("invalide", "La consigne est trop longue (100 000 caractères au plus).");
  return texte;
}

function missedPolicy(value: unknown) {
  if (value !== "skip" && value !== "run-once") throw new RoutineError("invalide", "Politique de rattrapage invalide.");
  return value;
}

function projectId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value || value.length > 200) throw new RoutineError("invalide", "Projet invalide.");
  return value;
}
