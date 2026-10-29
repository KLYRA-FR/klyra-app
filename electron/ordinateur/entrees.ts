import { app, screen } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Point } from "./coordonnees";
import { verifierInterrupteur } from "./garde";

/**
 * Computer Use, couche système : clavier et souris, par klyra-entrees
 * (native/entrees/, préparé par scripts/preparer-entrees.mjs). Une commande
 * JSON par ligne sur son entrée standard, une réponse par ligne.
 *
 * Les points arrivent en DIP du bureau (l'unité d'Electron). Sous Windows,
 * klyra-entrees veut des pixels physiques : `screen.dipToScreenPoint` ; sur
 * Mac, CGEvent prend des points, comme Electron.
 *
 * Jamais sans l'interrupteur des Réglages (sauf `ping`, qui ne touche à rien).
 */

const EXE = process.platform === "win32" ? "klyra-entrees.exe" : "klyra-entrees";
const DELAI_MS = 10_000;

export type Bouton = "gauche" | "droit" | "milieu";

/** Où est klyra-entrees : dans l'app installée, sinon dans vendor/ (développement, tests). */
function executable(): string | null {
  const candidats = [
    path.join(process.resourcesPath ?? "", "entrees", EXE),
    path.join(app.getAppPath(), "vendor", "entrees", process.platform, EXE),
    path.join(__dirname, "..", "..", "vendor", "entrees", process.platform, EXE),
  ];
  return candidats.find((c) => existsSync(c)) ?? null;
}

let processus: ChildProcessWithoutNullStreams | null = null;
let suivant = 1;
const attentes = new Map<number, { resoudre: (r: Record<string, unknown>) => void; rejeter: (e: Error) => void; minuteur: NodeJS.Timeout }>();

function demarrer(): ChildProcessWithoutNullStreams {
  if (processus && processus.exitCode === null) return processus;
  const exe = executable();
  if (!exe) throw new Error("klyra-entrees est introuvable : réinstalle l’app (Mac et Windows seulement).");
  const p = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  createInterface({ input: p.stdout }).on("line", (ligne) => {
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(ligne) as Record<string, unknown>;
    } catch {
      return;
    }
    const attente = attentes.get(Number(r.id));
    if (!attente) return;
    attentes.delete(Number(r.id));
    clearTimeout(attente.minuteur);
    if (r.ok) attente.resoudre(r);
    else attente.rejeter(new Error(String(r.erreur ?? "klyra-entrees a refusé la commande.")));
  });
  p.on("exit", () => {
    for (const [, a] of attentes) {
      clearTimeout(a.minuteur);
      a.rejeter(new Error("klyra-entrees s’est arrêté."));
    }
    attentes.clear();
    if (processus === p) processus = null;
  });
  processus = p;
  return p;
}

function envoyer(commande: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = demarrer();
  const id = suivant++;
  return new Promise((resoudre, rejeter) => {
    const minuteur = setTimeout(() => {
      attentes.delete(id);
      rejeter(new Error("klyra-entrees n’a pas répondu."));
    }, DELAI_MS);
    attentes.set(id, { resoudre, rejeter, minuteur });
    p.stdin.write(`${JSON.stringify({ ...commande, id })}\n`);
  });
}

/** DIP d'Electron → l'unité de klyra-entrees (pixels physiques sous Windows, points sur Mac). */
function versSysteme(p: Point): Point {
  const q = process.platform === "win32" ? screen.dipToScreenPoint(p) : p;
  return { x: Math.round(q.x), y: Math.round(q.y) };
}

/** Sans rien toucher : klyra-entrees répond-il, et (Mac) a-t-il l'autorisation Accessibilité ? */
export function ping(): Promise<{ version: number; accessibilite?: boolean }> {
  return envoyer({ action: "ping" }) as Promise<{ version: number; accessibilite?: boolean }>;
}

export async function deplacer(p: Point): Promise<void> {
  verifierInterrupteur();
  await envoyer({ action: "deplacer", ...versSysteme(p) });
}

export async function clic(p: Point, bouton: Bouton = "gauche", nombre = 1): Promise<void> {
  verifierInterrupteur();
  await envoyer({ action: "clic", ...versSysteme(p), bouton, nombre });
}

export async function taper(texte: string): Promise<void> {
  verifierInterrupteur();
  if (texte.length > 2000) throw new Error("Texte trop long pour une seule frappe.");
  await envoyer({ action: "taper", texte });
}

/** Une combinaison : modificateurs puis la touche, par leur nom (« cmd », « ctrl », « maj », « alt », « entree », « a »…). */
export async function touche(touches: string[]): Promise<void> {
  verifierInterrupteur();
  await envoyer({ action: "touche", touches: touches.map((t) => t.toLowerCase()) });
}

/** Défile au point donné, en crans : dy positif vers le bas, dx positif vers la droite. */
export async function defiler(p: Point, dy: number, dx = 0): Promise<void> {
  verifierInterrupteur();
  await envoyer({ action: "defiler", ...versSysteme(p), dy: Math.round(dy), dx: Math.round(dx) });
}

/** Arrêt d'urgence : relâche toutes les touches et tous les boutons. Toujours permis, même interrupteur coupé. */
export async function relacherTout(): Promise<void> {
  if (!processus) return;
  await envoyer({ action: "relacher-tout" }).catch(() => {});
}

export function arreter(): void {
  processus?.kill();
  processus = null;
}
