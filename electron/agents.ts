import { app, BrowserWindow } from "electron";
import { existsSync, watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { dossierAgents, empreinte, NOM_VALIDE } from "./mes-agents";

/**
 * Les fiches des sous-agents Claude Code : `~/.claude/agents/<name>.md`.
 * - Chaque écriture garde d'abord une copie de la version remplacée dans
 *   l'historique de l'app (hors du dossier des agents, que Claude Code lit).
 * - Une écriture est refusée si le fichier a changé sur le disque depuis que
 *   l'écran l'a lu (`expectedModifiedAt`) : on n'écrase jamais une modif faite
 *   ailleurs sans le dire.
 * - Le nom d'un agent est vérifié : impossible d'écrire hors du dossier.
 * - L'app ne supprime jamais une fiche : d'autres outils lisent ce dossier.
 *   Qui est dans « Mes agents » est tenu à part (`mes-agents.ts`).
 */

export interface AgentFile {
  name: string;
  path: string;
  content: string;
  modifiedAt: number;
  /** Empreinte du contenu : comparée à celle que l'app a écrite pour voir une modification faite ailleurs. */
  empreinte: string;
}

export interface AgentsListing {
  dir: string;
  exists: boolean;
  agents: AgentFile[];
}

export interface HistoryEntry {
  id: string;
  savedAt: number;
}

/** Préférences personnelles de chaque agent : rôle court, couleur et nom affiché (sans toucher à la fiche). */
export type AgentsMeta = Record<string, { tag?: string; teinte?: string; nom?: string; modele?: string }>;

export class AgentError extends Error {
  constructor(
    public code: "nom-invalide" | "conflit" | "existe-deja" | "introuvable" | "modifie-localement",
    message: string,
  ) {
    super(message);
  }
}

export const agentsDir = dossierAgents;
const historyDir = () => path.join(app.getPath("userData"), "historique-agents");
const metaFile = () => path.join(app.getPath("userData"), "agents-meta.json");

function fileFor(name: string): string {
  if (!NOM_VALIDE.test(name)) throw new AgentError("nom-invalide", `Nom d’agent invalide : « ${name} ».`);
  return path.join(agentsDir(), `${name}.md`);
}

export async function readFile(name: string): Promise<AgentFile | null> {
  const file = fileFor(name);
  try {
    const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return { name, path: file, content, modifiedAt: stat.mtimeMs, empreinte: empreinte(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listAgents(): Promise<AgentsListing> {
  const dir = agentsDir();
  if (!existsSync(dir)) return { dir, exists: false, agents: [] };
  const names = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((n) => NOM_VALIDE.test(n));
  const files = await Promise.all(names.map(readFile));
  return { dir, exists: true, agents: files.filter((f): f is AgentFile => f !== null) };
}

/** Copie la version actuelle dans l'historique avant de la remplacer. */
async function backup(current: AgentFile): Promise<void> {
  const dir = path.join(historyDir(), current.name);
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(dir, `${stamp}.md`), current.content, "utf8");
}

/** Écriture atomique : fichier temporaire puis renommage. */
async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}

export async function writeAgent(name: string, content: string, expectedModifiedAt: number | null): Promise<AgentFile> {
  const file = fileFor(name);
  const current = await readFile(name);
  if (!current) throw new AgentError("introuvable", `La fiche « ${name} » n’existe plus sur le disque.`);
  if (expectedModifiedAt !== null && Math.abs(current.modifiedAt - expectedModifiedAt) > 1) {
    throw new AgentError("conflit", "La fiche a changé sur le disque depuis que tu l’as ouverte.");
  }
  if (current.content === content) return current;
  // Le fichier temporaire d'abord : si le dossier refuse l'écriture, rien n'est copié dans l'historique.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  try {
    await backup(current);
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  return (await readFile(name)) as AgentFile;
}

export async function createAgent(name: string, content: string): Promise<AgentFile> {
  const file = fileFor(name);
  await fs.mkdir(agentsDir(), { recursive: true });
  try {
    await fs.writeFile(file, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AgentError("existe-deja", `Un agent « ${name} » existe déjà.`);
    }
    throw error;
  }
  return (await readFile(name)) as AgentFile;
}

export async function listHistory(name: string): Promise<HistoryEntry[]> {
  fileFor(name);
  const dir = path.join(historyDir(), name);
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  const entries = await Promise.all(
    files.map(async (f) => ({ id: f.slice(0, -3), savedAt: (await fs.stat(path.join(dir, f))).mtimeMs })),
  );
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

export async function readVersion(name: string, id: string): Promise<string> {
  fileFor(name);
  if (!/^[0-9TZ-]+$/.test(id)) throw new AgentError("introuvable", "Version introuvable.");
  return fs.readFile(path.join(historyDir(), name, `${id}.md`), "utf8");
}

export async function readMeta(): Promise<AgentsMeta> {
  try {
    return JSON.parse(await fs.readFile(metaFile(), "utf8")) as AgentsMeta;
  } catch {
    return {};
  }
}

export async function writeMeta(meta: AgentsMeta): Promise<void> {
  await fs.mkdir(path.dirname(metaFile()), { recursive: true });
  await writeAtomic(metaFile(), JSON.stringify(meta, null, 2));
}

/* ─── Surveillance du dossier ──────────────────────────────────── */

let watcher: FSWatcher | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Prévient les fenêtres quand une fiche change (même modifiée hors de l'app). */
export function watchAgents(): void {
  if (watcher || !existsSync(agentsDir())) return;
  watcher = watch(agentsDir(), () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send("agents:changed");
    }, 200);
  });
  watcher.on("error", () => {
    watcher?.close();
    watcher = null;
  });
}
