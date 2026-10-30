import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Routine, RoutineRun } from "./types";

/**
 * Les routines et leurs exécutions, dans `routines.json` du dossier de l'app.
 * Seul le process principal y écrit. Chaque modification est une transaction :
 * l'état est copié, modifié, contrôlé, puis écrit en entier (fichier temporaire,
 * fsync, renommage). Une exécution créée et l'avance du déclencheur partent donc
 * ensemble sur le disque, ou pas du tout.
 */

const VERSION = 1;
/** Le process qui tient le verrou le rafraîchit (`refresh`) ; sans nouvelle depuis ce délai, il est repris. */
export const LOCK_STALE_MS = 2 * 60_000;

export interface RoutinesData {
  version: number;
  routines: Routine[];
  runs: RoutineRun[];
}

export class RoutineStoreError extends Error {}

function vide(): RoutinesData {
  return { version: VERSION, routines: [], runs: [] };
}

function controler(data: RoutinesData) {
  const ids = new Set<string>();
  for (const r of data.routines) {
    if (ids.has(r.id)) throw new RoutineStoreError(`Routine en double : ${r.id}.`);
    ids.add(r.id);
  }
  // Anti-doublon : une échéance ne produit qu'une exécution planifiée (UNIQUE(routine, échéance)).
  const echeances = new Set<string>();
  const runIds = new Set<string>();
  for (const run of data.runs) {
    if (runIds.has(run.id)) throw new RoutineStoreError(`Exécution en double : ${run.id}.`);
    runIds.add(run.id);
    if (!ids.has(run.routineId)) throw new RoutineStoreError("Exécution sans routine.");
    if (run.kind !== "scheduled" || run.missed) continue;
    const cle = `${run.routineId}|${run.scheduledFor}`;
    if (echeances.has(cle)) throw new RoutineStoreError("Cette échéance a déjà une exécution.");
    echeances.add(cle);
  }
}

export class RoutineStore {
  private data: RoutinesData = vide();
  private readonly file: string;
  private readonly lock: string;
  private locked = false;

  constructor(dir: string) {
    this.file = path.join(dir, "routines.json");
    this.lock = path.join(dir, "routines.lock");
    mkdirSync(dir, { recursive: true });
  }

  /**
   * Un seul process exécute les routines d'un dossier (en plus de l'instance unique d'Electron,
   * que les tests contournent). Le verrou d'un process disparu, d'avant le démarrage de la machine
   * ou pas rafraîchi depuis 2 min est repris : un numéro de process réutilisé ne bloque pas.
   */
  acquire(pid = process.pid, now = Date.now()): void {
    for (let essai = 0; essai < 2; essai++) {
      try {
        const fd = openSync(this.lock, "wx");
        writeSync(fd, String(pid));
        closeSync(fd);
        this.locked = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (this.lockHeld(pid, now)) throw new RoutineStoreError("Une autre KLYRA exécute déjà ces routines.");
        rmSync(this.lock, { force: true });
      }
    }
    throw new RoutineStoreError("Impossible de verrouiller les routines.");
  }

  private lockHeld(pid: number, now: number): boolean {
    let autre: number;
    let modifie: number;
    try {
      autre = Number(readFileSync(this.lock, "utf8").trim());
      modifie = statSync(this.lock).mtimeMs;
    } catch {
      return false;
    }
    const demarrage = now - os.uptime() * 1000;
    return (
      Number.isSafeInteger(autre) && autre > 0 && autre !== pid && vivant(autre) &&
      modifie >= demarrage && now - modifie < LOCK_STALE_MS
    );
  }

  /** Le process vit toujours : à appeler plus souvent que LOCK_STALE_MS. */
  refresh(): void {
    if (!this.locked) return;
    const maintenant = new Date();
    try {
      utimesSync(this.lock, maintenant, maintenant);
    } catch {
      // Verrou retiré à la main : il sera repris au prochain lancement.
    }
  }

  release(): void {
    if (this.locked) rmSync(this.lock, { force: true });
    this.locked = false;
  }

  /** Lit le fichier. Illisible : on refuse de démarrer plutôt que de l'écraser. */
  load(): void {
    let brut: string;
    try {
      brut = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.data = vide();
        return;
      }
      throw error;
    }
    let data: RoutinesData;
    try {
      data = JSON.parse(brut) as RoutinesData;
    } catch {
      throw new RoutineStoreError("Le fichier des routines est illisible : il est conservé tel quel, rien n’est exécuté.");
    }
    if (!data || data.version !== VERSION || !Array.isArray(data.routines) || !Array.isArray(data.runs)) {
      throw new RoutineStoreError("Le fichier des routines a un format inconnu : il est conservé tel quel, rien n’est exécuté.");
    }
    controler(data);
    this.data = data;
  }

  exists(): boolean {
    try {
      readFileSync(this.file);
      return true;
    } catch {
      return false;
    }
  }

  get routines(): readonly Routine[] {
    return this.data.routines;
  }

  get runs(): readonly RoutineRun[] {
    return this.data.runs;
  }

  routine(id: string): Routine | undefined {
    return this.data.routines.find((r) => r.id === id);
  }

  run(id: string): RoutineRun | undefined {
    return this.data.runs.find((r) => r.id === id);
  }

  /** Exécutions d'une routine, les plus récentes d'abord. */
  history(routineId: string, limit = 50): RoutineRun[] {
    // À la même milliseconde, l'ordre d'écriture départage : la dernière créée d'abord.
    return this.data.runs
      .map((run, ordre) => ({ run, ordre }))
      .filter(({ run }) => run.routineId === routineId)
      .sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt) || b.ordre - a.ordre)
      .slice(0, Math.max(0, limit))
      .map(({ run }) => structuredClone(run));
  }

  /** Applique `change` à une copie ; n'écrit et ne remplace l'état que si tout est valide. */
  transaction<T>(change: (data: RoutinesData) => T): T {
    const copie = structuredClone(this.data);
    const resultat = change(copie);
    controler(copie);
    this.write(copie);
    this.data = copie;
    return resultat;
  }

  private write(data: RoutinesData) {
    const temporaire = `${this.file}.tmp`;
    const fd = openSync(temporaire, "w");
    try {
      writeSync(fd, JSON.stringify(data));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporaire, this.file);
  }
}

function vivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
