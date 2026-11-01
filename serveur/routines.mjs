/**
 * Les routines d'un VPS : tenues par le serveur, elles tournent PC éteint.
 * Le PC reste la source de leur définition (`PUT /klyra/v1/routines`, liste complète) ; le serveur
 * garde leur échéance, leur session (une conversation par routine) et l'historique de leurs exécutions.
 *
 * Mêmes règles que le moteur de l'app (docs/ROUTINES.md), en plus court :
 * - une exécution active par routine, une par agent ; les autres attendent ;
 * - l'exécution est écrite « en cours » sur le disque avant l'appel de l'agent ; une exécution en cours
 *   au redémarrage du serveur devient « interrompue » et n'est jamais relancée ;
 * - plus de 5 min de retard : « skip » saute (une ligne dans l'historique), « run-once » lance la dernière ;
 * - le résultat est la fin de tour de l'agent ; une autorisation en attente laisse l'exécution active.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nextOccurrence } from "./horaires.mjs";

const GRACE_MS = 5 * 60_000;
const TICK_MS = 30_000;
const RUNS_MAX = 1000;
const RESULT_MAX = 4000;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const TERMINAUX = new Set(["succeeded", "failed", "interrupted", "cancelled"]);

/**
 * @param {{ donnees: string, home: string, envoyer: (requestId: string, demande: object) => void,
 *   annuler: (requestId: string) => boolean, maintenant?: () => Date, setTimer?: typeof setInterval, clearTimer?: typeof clearInterval }} options
 */
export function creerRoutines(options) {
  const fichier = path.join(options.donnees, "routines.json");
  const maintenant = options.maintenant ?? (() => new Date());
  let etat = lire();
  let minuteur = null;

  function lire() {
    try {
      const brut = JSON.parse(readFileSync(fichier, "utf8"));
      return { routines: Array.isArray(brut.routines) ? brut.routines : [], runs: Array.isArray(brut.runs) ? brut.runs : [] };
    } catch {
      return { routines: [], runs: [] };
    }
  }

  function ecrire() {
    etat.runs = etat.runs.slice(-RUNS_MAX);
    const temporaire = `${fichier}.tmp`;
    writeFileSync(temporaire, JSON.stringify(etat), { mode: 0o600 });
    renameSync(temporaire, fichier);
  }

  const requeteDe = (run) => `routine-${run.id}`;
  const runDeRequete = (requestId) => (requestId.startsWith("routine-") ? etat.runs.find((r) => requeteDe(r) === requestId) : undefined);
  const routine = (id) => etat.routines.find((r) => r.id === id);

  /* ─── Définitions reçues du PC ──────────────────────────────────── */

  function valider(r) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !ID.test(r.id)) throw new Error("routine");
    if (typeof r.agentId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(r.agentId)) throw new Error("agent");
    if (typeof r.name !== "string" || typeof r.instruction !== "string" || !r.instruction.trim() || r.instruction.length > 50_000) throw new Error("consigne");
    if (!r.schedule || typeof r.schedule !== "object" || typeof r.timezone !== "string") throw new Error("planning");
    if (r.dossier !== null && r.dossier !== undefined) {
      const rel = path.relative(path.resolve(options.home), path.resolve(String(r.dossier)));
      if (!path.isAbsolute(String(r.dossier)) || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("dossier");
    }
    return {
      id: r.id,
      agentId: r.agentId,
      name: r.name.slice(0, 200),
      instruction: r.instruction,
      schedule: r.schedule,
      timezone: r.timezone,
      active: r.active === true,
      missedPolicy: r.missedPolicy === "run-once" ? "run-once" : "skip",
      dossier: r.dossier ?? null,
      chatId: typeof r.chatId === "string" ? r.chatId.slice(0, 120) : `routine-${r.id}`,
      acces: ["demander", "projet", "tout"].includes(r.acces) ? r.acces : "projet",
    };
  }

  /** Remplace la liste. Échéance recalculée si le planning change ; session et historique gardés. */
  function recevoir(liste) {
    if (!Array.isArray(liste) || liste.length > 500) throw new Error("routines");
    const nouvelles = liste.map(valider);
    const avant = new Map(etat.routines.map((r) => [r.id, r]));
    const now = maintenant();
    etat.routines = nouvelles.map((r) => {
      const ancienne = avant.get(r.id);
      const memePlanning = ancienne && JSON.stringify([ancienne.schedule, ancienne.timezone, ancienne.active]) === JSON.stringify([r.schedule, r.timezone, r.active]);
      const nextRunAt = !r.active ? null : memePlanning ? ancienne.nextRunAt : nextOccurrence(r.schedule, r.timezone, now);
      return { ...r, nextRunAt, sessionId: ancienne?.sessionId ?? null };
    });
    // Une routine retirée : ses exécutions en attente tombent ; une exécution en cours finit d'elle-même.
    const ids = new Set(etat.routines.map((r) => r.id));
    for (const run of etat.runs) if (!ids.has(run.routineId) && run.status === "queued") Object.assign(run, { status: "cancelled", error: "Routine retirée.", finishedAt: now.toISOString(), updatedAt: now.toISOString() });
    ecrire();
    tick();
  }

  /* ─── Exécutions ────────────────────────────────────────────────── */

  function nouveauRun(r, kind, scheduledFor, extra = {}) {
    const date = maintenant().toISOString();
    return {
      id: `${r.id}~${randomBytes(6).toString("hex")}`,
      routineId: r.id,
      agentId: r.agentId,
      kind,
      scheduledFor,
      routineName: r.name,
      instruction: r.instruction,
      projectId: null,
      status: "queued",
      error: null,
      dispatchedAt: null,
      delivery: null,
      result: null,
      createdAt: date,
      startedAt: null,
      finishedAt: null,
      updatedAt: date,
      ...extra,
    };
  }

  function executer(id) {
    const r = routine(id);
    if (!r) throw new Error("introuvable");
    if (etat.runs.some((run) => run.routineId === id && !TERMINAUX.has(run.status))) throw new Error("deja-en-cours");
    const run = nouveauRun(r, "manual", maintenant().toISOString());
    etat.runs.push(run);
    ecrire();
    lancerEnAttente();
    return run;
  }

  /** Échéances dues → exécutions en attente ; retard de plus de 5 min selon la règle de la routine. */
  function rattraper() {
    const now = maintenant();
    let change = false;
    for (const r of etat.routines) {
      if (!r.active || !r.nextRunAt || Date.parse(r.nextRunAt) > now.getTime()) continue;
      const due = r.nextRunAt;
      const retard = now.getTime() - Date.parse(due) > GRACE_MS;
      r.nextRunAt = r.schedule.kind === "once" ? null : nextOccurrence(r.schedule, r.timezone, now);
      change = true;
      if (retard && r.missedPolicy === "skip") {
        etat.runs.push(nouveauRun(r, "scheduled", due, { status: "cancelled", missed: { count: 1, capped: false, until: now.toISOString(), reason: "sleep" }, error: "Échéance manquée : serveur arrêté.", finishedAt: now.toISOString() }));
        continue;
      }
      if (etat.runs.some((run) => run.routineId === r.id && !TERMINAUX.has(run.status))) continue;
      etat.runs.push(nouveauRun(r, "scheduled", due, retard ? { late: true } : {}));
    }
    if (change) ecrire();
  }

  function lancerEnAttente() {
    const occupes = new Set(etat.runs.filter((run) => run.status === "running" || run.status === "needs-attention").map((run) => run.agentId));
    for (const run of etat.runs) {
      if (run.status !== "queued" || occupes.has(run.agentId)) continue;
      const r = routine(run.routineId);
      if (!r) continue;
      const date = maintenant().toISOString();
      // Écrit « en cours » avant l'appel : un arrêt entre les deux donne une exécution interrompue, jamais un doublon.
      Object.assign(run, { status: "running", dispatchedAt: date, startedAt: date, updatedAt: date, delivery: { chatId: r.chatId, messageId: requeteDe(run) } });
      ecrire();
      occupes.add(run.agentId);
      options.envoyer(requeteDe(run), {
        agent: r.agentId === "principal" ? null : r.agentId,
        prompt: `Routine « ${r.name} »\n\n${r.instruction}`,
        sessionId: r.sessionId ?? null,
        acces: r.acces,
        dossier: r.dossier,
      });
    }
  }

  function tick() {
    try {
      rattraper();
      lancerEnAttente();
    } catch (error) {
      console.error("[routines]", error);
    }
  }

  /** Les événements des agents : la session de la routine, l'attente d'accord, la fin. */
  function surEvenement(requestId, event) {
    const run = runDeRequete(requestId);
    if (!run || TERMINAUX.has(run.status)) return;
    const r = routine(run.routineId);
    const date = maintenant().toISOString();
    if (event.type === "session" && r) {
      r.sessionId = event.sessionId;
      ecrire();
    } else if (event.type === "autorisation") {
      Object.assign(run, { status: "needs-attention", updatedAt: date });
      ecrire();
    } else if (event.type === "autorisation-fin" && run.status === "needs-attention") {
      Object.assign(run, { status: "running", updatedAt: date });
      ecrire();
    } else if (event.type === "fin") {
      if (r && event.sessionId) r.sessionId = event.sessionId;
      Object.assign(run, {
        status: event.ok ? "succeeded" : "failed",
        error: event.ok ? null : (event.erreur ?? "Échec."),
        result: (event.texte ?? "").slice(0, RESULT_MAX) || null,
        finishedAt: date,
        updatedAt: date,
      });
      ecrire();
      lancerEnAttente();
    }
  }

  /** Ce que l'app doit savoir pour ouvrir la réponse dans la conversation de la routine. */
  function contexte(requestId) {
    const run = runDeRequete(requestId);
    const r = run && routine(run.routineId);
    return r ? { chatId: r.chatId, agentId: r.agentId, titre: r.name } : null;
  }

  function interrompre(runId) {
    const run = etat.runs.find((x) => x.id === runId);
    if (!run || TERMINAUX.has(run.status)) return false;
    if (run.status === "queued") {
      const date = maintenant().toISOString();
      Object.assign(run, { status: "cancelled", error: "Annulée par toi.", finishedAt: date, updatedAt: date });
      ecrire();
      return true;
    }
    return options.annuler(requeteDe(run));
  }

  const historique = (id, limite = 50) =>
    etat.runs
      .filter((run) => run.routineId === id)
      .slice(-Math.max(1, Math.min(500, limite)))
      .reverse();

  function demarrer() {
    // Le serveur a redémarré : ce qui tournait ne reprend pas.
    const date = maintenant().toISOString();
    let change = false;
    for (const run of etat.runs) {
      if (run.status === "running" || run.status === "needs-attention") {
        Object.assign(run, { status: "interrupted", error: "Interrompue : le serveur a redémarré.", finishedAt: date, updatedAt: date });
        change = true;
      }
    }
    if (change) ecrire();
    tick();
    minuteur = (options.setTimer ?? setInterval)(tick, TICK_MS);
  }

  const arreter = () => minuteur && (options.clearTimer ?? clearInterval)(minuteur);

  return { recevoir, executer, interrompre, historique, surEvenement, contexte, tick, demarrer, arreter, liste: () => etat.routines };
}
