import { app, BrowserWindow, ipcMain, powerMonitor, type WebContents } from "electron";
import path from "node:path";
import { constants, existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { cancelAgent, type AgentEvent } from "../claude";
import { readConversations } from "../conversations";
import { dossierAgents, estActif } from "../mes-agents";
import { brancherOutilsRoutines, type Appelant } from "../ia";
import { RoutineEngine, RoutineError } from "./engine";
import { convertirRoutine, type AncienneRoutine } from "./migration";
import { LOCK_STALE_MS, RoutineStore, RoutineStoreError } from "./store";
import type { RoutineInput, RoutinePatch, RunReport } from "./types";
import { upcomingOccurrences, validateSchedule } from "./schedule";

/**
 * Les routines dans le process principal : le moteur, son fichier, et le lien avec
 * l'interface, qui poste chaque exécution dans la conversation de l'agent.
 *
 * Rien ne s'exécute app fermée : il n'y a pas d'autre hôte que l'app ouverte.
 */

let engine: RoutineEngine | null = null;
let store: RoutineStore | null = null;
let erreur: string | null = null;
let hote: WebContents | null = null;
let oublierHote: (() => void) | null = null;
let battement: ReturnType<typeof setInterval> | null = null;
let nouvelEssai: ReturnType<typeof setTimeout> | null = null;
const ecrituresEnAttente = new Map<string, () => void>();
let repriseEcriture: ReturnType<typeof setTimeout> | null = null;

/** Aucun agent retiré ou désactivé n'est rappelé, même si sa routine était déjà en file. */
function erreurAgent(id: string): string | null {
  if (id === "principal") return null;
  if (!estActif(id)) return `L’agent « ${id} » est désactivé ou retiré de Mes agents. Aucune consigne ne lui a été envoyée.`;
  if (!existsSync(path.join(dossierAgents(), `${id}.md`))) return `La fiche de l’agent « ${id} » est introuvable. Aucune consigne ne lui a été envoyée.`;
  return null;
}

/** Le résultat vient du main ; une erreur disque ne perd pas son dernier état observable. */
function enregistrer(cle: string, action: () => void) {
  ecrituresEnAttente.set(cle, action);
  try {
    action();
    ecrituresEnAttente.delete(cle);
    if (!ecrituresEnAttente.size) erreur = null;
  } catch (e) {
    erreur = `L’état des routines n’a pas pu être enregistré : ${e instanceof Error ? e.message : String(e)}`;
    if (!repriseEcriture) repriseEcriture = setTimeout(() => {
      repriseEcriture = null;
      for (const [id, fn] of ecrituresEnAttente) enregistrer(id, fn);
    }, 1000);
  }
  diffuser("routines:change");
}

/** Réservation durable AVANT le premier appel de l'agent ; jamais déduite d'un rendu React. */
export function commencerRoutine(runId: string, chatId: string, messageId: string, agentId: string): (event: AgentEvent) => AgentEvent {
  const e = moteur();
  try {
    if (!hote || hote.isDestroyed()) throw new RoutineError("hote-ferme", "La fenêtre d’exécution n’est plus disponible.");
    e.claim(runId, chatId, messageId, agentId);
  } catch (error) {
    // Un refus AVANT le départ libère la file dès que le disque est de nouveau inscriptible.
    // Une deuxième demande d'un run déjà réclamé ne doit jamais terminer le premier.
    const message = error instanceof Error ? error.message : String(error);
    if (store?.run(runId)?.status === "queued" && !store.run(runId)?.startedAt) enregistrer(runId, () => {
      if (store?.run(runId)?.status === "queued" && !store.run(runId)?.startedAt)
        e.report(runId, { state: "failed", chatId: null, messageId: null, error: `L’agent n’a pas été lancé : ${message}` });
    });
    throw error;
  }
  const permissions = new Set<string>();
  return (event) => {
    if (event.type === "autorisation") permissions.add(event.id);
    if (event.type === "autorisation-fin") permissions.delete(event.id);
    if (event.type === "autorisation" || event.type === "autorisation-fin") {
      const attente = permissions.size > 0;
      enregistrer(runId, () => e.attention(runId, attente));
    }
    if (event.type === "fin") {
      const run = store?.run(runId);
      if (run?.outcome === "failed") event = { ...event, ok: false, erreur: run.error || "La routine n’a pas pu être accomplie." };
      if (run?.outcome === "no-update" && event.ok) event = { ...event, silencieux: true };
      const report: RunReport = event.ok
        ? { state: "succeeded", chatId, messageId, result: event.texte }
        : { state: "failed", chatId, messageId, error: event.erreur || "L’agent s’est arrêté sur une erreur." };
      enregistrer(runId, () => e.report(runId, report));
    }
    return event;
  };
}

type Reponse<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function repondre<T>(fn: () => Promise<T> | T): Promise<Reponse<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof RoutineError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "erreur", message: error instanceof Error ? error.message : String(error) };
  }
}

function moteur(): RoutineEngine {
  if (engine) return engine;
  throw new RoutineError("indisponible", erreur ?? "Le moteur des routines n’est pas activé.");
}

function diffuser(canal: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(canal, ...args);
}

/** L'interface qui reçoit les exécutions ; perdue quand sa page se recharge ou se ferme. */
function suivreHote(contenu: WebContents) {
  if (hote === contenu) return;
  oublierHote?.();
  const perdu = () => {
    oublierHote?.();
    engine?.setHostReady(false);
    // Les réponses en cours ne reviendront plus à l'interface : on les arrête plutôt que de laisser
    // l'agent travailler pendant que l'exécution suivante démarre.
    const arretees = engine?.activeRuns().filter((r) => r.startedAt) ?? [];
    // Une reprise d'écriture ne doit pas englober les runs d'une nouvelle fenêtre.
    for (const run of arretees) enregistrer(`hote-perdu:${run.id}`, () => engine?.interruptRunning("La fenêtre de l’app a été fermée ou rechargée pendant l’exécution.", [run.id]));
    for (const run of arretees) if (run.delivery?.messageId) cancelAgent(run.delivery.messageId);
  };
  const evenements = ["destroyed", "render-process-gone", "did-navigate"] as const;
  for (const nom of evenements) contenu.on(nom as "destroyed", perdu);
  hote = contenu;
  oublierHote = () => {
    for (const nom of evenements) if (!contenu.isDestroyed()) contenu.removeListener(nom as "destroyed", perdu);
    hote = null;
    oublierHote = null;
  };
}

/** Au lancement de l'app, après `app.whenReady`. */
export async function demarrerRoutines(): Promise<void> {
  if (engine) return;
  nouvelEssai = null;
  const dossier = path.join(app.getPath("userData"), "routines");
  try {
    store = new RoutineStore(dossier);
    try {
      store.acquire();
    } catch (error) {
      // Un verrou encore frais : il sera périmé dans 2 min au plus si son process n'est plus là.
      store = null;
      nouvelEssai = setTimeout(() => void demarrerRoutines(), LOCK_STALE_MS / 2);
      throw error;
    }
    battement = setInterval(() => store?.refresh(), LOCK_STALE_MS / 4);
    const premiere = !store.exists();
    store.load();
    engine = new RoutineEngine({
      store,
      agentError: erreurAgent,
      host: {
        deliver: (run, routine) => {
          if (!hote || hote.isDestroyed()) return false;
          hote.send("routines:livrer", run, routine ?? null);
          return true;
        },
        cancel: (run) => {
          if (run.delivery?.messageId) cancelAgent(run.delivery.messageId);
          if (hote && !hote.isDestroyed()) hote.send("routines:annuler", run);
        },
      },
      onChange: () => diffuser("routines:change"),
      log: (message, error) => console.error(`[routines] ${message}`, error ?? ""),
    });
    if (premiere) await importerAnciennes(engine);
    engine.start();
    erreur = null;
    powerMonitor.on("suspend", () => engine?.suspend());
    powerMonitor.on("resume", () => engine?.resume());
    diffuser("routines:change");
  } catch (error) {
    erreur = error instanceof RoutineStoreError || error instanceof Error ? error.message : String(error);
    console.error("[routines]", erreur);
    engine?.stop();
    engine = null;
    if (battement) clearInterval(battement);
    battement = null;
    store?.release();
    diffuser("routines:change");
  }
}

/** Les routines de l'ancien minuteur (conversations.json), reprises une fois. */
async function importerAnciennes(cible: RoutineEngine) {
  const data = (await readConversations()) as { routines?: AncienneRoutine[] } | null;
  if (data?.routines !== undefined && !Array.isArray(data.routines)) throw new RoutineError("migration", "Les anciennes routines sont illisibles : données conservées, aucune exécution.");
  const anciennes = Array.isArray(data?.routines) ? data.routines : [];
  if (!anciennes.length) return;
  // Sauvegarde intégrale, historique et relais compris ; l'original reste lui aussi intact.
  await copyFile(path.join(app.getPath("userData"), "conversations.json"), path.join(app.getPath("userData"), "routines", "conversations-avant-migration.json"), constants.COPYFILE_EXCL)
    .catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
  const fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { imported, errors } = cible.importLegacy(
    anciennes.map((a) => {
      const { input, extras } = convertirRoutine(a, fuseau);
      return { id: a.id, input, extras };
    }),
  );
  console.log(`[routines] ${imported} routine(s) reprise(s) de l’ancien minuteur.`);
  for (const e of errors) console.error(`[routines] Non reprise : ${e}`);
}

export function arreterRoutines(): void {
  engine?.stop();
  if (battement) clearInterval(battement);
  if (nouvelEssai) clearTimeout(nouvelEssai);
  if (repriseEcriture) clearTimeout(repriseEcriture);
  store?.release();
}

export function brancherRoutines(): void {
  const executionDe = (appelant: Appelant) => engine?.activeRuns().find((r) =>
    r.id === appelant.routineRun && !!r.startedAt && r.agentId === appelant.roleId && r.delivery?.chatId === appelant.chatId);
  brancherOutilsRoutines({
    active: (appelant) => !!executionDe(appelant),
    signaler: (appelant, outcome, reason) => {
      const run = executionDe(appelant);
      if (!run) throw new RoutineError("contexte", "Cette exécution de routine n’est plus en cours.");
      moteur().signal(run.id, outcome, reason);
    },
  });
  const handle = <A extends unknown[], T>(canal: string, fn: (...args: A) => T) =>
    ipcMain.handle(canal, (_event, ...args: unknown[]) => repondre(() => fn(...(args as A))));

  handle("routines:etat", () => ({ actif: !!engine, erreur }));
  handle("routines:lister", (agentId?: string) => moteur().list(typeof agentId === "string" ? agentId : undefined));
  handle("routines:en-cours", () => moteur().activeRuns());
  handle("routines:creer", (input: RoutineInput) => moteur().create(input));
  handle("routines:modifier", (id: string, patch: RoutinePatch) => moteur().update(id, patch));
  handle("routines:supprimer", (id: string) => moteur().remove(id));
  handle("routines:executer", (id: string) => moteur().runNow(id));
  handle("routines:interrompre", (runId: string) => moteur().interrupt(runId));
  handle("routines:historique", (id: string, limit?: number) => moteur().history(id, limit ?? 50));
  handle("routines:prochaines", (id: string) => moteur().upcoming(id));
  handle("routines:passages", (debut: string, fin: string) => moteur().passages(debut, fin));
  handle("routines:apercu", (schedule: unknown, timezone: string) => {
    const now = new Date();
    const valide = validateSchedule(schedule, timezone, now);
    return upcomingOccurrences(valide, timezone, now, 3);
  });
  // L'interface peut signaler l'attente ou un refus avant envoi. Seul Claude dans le main termine un run lancé.
  handle("routines:signaler", (runId: string, rapport: RunReport) => {
    if (rapport?.state === "queued" || (rapport?.state === "failed" && rapport.chatId === null)) {
      const e = moteur();
      enregistrer(String(runId), () => e.report(String(runId), rapport));
    }
  });
  /* L'interface est chargée : elle reçoit les exécutions à poster. Un rechargement la remplace. */
  ipcMain.handle("routines:pret", (event) =>
    repondre(() => {
      const e = moteur();
      suivreHote(event.sender);
      e.setHostReady(true);
      return null;
    }),
  );
}
