import { app, BrowserWindow, ipcMain, powerMonitor, type WebContents } from "electron";
import path from "node:path";
import { readConversations } from "../conversations";
import { RoutineEngine, RoutineError } from "./engine";
import { convertirRoutine, type AncienneRoutine } from "./migration";
import { RoutineStore, RoutineStoreError } from "./store";
import type { RoutineInput, RoutinePatch, RunReport } from "./types";

/**
 * Les routines dans le process principal : le moteur, son fichier, et le lien avec
 * l'interface, qui poste chaque exécution dans la conversation de l'agent.
 *
 * Activé par `KLYRA_ROUTINES=moteur` tant que l'écran des routines n'est pas branché
 * sur le moteur : sans la variable, rien ne change (l'ancien minuteur de l'interface reste).
 * Rien ne s'exécute app fermée : il n'y a pas d'autre hôte que l'app ouverte.
 */

export const moteurRoutinesActif = () => process.env.KLYRA_ROUTINES === "moteur";

let engine: RoutineEngine | null = null;
let store: RoutineStore | null = null;
let erreur: string | null = null;
let hote: WebContents | null = null;
let oublierHote: (() => void) | null = null;

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
  if (!moteurRoutinesActif() || engine) return;
  const dossier = path.join(app.getPath("userData"), "routines");
  try {
    store = new RoutineStore(dossier);
    store.acquire();
    const premiere = !store.exists();
    store.load();
    engine = new RoutineEngine({
      store,
      host: {
        deliver: (run, routine) => {
          if (!hote || hote.isDestroyed()) return false;
          hote.send("routines:livrer", run, routine ?? null);
          return true;
        },
        cancel: (run) => {
          if (hote && !hote.isDestroyed()) hote.send("routines:annuler", run);
        },
      },
      onChange: () => diffuser("routines:change"),
      log: (message, error) => console.error(`[routines] ${message}`, error ?? ""),
    });
    if (premiere) await importerAnciennes(engine);
    engine.start();
    powerMonitor.on("suspend", () => engine?.suspend());
    powerMonitor.on("resume", () => engine?.resume());
  } catch (error) {
    erreur = error instanceof RoutineStoreError || error instanceof Error ? error.message : String(error);
    console.error("[routines]", erreur);
    engine?.stop();
    engine = null;
    store?.release();
  }
}

/** Les routines de l'ancien minuteur (conversations.json), reprises une fois. */
async function importerAnciennes(cible: RoutineEngine) {
  const data = (await readConversations().catch(() => null)) as { routines?: AncienneRoutine[] } | null;
  const anciennes = Array.isArray(data?.routines) ? data.routines : [];
  if (!anciennes.length) return;
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
  store?.release();
}

export function brancherRoutines(): void {
  const handle = <A extends unknown[], T>(canal: string, fn: (...args: A) => T) =>
    ipcMain.handle(canal, (_event, ...args: unknown[]) => repondre(() => fn(...(args as A))));

  handle("routines:etat", () => ({ actif: !!engine, erreur }));
  handle("routines:lister", (agentId?: string) => moteur().list(typeof agentId === "string" ? agentId : undefined));
  handle("routines:creer", (input: RoutineInput) => moteur().create(input));
  handle("routines:modifier", (id: string, patch: RoutinePatch) => moteur().update(id, patch));
  handle("routines:supprimer", (id: string) => moteur().remove(id));
  handle("routines:executer", (id: string) => moteur().runNow(id));
  handle("routines:interrompre", (runId: string) => moteur().interrupt(runId));
  handle("routines:historique", (id: string, limit?: number) => moteur().history(id, limit ?? 50));
  handle("routines:prochaines", (id: string) => moteur().upcoming(id));
  handle("routines:signaler", (runId: string, rapport: RunReport) => moteur().report(String(runId), rapport));
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
