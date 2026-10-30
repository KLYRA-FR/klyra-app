import { randomUUID } from "node:crypto";
import { nextOccurrence, validateSchedule } from "./schedule";
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
const LEGACY_CHAIN = "Cette ancienne routine contient des relais entre agents. Ses données sont conservées, mais elle ne peut pas être exécutée comme une routine à un seul agent.";

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
  /** null : l'agent existe et est actif ; sinon un motif lisible qui interdit son lancement. */
  agentError?: (agentId: string) => string | null;
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
  private readonly agentError: (agentId: string) => string | null;
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
    this.agentError = options.agentError ?? (() => null);
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
      // Les essais de l'ancien moteur ont pu conserver des chaînes actives. Les données
      // restent intactes ; aucune exécution partielle n'est présentée comme une migration réussie.
      if (this.store.routines.some((r) => blockedReason(r) && (r.active || r.nextRunAt || !r.blockedReason))) {
        this.store.transaction((data) => {
          for (const routine of data.routines) {
            const reason = blockedReason(routine);
            if (reason) Object.assign(routine, { blockedReason: reason, active: false, nextRunAt: null });
          }
        });
      }
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
  interruptRunning(reason: string, runIds?: readonly string[]): RoutineRun[] {
    const now = this.now();
    const running = this.store.runs.filter((r) => hasStarted(r) && (!runIds || runIds.includes(r.id))).map((r) => structuredClone(r));
    if (!running.length) return [];
    this.store.transaction((data) => {
      for (const run of data.runs) if (running.some((r) => r.id === run.id)) Object.assign(run, finish(now, "interrupted", reason));
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
      if (run.status !== "queued" || !run.dispatchedAt || this.failUnavailable(run)) continue;
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
    if (!routine.active || !routine.nextRunAt || blockedReason(routine) || this.agentIssue(routine.agentId)) return [];
    const end = this.now().getTime() + days * DAY;
    const dates: string[] = [];
    let at: string | null = routine.nextRunAt;
    while (at && dates.length < limit && Date.parse(at) <= end) {
      dates.push(at);
      at = nextOccurrence(routine.schedule, routine.timezone, new Date(at));
    }
    return dates;
  }

  /** Exécutions confiées à l'interface et pas encore finies. */
  passages(debut: string, fin: string): { routineId: string; at: string }[] {
    const from = Date.parse(debut), to = Date.parse(fin);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 93 * DAY) throw new RoutineError("invalide", "Période de calendrier invalide (93 jours maximum).");
    const threshold = Math.max(from, this.now().getTime());
    const result: { routineId: string; at: string }[] = [];
    for (const r of this.store.routines) {
      if (!r.active || !r.nextRunAt || blockedReason(r) || this.agentIssue(r.agentId)) continue;
      let at = Date.parse(r.nextRunAt) >= threshold ? r.nextRunAt : nextOccurrence(r.schedule, r.timezone, new Date(threshold - 1));
      for (let n = 0; at && Date.parse(at) < to && n < 62; n++) {
        result.push({ routineId: r.id, at });
        at = nextOccurrence(r.schedule, r.timezone, new Date(at));
      }
    }
    return result.sort((a, b) => a.at.localeCompare(b.at));
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
    this.requireAgent(agentId);
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
    if (patch.agentId !== undefined) {
      next.agentId = agent(patch.agentId);
      this.requireAgent(next.agentId);
    }
    // Seule la suppression volontaire des relais est permise ; la sauvegarde de migration reste intacte.
    const simplifier = Array.isArray(patch.relais) && patch.relais.length === 0 && !!current.relais?.length;
    if (simplifier) {
      next.relais = [];
      delete next.blockedReason;
    } else if (patch.relais !== undefined && JSON.stringify(patch.relais) !== JSON.stringify(current.relais ?? [])) {
      throw new RoutineError("relais-incompatibles", "Les anciens relais sont conservés et ne peuvent pas être modifiés par le moteur des routines.");
    }
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
    const reason = blockedReason(next);
    if (patch.active === true) {
      if (reason) throw new RoutineError("relais-incompatibles", reason);
      this.requireAgent(next.agentId);
    }
    next.active = patch.active ?? current.active;
    if (reason) Object.assign(next, { blockedReason: reason, active: false, nextRunAt: null });
    if (!next.active) next.nextRunAt = null;
    else if (planning || reprise || simplifier) {
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
    if (runs.some((r) => hasStarted(r))) {
      throw new RoutineError("en-cours", "Interrompez d’abord l’exécution en cours.");
    }
    try {
      this.store.transaction((data) => {
        data.routines = data.routines.filter((r) => r.id !== id);
        data.runs = data.runs.filter((r) => r.routineId !== id);
      });
      for (const run of runs) if (run.dispatchedAt) this.host.cancel(run);
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
   * Une routine invalide fait refuser l'import complet : aucune reprise partielle silencieuse.
   */
  importLegacy(items: { id: string; input: RoutineInput; extras: RoutinePatch & { nextRunAt?: string } }[]): { imported: number; errors: string[] } {
    const now = this.now();
    const errors: string[] = [];
    const routines: Routine[] = [];
    for (const item of items) {
      try {
        if (typeof item.id !== "string" || !item.id || item.id.length > 200) throw new RoutineError("invalide", "Identifiant invalide.");
        if (this.store.routine(item.id) || routines.some((r) => r.id === item.id)) continue;
        const timezone = item.input.timezone ?? this.defaultTimezone();
        const schedule = this.schedule(item.input.schedule, timezone, now);
        const blocked = item.extras.relais?.length ? LEGACY_CHAIN : undefined;
        const active = blocked ? false : item.input.active ?? true;
        if (typeof active !== "boolean") throw new RoutineError("invalide", "État actif invalide.");
        // « Manuel » utilisait une date sentinelle à l'extrémité du calendrier JS.
        // Elle n'est pas une échéance ; les routines en pause n'ont pas de date due non plus.
        const previous = !active || schedule.kind === "manual" || item.extras.nextRunAt === undefined ? undefined : legacyInstant(item.extras.nextRunAt);
        routines.push({
          id: item.id,
          agentId: agent(item.input.agentId),
          name: name(item.input.name),
          instruction: instruction(item.input.instruction),
          schedule,
          timezone,
          active,
          nextRunAt: active && schedule.kind !== "manual" ? previous ?? nextOccurrence(schedule, timezone, now) : null,
          missedPolicy: schedule.kind === "once" ? "run-once" : missedPolicy(item.input.missedPolicy ?? "skip"),
          projectId: projectId(item.input.projectId ?? null),
          ...(item.extras.relais?.length ? { relais: structuredClone(item.extras.relais) } : {}),
          ...(item.extras.positions ? { positions: structuredClone(item.extras.positions) } : {}),
          ...(blocked ? { blockedReason: blocked } : {}),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
      } catch (error) {
        errors.push(`${String(item?.input?.name ?? item?.id)} : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (errors.length) throw new RoutineError("migration", `Les anciennes routines n’ont pas été reprises. Les données sont conservées. ${errors.join("\n")}`);
    this.store.transaction((data) => void data.routines.push(...routines));
    this.arm();
    this.onChange();
    return { imported: routines.length, errors };
  }

  /** « Exécuter maintenant » : une exécution manuelle, sans toucher à la programmation. */
  runNow(id: string): RoutineRun {
    const routine = this.routine(id);
    const reason = blockedReason(routine);
    if (reason) throw new RoutineError("relais-incompatibles", reason);
    this.requireAgent(routine.agentId);
    if (this.store.runs.some((r) => r.routineId === id && !isTerminal(r.status))) {
      throw new RoutineError("deja-en-cours", "Cette routine a déjà une exécution en cours ou en attente.");
    }
    const now = this.now();
    const run = this.newRun(routine, "manual", now.toISOString(), now);
    this.store.transaction((data) => void data.runs.push(run));
    this.dispatch();
    this.arm();
    this.onChange();
    return structuredClone(this.store.run(run.id) ?? run);
  }

  /** Arrête une exécution : retirée de la file si elle n'a pas commencé, interrompue sinon. Distinct de la pause. */
  interrupt(runId: string): RoutineRun {
    const run = this.store.run(runId);
    if (!run) throw new RoutineError("introuvable", "Exécution introuvable.");
    if (isTerminal(run.status)) throw new RoutineError("terminee", "Cette exécution est déjà terminée.");
    const now = this.now();
    const commencee = hasStarted(run);
    this.store.transaction((data) => {
      const cible = data.runs.find((r) => r.id === runId)!;
      Object.assign(
        cible,
        finish(now, commencee ? "interrupted" : "cancelled", commencee ? "Interrompue." : "Annulée avant son lancement."),
      );
    });
    if (run.dispatchedAt) this.host.cancel(run);
    this.dispatch();
    this.arm();
    this.onChange();
    return structuredClone(this.store.run(runId)!);
  }

  /**
   * Appelé par le main, juste avant le véritable envoi à Claude Code. La prise en charge
   * est écrite sur disque avant tout effet ; un rechargement, même immédiat, ne peut pas
   * remettre le même run en file. Un arrêt entre cette écriture et l'envoi reste interrompu.
   */
  claim(runId: string, chatId: string, messageId: string, agentId: string): void {
    const run = this.store.run(runId);
    if (!run) throw new RoutineError("introuvable", "Exécution introuvable.");
    if (run.status !== "queued" || run.startedAt) throw new RoutineError("deja-lancee", "Cette exécution a déjà été prise en charge ou est terminée.");
    if (!run.dispatchedAt) throw new RoutineError("non-confiee", "Cette exécution attend encore d’être confiée à l’agent.");
    if (agentId !== run.agentId) throw new RoutineError("agent-invalide", "L’agent ne correspond pas à celui de cette exécution.");
    if (![chatId, messageId].every((v) => typeof v === "string" && v.length > 0 && v.length <= 200)) {
      throw new RoutineError("invalide", "La conversation ou le message de l’exécution est invalide.");
    }
    const reason = this.unavailable(run);
    if (reason) {
      this.failUnavailable(run, reason);
      this.dispatch();
      throw new RoutineError("agent-indisponible", reason);
    }
    const at = this.now().toISOString();
    this.store.transaction((data) => {
      const cible = data.runs.find((r) => r.id === runId)!;
      Object.assign(cible, { status: "running", startedAt: at, updatedAt: at, delivery: { chatId, messageId } });
    });
    this.onChange();
  }

  /** L'attente d'une permission est observée par le main, puis levée par un événement explicite. */
  attention(runId: string, waiting: boolean): void {
    const run = this.store.run(runId);
    if (!run || !hasStarted(run)) return;
    const status = waiting ? "needs-attention" : "running";
    if (run.status === status) return;
    this.store.transaction((data) => {
      const cible = data.runs.find((r) => r.id === runId)!;
      Object.assign(cible, { status, updatedAt: this.now().toISOString() });
    });
    this.onChange();
  }

  /** Un outil de la vraie exécution peut préciser son résultat, sans libérer son agent avant la fin du tour. */
  signal(runId: string, outcome: "no-update" | "failed", reason?: string): void {
    const run = this.store.run(runId);
    if (!run || !run.startedAt || !hasStarted(run)) throw new RoutineError("hors-execution", "Ce signal exige une exécution de routine en cours.");
    if (outcome !== "no-update" && outcome !== "failed") throw new RoutineError("invalide", "Signal de routine invalide.");
    const error = outcome === "failed" ? String(reason ?? "").trim() : null;
    if (outcome === "failed" && (!error || error.length > ERROR_MAX)) throw new RoutineError("invalide", `Expliquez l’échec en 1 à ${ERROR_MAX} caractères.`);
    if (outcome === "no-update" && run.outcome === "failed") throw new RoutineError("echec-signale", "Un échec a déjà été signalé pour cette exécution.");
    this.store.transaction((data) => {
      const cible = data.runs.find((r) => r.id === runId)!;
      Object.assign(cible, { outcome, error, updatedAt: this.now().toISOString() });
    });
    this.onChange();
  }

  /** Ce que l'interface dit d'une exécution qu'on lui a confiée. Une exécution finie ne change plus. */
  report(runId: string, report: RunReport): void {
    const run = this.store.run(runId);
    if (!run || isTerminal(run.status) || !report || typeof report !== "object") return;
    const sansConversation = report.state === "failed" && report.chatId === null;
    if (!sansConversation && (typeof report.chatId !== "string" || !report.chatId)) return;
    // Les événements tardifs du renderer ne peuvent ni démarrer un run, ni modifier
    // la livraison acquise, ni masquer une permission que le main attend encore.
    if (report.state === "running") return;
    if (report.state === "queued" && run.startedAt) return;
    if (report.state === "succeeded" && !hasStarted(run)) return;
    if (run.startedAt && (sansConversation || report.chatId !== run.delivery?.chatId || ("messageId" in report && report.messageId !== run.delivery?.messageId))) return;
    const now = this.now();
    this.store.transaction((data) => {
      const cible = data.runs.find((r) => r.id === runId)!;
      cible.updatedAt = now.toISOString();
      switch (report.state) {
        case "queued":
          cible.delivery = { chatId: report.chatId, messageId: cible.delivery?.messageId ?? null };
          break;
        case "succeeded":
          Object.assign(cible, finish(now, cible.outcome === "failed" ? "failed" : "succeeded", cible.outcome === "failed" ? cible.error : null));
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
    // Une remise à l'interface peut avoir échoué même pour une routine manuelle.
    if (this.store.runs.some((r) => r.status === "queued" && !r.dispatchedAt)) prochaine = Math.min(prochaine, this.now().getTime() + MAX_TIMER_MS);
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
    if (!this.started) return;
    // Revalider aussi les runs déjà confiés mais encore dans la file du renderer.
    // Un agent peut être désactivé ou sa fiche retirée entre l'échéance et son tour.
    for (const run of this.store.runs) if (run.status === "queued") this.failUnavailable(run);
    if (!this.hostReady) return;
    const occupes = new Set(
      this.store.runs.filter((r) => hasStarted(r) || (r.status === "queued" && r.dispatchedAt)).map((r) => r.agentId),
    );
    const enFile = this.store.runs
      .filter((r) => r.status === "queued" && !r.dispatchedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const run of enFile) {
      if (occupes.has(run.agentId)) continue;
      const at = this.now().toISOString();
      try {
        // La remise est enregistrée AVANT l'événement : l'hôte peut prendre le run
        // en charge synchroniquement. Une écriture ratée interdit toute remise.
        this.store.transaction((data) => {
          const cible = data.runs.find((r) => r.id === run.id)!;
          Object.assign(cible, { dispatchedAt: at, updatedAt: at });
        });
      } catch (error) {
        this.log(`Exécution ${run.id} : remise impossible à enregistrer.`, error);
        continue;
      }
      let confiee = false;
      try {
        confiee = this.host.deliver(structuredClone(this.store.run(run.id)!), this.store.routine(run.routineId));
      } catch (error) {
        this.log(`Exécution ${run.id} : l’interface ne l’a pas reçue.`, error);
      }
      if (!confiee) {
        try {
          this.store.transaction((data) => {
            const cible = data.runs.find((r) => r.id === run.id)!;
            if (cible.status === "queued" && !cible.startedAt) cible.dispatchedAt = null;
          });
        } catch (error) {
          this.log(`Exécution ${run.id} : remise différée ; elle sera vérifiée au retour de la fenêtre.`, error);
        }
        return;
      }
      occupes.add(run.agentId);
    }
  }

  /* ─── Outils ───────────────────────────────────────────────── */

  private agentIssue(agentId: string): string | null {
    try {
      return this.agentError(agentId);
    } catch (error) {
      return `L’agent ne peut pas être vérifié : ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private requireAgent(agentId: string): void {
    const error = this.agentIssue(agentId);
    if (error) throw new RoutineError("agent-indisponible", error);
  }

  private unavailable(run: RoutineRun): string | null {
    const routine = this.store.routine(run.routineId);
    return (routine ? blockedReason(routine) : "La routine n’existe plus.") || this.agentIssue(run.agentId);
  }

  /** Échec durable avant lancement ; la file du renderer est retirée seulement après l'écriture. */
  private failUnavailable(run: RoutineRun, reason = this.unavailable(run)): boolean {
    if (!reason || run.status !== "queued") return false;
    this.store.transaction((data) => {
      const cible = data.runs.find((r) => r.id === run.id)!;
      Object.assign(cible, finish(this.now(), "failed", reason.slice(0, ERROR_MAX)));
    });
    if (run.dispatchedAt) this.host.cancel(run);
    this.onChange();
    return true;
  }

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

function blockedReason(routine: Routine): string | null {
  return routine.blockedReason || (routine.relais?.length ? LEGACY_CHAIN : null);
}

function hasStarted(run: RoutineRun): boolean {
  return run.status === "running" || run.status === "needs-attention";
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

/** L'ancienne échéance est gardée, même passée : le démarrage appliquera la politique de rattrapage. */
function legacyInstant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new RoutineError("migration", "L’ancienne prochaine exécution n’est pas un instant ISO valide.");
  }
  const date = value.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new RoutineError("migration", "La date de l’ancienne prochaine exécution n’existe pas.");
  }
  return new Date(value).toISOString();
}
