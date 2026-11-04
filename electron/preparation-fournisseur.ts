import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Ce que KLYRA prépare pour un fournisseur, à part du poste.
 *
 * Claude Code lit `CLAUDE_CONFIG_DIR` à la place de `~/.claude` (prouvé le 04/11/2026,
 * Claude Code 2.1.306, faux fournisseur) : les agents et les skills de ce dossier,
 * pas ceux du poste. Le CLAUDE.md de ce dossier est un lien vers celui du poste :
 * une copie perd les imports `@./` (prouvé le 04/11/2026, Claude Code 2.1.306).
 * Le CLAUDE.md du projet et les skills du projet restent lus depuis le dossier de travail.
 * `--setting-sources project,local` retire AUSSI ce dossier (agents, skills, CLAUDE.md) :
 * on ne le combine pas avec lui.
 *
 * La connexion et les sessions restent celles du poste : un lien vers `.credentials.json`,
 * `projects` et `sessions`, jamais une copie, jamais une suppression.
 * Rien ici n'écrit dans le dossier du poste.
 */

const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NOM_DOSSIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

export interface SkillSource {
  nom: string;
  /** Dossier qui contient `SKILL.md`. */
  source: string;
}

export interface RepriseEquipe {
  fiches: string[];
  skills: string[];
}

function dans(racine: string, cible: string): boolean {
  const base = path.resolve(racine);
  const resolu = path.resolve(cible);
  return resolu === base || resolu.startsWith(base + path.sep);
}

function nomSkill(contenu: string, dossier: string): string {
  const entete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contenu)?.[1] ?? "";
  const brut = /^name:\s*(.*)$/m.exec(entete)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  return brut || path.basename(dossier);
}

/** Les skills d'un dossier (`<racine>/<nom>/SKILL.md`), par le nom de leur en-tête. */
export function listerSkills(racine: string): SkillSource[] {
  let noms: string[];
  try {
    noms = readdirSync(racine);
  } catch {
    return [];
  }
  const liste: SkillSource[] = [];
  for (const nom of noms) {
    if (nom.startsWith(".") || !NOM_DOSSIER.test(nom)) continue;
    const source = path.join(racine, nom);
    let contenu: string;
    try {
      if (!lstatSync(source).isDirectory()) continue;
      contenu = readFileSync(path.join(source, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    liste.push({ nom: nomSkill(contenu, source), source });
  }
  return liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/** Pose un lien vers un fichier ou un dossier du poste. Ne remplace rien qui existe déjà. */
function lier(source: string | null, lien: string): void {
  if (!source || !existsSync(source)) return;
  try {
    const st = lstatSync(lien);
    if (st.isSymbolicLink() && path.resolve(path.dirname(lien), readlinkSync(lien)) === path.resolve(source)) return;
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
  symlinkSync(source, lien);
}

function ecrireFiches(dossier: string, fiches: { id: string; contenu: string }[]): void {
  const agents = path.join(dossier, "agents");
  mkdirSync(agents, { recursive: true });
  const gardes = new Set<string>();
  for (const fiche of fiches) {
    if (!ID_AGENT.test(fiche.id)) continue;
    const cible = path.join(agents, `${fiche.id}.md`);
    if (!dans(agents, cible)) continue;
    writeFileSync(cible, fiche.contenu, "utf8");
    gardes.add(`${fiche.id}.md`);
  }
  for (const nom of readdirSync(agents)) {
    if (!nom.endsWith(".md") || gardes.has(nom)) continue;
    const cible = path.join(agents, nom);
    if (dans(agents, cible)) rmSync(cible, { force: true });
  }
}

function ecrireSkills(dossier: string, skills: SkillSource[]): void {
  const racine = path.join(dossier, "skills");
  mkdirSync(racine, { recursive: true });
  const gardes = new Set<string>();
  for (const skill of skills) {
    const base = path.basename(skill.source);
    if (!NOM_DOSSIER.test(base) || !existsSync(path.join(skill.source, "SKILL.md"))) continue;
    const cible = path.join(racine, base);
    if (!dans(racine, cible) || dans(skill.source, cible)) continue;
    rmSync(cible, { recursive: true, force: true });
    cpSync(skill.source, cible, { recursive: true, dereference: true });
    gardes.add(base);
  }
  for (const nom of readdirSync(racine)) {
    if (nom.startsWith(".") || gardes.has(nom)) continue;
    const cible = path.join(racine, nom);
    if (dans(racine, cible)) rmSync(cible, { recursive: true, force: true });
  }
}

/** Pose un lien vers le CLAUDE.md du poste. Remplace le fichier de CE dossier, jamais celui du poste. */
function poserClaudeMd(dossier: string, source: string | null): void {
  const cible = path.join(dossier, "CLAUDE.md");
  if (!source || !existsSync(source) || !dans(dossier, cible)) {
    try {
      if (!lstatSync(cible).isDirectory()) rmSync(cible, { force: true });
    } catch {
      /* absent */
    }
    return;
  }
  try {
    const st = lstatSync(cible);
    if (st.isSymbolicLink() && path.resolve(path.dirname(cible), readlinkSync(cible)) === path.resolve(source)) return;
    if (st.isDirectory()) return;
    rmSync(cible, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
  symlinkSync(source, cible);
}

/**
 * Remplit le dossier que Claude Code lira (`CLAUDE_CONFIG_DIR`).
 * `claudeMd` null retire le CLAUDE.md de CE dossier (pas celui du poste).
 */
export function preparerClaude(
  dossier: string,
  entree: {
    fiches: { id: string; contenu: string }[];
    skills: SkillSource[];
    /** Chemin du CLAUDE.md du poste, ou null. */
    claudeMd: string | null;
    identifiants: string | null;
    projects: string | null;
    sessions: string | null;
  },
): void {
  mkdirSync(dossier, { recursive: true });
  ecrireFiches(dossier, entree.fiches);
  ecrireSkills(dossier, entree.skills);
  poserClaudeMd(dossier, entree.claudeMd);
  lier(entree.identifiants, path.join(dossier, ".credentials.json"));
  lier(entree.projects, path.join(dossier, "projects"));
  lier(entree.sessions, path.join(dossier, "sessions"));
}

export interface SessionClaude {
  userData: string | null;
  home: string;
  agent: string | null;
  dossierAgents: string;
  idsActifs: string[];
  garder: (nom: string) => boolean;
  /** Dossier Claude à lire. Absent : `<home>/.claude`. Jamais le dossier préparé. */
  poste?: string | null;
}

/**
 * Prépare le dossier de l'agent et le rend. null : pas de dossier d'app
 * (la session reste sur le poste, comme avant).
 */
export function preparerSessionClaude(session: SessionClaude): { dossier: string; skills: string[] } | null {
  if (!session.userData) return null;
  const id = session.agent && ID_AGENT.test(session.agent) ? session.agent : "principal";
  const dossier = path.join(session.userData, "preparation", id);
  const poste = session.poste || path.join(session.home, ".claude");
  const fiches: { id: string; contenu: string }[] = [];
  for (const agent of session.idsActifs) {
    if (!ID_AGENT.test(agent)) continue;
    try {
      fiches.push({ id: agent, contenu: readFileSync(path.join(session.dossierAgents, `${agent}.md`), "utf8") });
    } catch {
      /* fiche absente : on ne l'invente pas */
    }
  }
  const skills = listerSkills(path.join(poste, "skills")).filter((s) => session.garder(s.nom));
  const claudeMd = path.join(poste, "CLAUDE.md");
  preparerClaude(dossier, {
    fiches,
    skills,
    claudeMd: existsSync(claudeMd) ? claudeMd : null,
    identifiants: path.join(poste, ".credentials.json"),
    projects: path.join(poste, "projects"),
    sessions: path.join(poste, "sessions"),
  });
  return { dossier, skills: skills.map((s) => s.nom) };
}

function copierSiAbsent(source: string, dest: string): boolean {
  if (existsSync(dest) || !existsSync(source)) return false;
  mkdirSync(path.dirname(dest), { recursive: true });
  const st = lstatSync(source);
  if (st.isSymbolicLink()) return false;
  if (st.isDirectory()) cpSync(source, dest, { recursive: true, dereference: true });
  else writeFileSync(dest, readFileSync(source));
  return true;
}

/**
 * Copie les fiches et les skills du poste dans le dossier de l'app, une fois,
 * seulement là où il n'y a encore rien. Ne supprime et ne modifie rien du poste.
 */
export function migrerCopies(opts: { fichesPoste: string; skillsPoste: string; fichesDest: string; skillsDest: string }): RepriseEquipe {
  const fiches: string[] = [];
  let noms: string[] = [];
  try {
    noms = readdirSync(opts.fichesPoste);
  } catch {
    noms = [];
  }
  for (const nom of noms) {
    if (!nom.endsWith(".md")) continue;
    const id = nom.slice(0, -3);
    if (!ID_AGENT.test(id)) continue;
    const dest = path.join(opts.fichesDest, nom);
    if (!dans(opts.fichesDest, dest)) continue;
    if (copierSiAbsent(path.join(opts.fichesPoste, nom), dest)) fiches.push(id);
  }
  const skills: string[] = [];
  for (const skill of listerSkills(opts.skillsPoste)) {
    const base = path.basename(skill.source);
    const dest = path.join(opts.skillsDest, base);
    if (!dans(opts.skillsDest, dest)) continue;
    if (copierSiAbsent(skill.source, dest)) skills.push(skill.nom);
  }
  return { fiches, skills };
}

/** Le compte rendu déjà écrit, ou null. */
export function lireReprise(fichier: string): RepriseEquipe | null {
  try {
    const brut = JSON.parse(readFileSync(fichier, "utf8")) as { fiches?: unknown; skills?: unknown };
    const noms = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is string => typeof n === "string") : []);
    return { fiches: noms(brut.fiches), skills: noms(brut.skills) };
  } catch {
    return null;
  }
}
