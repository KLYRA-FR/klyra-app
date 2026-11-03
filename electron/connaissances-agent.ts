import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, type Dirent } from "node:fs";
import path from "node:path";

/*
 * Ce qu'un agent sait, lu sur le disque tel que Claude Code le range (vérifié dans Claude Code 2.1.317) :
 *
 * - **Sa mémoire.** Une fiche qui a `memory` : `user` → `<config>/agent-memory/<agent>/`, `project` →
 *   `<dossier>/.claude/agent-memory/<agent>/`, `local` → `<dossier>/.claude/agent-memory-local/<agent>/`.
 *   L'assistant (la session principale) a la mémoire automatique de son dossier :
 *   `<config>/projects/<dossier en tirets>/memory/`. Dans chacun, `MEMORY.md` est l'index lu à chaque
 *   appel (ses 200 premières lignes, 25 000 octets au plus) ; les autres fichiers sont lus au besoin.
 * - **Ses compétences.** Celles que sa fiche précharge (`skills`), puis les skills du poste
 *   (`<config>/skills/`) et du projet (`<dossier>/.claude/skills/`), que tout agent peut utiliser.
 *
 * Module pur (ni Electron ni état) : le process principal lui donne les dossiers, l'écran ne donne
 * jamais un chemin de mémoire. Rien n'est supprimé ; une écriture refuse un fichier changé entre-temps.
 */

export type PorteeMemoire = "user" | "project" | "local" | "auto";

export const INDEX = "MEMORY.md";
/** Ce que Claude Code lit de l'index à chaque appel. */
export const LIGNES_INDEX = 200;
const NOM_AGENT = /^[a-z0-9][a-z0-9-]*$/;
/** Au-delà, la liste est coupée (et le dit) : une mémoire n'a pas des milliers de fichiers. */
const MAX_SOUVENIRS = 500;

export interface Souvenir {
  /** Chemin dans le dossier de la mémoire, en `/` (« MEMORY.md », « projets/klyra.md »). */
  id: string;
  titre: string;
  description: string;
  /** L'index, lu à chaque appel ; les autres sont lus au besoin. */
  toujours: boolean;
  modifieLe: number;
}

export interface Memoire {
  portee: PorteeMemoire;
  /** Le dossier, absolu, qu'il existe ou non encore. */
  dossier: string;
  souvenirs: Souvenir[];
  /** Plus de MAX_SOUVENIRS fichiers : la liste est coupée. */
  coupee: boolean;
}

export type CodeConnaissances = "nom-invalide" | "portee-invalide" | "chemin-invalide" | "introuvable" | "conflit" | "vide";

export class ErreurConnaissances extends Error {
  readonly code: CodeConnaissances;
  constructor(code: CodeConnaissances, message: string) {
    super(message);
    this.code = code;
  }
}

/** Le dossier de la mémoire d'un agent, d'après sa portée et le dossier de travail de la conversation. */
export function dossierMemoire(agent: string, portee: PorteeMemoire, dossierTravail: string, configClaude: string): string {
  if (!NOM_AGENT.test(agent)) throw new ErreurConnaissances("nom-invalide", `Nom d’agent invalide : « ${agent} ».`);
  switch (portee) {
    case "user":
      return path.join(configClaude, "agent-memory", agent);
    case "project":
      return path.join(dossierTravail, ".claude", "agent-memory", agent);
    case "local":
      return path.join(dossierTravail, ".claude", "agent-memory-local", agent);
    case "auto":
      // Comme `sessionsDuDossier` (atelier.ts) : chaque signe hors lettres et chiffres en « - ».
      return path.join(configClaude, "projects", dossierTravail.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
    default:
      throw new ErreurConnaissances("portee-invalide", "Portée de mémoire inconnue.");
  }
}

export const porteeValide = (p: unknown): p is PorteeMemoire => p === "user" || p === "project" || p === "local" || p === "auto";

/** La portée de la mémoire d'une fiche (`memory` de son en-tête) ; null : l'agent n'a pas de mémoire. */
export function porteeDeLaFiche(contenu: string): Exclude<PorteeMemoire, "auto"> | null {
  const p = champ(contenu, "memory");
  return p === "user" || p === "project" || p === "local" ? p : null;
}

/** Un en-tête YAML simple : `cle: valeur` (entre guillemets ou non). */
function champ(contenu: string, cle: string): string {
  const entete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contenu)?.[1] ?? "";
  const ligne = new RegExp(`^${cle}:\\s*(.*)$`, "m").exec(entete)?.[1]?.trim() ?? "";
  return ligne.replace(/^(["'])([\s\S]*)\1$/, "$2");
}

/** Le texte sans son en-tête YAML. */
function corps(contenu: string): string {
  return contenu.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/** La première ligne de texte (ni titre, ni liste vide, ni séparateur), raccourcie. */
function premiereLigne(texte: string): string {
  for (const brute of texte.split(/\r?\n/)) {
    const ligne = brute.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim();
    if (ligne && !/^[-=*_]{3,}$/.test(ligne)) return ligne.length > 160 ? `${ligne.slice(0, 159)}…` : ligne;
  }
  return "";
}

function souvenirDe(dossier: string, id: string): Souvenir {
  const fichier = path.join(dossier, id);
  const contenu = readFileSync(fichier, "utf8");
  const stat = statSync(fichier);
  if (id === INDEX) {
    const lignes = contenu.split(/\r?\n/).filter((l) => l.trim()).length;
    return {
      id,
      titre: "Index de la mémoire",
      description: lignes ? `${lignes} ligne${lignes > 1 ? "s" : ""}${lignes > LIGNES_INDEX ? `, les ${LIGNES_INDEX} premières lues` : ""}` : "Vide",
      toujours: true,
      modifieLe: stat.mtimeMs,
    };
  }
  const texte = corps(contenu);
  const titre = champ(contenu, "name") || /^#\s+(.+)$/m.exec(texte)?.[1]?.trim() || id.replace(/\.md$/i, "").split("/").pop()!;
  return { id, titre, description: champ(contenu, "description") || premiereLigne(texte.replace(/^#\s+.+$/m, "")), toujours: false, modifieLe: stat.mtimeMs };
}

/** Les fichiers `.md` de la mémoire (deux niveaux de dossiers au plus), l'index d'abord puis les plus récents. */
export function lireMemoire(portee: PorteeMemoire, dossier: string): Memoire {
  const ids: string[] = [];
  let coupee = false;
  const parcourir = (relatif: string, profondeur: number) => {
    let entrees: Dirent[];
    try {
      entrees = readdirSync(path.join(dossier, relatif), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entrees) {
      if (e.name.startsWith(".")) continue;
      const id = relatif ? `${relatif}/${e.name}` : e.name;
      if (e.isDirectory() && profondeur < 2) parcourir(id, profondeur + 1);
      else if (e.isFile() && /\.md$/i.test(e.name)) {
        if (ids.length >= MAX_SOUVENIRS) coupee = true;
        else ids.push(id);
      }
    }
  };
  parcourir("", 0);
  const souvenirs = ids
    .map((id) => {
      try {
        return souvenirDe(dossier, id);
      } catch {
        return null;
      }
    })
    .filter((s): s is Souvenir => s !== null)
    .sort((a, b) => Number(b.toujours) - Number(a.toujours) || b.modifieLe - a.modifieLe);
  return { portee, dossier, souvenirs, coupee };
}

/** Le chemin d'un souvenir, gardé dans le dossier de la mémoire (ni `..`, ni chemin absolu, ni autre chose qu'un `.md`). */
export function cheminSouvenir(dossier: string, id: string): string {
  if (typeof id !== "string" || !/\.md$/i.test(id) || path.isAbsolute(id) || id.includes("\0")) throw new ErreurConnaissances("chemin-invalide", "Ce souvenir n’est pas dans la mémoire de l’agent.");
  const fichier = path.resolve(dossier, id);
  const relatif = path.relative(path.resolve(dossier), fichier);
  if (!relatif || relatif.startsWith("..") || path.isAbsolute(relatif)) throw new ErreurConnaissances("chemin-invalide", "Ce souvenir n’est pas dans la mémoire de l’agent.");
  return fichier;
}

export function lireSouvenir(dossier: string, id: string): { contenu: string; modifieLe: number } {
  const fichier = cheminSouvenir(dossier, id);
  if (!existsSync(fichier)) throw new ErreurConnaissances("introuvable", "Ce souvenir n’existe plus.");
  return { contenu: readFileSync(fichier, "utf8"), modifieLe: statSync(fichier).mtimeMs };
}

/** Réécrit un souvenir ; refuse si le fichier a changé depuis sa lecture (`attendu`, en ms). */
export function ecrireSouvenir(dossier: string, id: string, contenu: string, attendu: number | null): { modifieLe: number } {
  const fichier = cheminSouvenir(dossier, id);
  if (!existsSync(fichier)) throw new ErreurConnaissances("introuvable", "Ce souvenir n’existe plus.");
  if (attendu !== null && Math.abs(statSync(fichier).mtimeMs - attendu) > 1) throw new ErreurConnaissances("conflit", "Le souvenir a changé pendant ta modification (l’agent l’a peut-être mis à jour). Rouvre-le : rien n’a été écrasé.");
  writeFileSync(fichier, contenu.endsWith("\n") ? contenu : `${contenu}\n`, "utf8");
  return { modifieLe: statSync(fichier).mtimeMs };
}

/** « Réunion du 3 nov. » → `reunion-du-3-nov` (minuscules, sans accents). */
export function nomDeFichier(titre: string): string {
  const base = titre
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "souvenir";
}

const yaml = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s*\n\s*/g, " ")}"`;

/**
 * Un nouveau souvenir, comme Claude Code les écrit : un fichier avec `name` et `description` en
 * en-tête, et sa ligne dans l'index (créé au besoin), pour que l'agent sache qu'il existe.
 * Jamais d'écrasement : un nom déjà pris reçoit un suffixe.
 */
export function creerSouvenir(dossier: string, titre: string, contenu: string): Souvenir {
  const propre = titre.trim().replace(/\s+/g, " ");
  if (!propre || !contenu.trim()) throw new ErreurConnaissances("vide", "Donne un titre et un contenu au souvenir.");
  mkdirSync(dossier, { recursive: true });
  const base = nomDeFichier(propre);
  let id = `${base}.md`;
  for (let i = 2; existsSync(path.join(dossier, id)) || id === INDEX; i += 1) id = `${base}-${i}.md`;
  const description = premiereLigne(contenu);
  writeFileSync(path.join(dossier, id), `---\nname: ${yaml(propre)}\ndescription: ${yaml(description)}\n---\n\n${contenu.trim()}\n`, { encoding: "utf8", flag: "wx" });
  const index = path.join(dossier, INDEX);
  const avant = existsSync(index) ? readFileSync(index, "utf8") : "";
  const ligne = `- [${propre.replace(/[[\]]/g, "")}](${id})${description ? ` — ${description}` : ""}`;
  writeFileSync(index, `${avant}${avant && !avant.endsWith("\n") ? "\n" : ""}${ligne}\n`, "utf8");
  return souvenirDe(dossier, id);
}

/* ─── Compétences ─────────────────────────────────────────────── */

export interface Competence {
  nom: string;
  description: string;
  version: string | null;
  /** Le dossier de la skill (pour « Montrer »), null si elle n'est pas trouvée sur le poste. */
  dossier: string | null;
}

export interface Competences {
  /** Préchargées par la fiche (`skills`) : leur texte entre dans chaque appel de l'agent. */
  fiche: Competence[];
  /** Les skills du poste : tout agent peut s'en servir. */
  poste: Competence[];
  /** Celles du projet de la conversation. */
  projet: Competence[];
}

/** La liste `skills` d'un en-tête de fiche : `skills: a, b`, `skills: [a, b]` ou une liste YAML sur plusieurs lignes. */
export function skillsDeLaFiche(contenu: string): string[] {
  const entete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contenu)?.[1];
  if (!entete) return [];
  const lignes = entete.split(/\r?\n/);
  const i = lignes.findIndex((l) => /^skills:/.test(l));
  if (i < 0) return [];
  const enLigne = lignes[i].replace(/^skills:\s*/, "").trim();
  const nettoyer = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  if (enLigne)
    return enLigne
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(nettoyer)
      .filter(Boolean);
  const liste: string[] = [];
  for (const l of lignes.slice(i + 1)) {
    const m = /^\s+-\s+(.+)$/.exec(l);
    if (!m) break;
    liste.push(nettoyer(m[1]));
  }
  return liste.filter(Boolean);
}

function lireSkills(dossier: string): Competence[] {
  let noms: string[];
  try {
    noms = readdirSync(dossier);
  } catch {
    return [];
  }
  const liste: Competence[] = [];
  for (const nom of noms) {
    if (nom.startsWith(".")) continue;
    const fichier = path.join(dossier, nom, "SKILL.md");
    let contenu: string;
    try {
      contenu = readFileSync(fichier, "utf8");
    } catch {
      continue;
    }
    liste.push({ nom: champ(contenu, "name") || nom, description: champ(contenu, "description"), version: champ(contenu, "version") || null, dossier: path.join(dossier, nom) });
  }
  return liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/** Ce que l'agent sait faire : les skills de sa fiche (retrouvées sur le poste ou le projet), puis celles du poste et du projet. */
export function lireCompetences(contenuFiche: string | null, configClaude: string, dossierProjet: string | null): Competences {
  const poste = lireSkills(path.join(configClaude, "skills"));
  const projet = dossierProjet ? lireSkills(path.join(dossierProjet, ".claude", "skills")) : [];
  const fiche = skillsDeLaFiche(contenuFiche ?? "").map(
    (nom) => projet.find((s) => s.nom === nom || path.basename(s.dossier ?? "") === nom) ?? poste.find((s) => s.nom === nom || path.basename(s.dossier ?? "") === nom) ?? { nom, description: "", version: null, dossier: null },
  );
  return { fiche, poste, projet };
}
