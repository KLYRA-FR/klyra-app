import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { skillRecue, type SkillsParAgent } from "./skills-par-agent";

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
 * Les skills personnelles copiées viennent de `userData/bibliotheque-skills` dès que ce dossier
 * existe (la copie du premier lancement). Sans lui, elles viennent encore du poste.
 * Les plugins et `settings.json` du poste sont des liens : Claude Code les charge comme avant.
 * Rien ici n'écrit dans le dossier du poste.
 *
 * Le PC envoie au VPS les dossiers des skills allumées pour au moins un agent.
 * Le VPS les écrit dans sa bibliothèque (`donnees/bibliotheque-skills`). Une skill
 * éteinte pour tout le monde ne part pas. Rien n'est supprimé sur le poste, ni dans
 * `~/.claude` du VPS : seule cette bibliothèque est remplacée par l'envoi.
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

/**
 * Lien vers le poste, même si le dossier préparé a déjà un fichier ou un dossier de ce nom.
 * Ce qui est remplacé est dans le dossier préparé, jamais le poste.
 */
function lierEnRemplacant(dossier: string, source: string | null, lien: string): void {
  if (!source || !existsSync(source) || !dans(dossier, lien)) return;
  try {
    const st = lstatSync(lien);
    if (st.isSymbolicLink() && path.resolve(path.dirname(lien), readlinkSync(lien)) === path.resolve(source)) return;
    rmSync(lien, { recursive: true, force: true });
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
    /** Dossier `plugins` du poste, et ses réglages (`enabledPlugins`). Liens, jamais une copie. */
    plugins?: string | null;
    reglages?: string | null;
    reglagesLocaux?: string | null;
  },
): void {
  mkdirSync(dossier, { recursive: true });
  ecrireFiches(dossier, entree.fiches);
  ecrireSkills(dossier, entree.skills);
  poserClaudeMd(dossier, entree.claudeMd);
  lier(entree.identifiants, path.join(dossier, ".credentials.json"));
  lier(entree.projects, path.join(dossier, "projects"));
  lier(entree.sessions, path.join(dossier, "sessions"));
  lierEnRemplacant(dossier, entree.plugins ?? null, path.join(dossier, "plugins"));
  lierEnRemplacant(dossier, entree.reglages ?? null, path.join(dossier, "settings.json"));
  lierEnRemplacant(dossier, entree.reglagesLocaux ?? null, path.join(dossier, "settings.local.json"));
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
  const skills = listerSkills(dossierSkillsSession(session.userData, poste)).filter((s) => session.garder(s.nom));
  const claudeMd = path.join(poste, "CLAUDE.md");
  preparerClaude(dossier, {
    fiches,
    skills,
    claudeMd: existsSync(claudeMd) ? claudeMd : null,
    identifiants: path.join(poste, ".credentials.json"),
    projects: path.join(poste, "projects"),
    sessions: path.join(poste, "sessions"),
    plugins: path.join(poste, "plugins"),
    reglages: path.join(poste, "settings.json"),
    reglagesLocaux: path.join(poste, "settings.local.json"),
  });
  return { dossier, skills: skills.map((s) => s.nom) };
}

/** La bibliothèque de l'app si elle existe, sinon les skills du poste. */
function dossierSkillsSession(userData: string, poste: string): string {
  const bibliotheque = path.join(userData, "bibliotheque-skills");
  return existsSync(bibliotheque) ? bibliotheque : path.join(poste, "skills");
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
  mkdirSync(opts.skillsDest, { recursive: true });
  for (const skill of listerSkills(opts.skillsPoste)) {
    const base = path.basename(skill.source);
    const dest = path.join(opts.skillsDest, base);
    if (!dans(opts.skillsDest, dest)) continue;
    if (copierSiAbsent(skill.source, dest)) skills.push(skill.nom);
  }
  return { fiches, skills };
}

export interface ImportSkills {
  ajoutees: string[];
  dejaLa: string[];
  ignorees: string[];
}

const triNoms = (noms: string[]) => [...noms].sort((a, b) => a.localeCompare(b, "fr"));

/**
 * Copie dans la bibliothèque de l'app les skills d'un dossier choisi.
 * Si ce dossier contient `SKILL.md`, c'est une skill. Sinon, ce sont ses sous-dossiers.
 * Un nom ou un dossier déjà présent n'est pas écrasé. Rien n'est supprimé, ni à la source, ni dans la bibliothèque.
 * Un lien n'est pas pris comme dossier de skill.
 */
export function importerSkills(source: string, dest: string): ImportSkills {
  const ajoutees: string[] = [];
  const dejaLa: string[] = [];
  const ignorees: string[] = [];
  const racine = path.resolve(source);
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(racine);
  } catch {
    return { ajoutees, dejaLa, ignorees: [path.basename(racine) || racine] };
  }
  if (!info.isDirectory() || info.isSymbolicLink()) return { ajoutees, dejaLa, ignorees: [path.basename(racine) || racine] };

  const garder: SkillSource[] = [];
  const enfants = listerSkills(racine);
  if (enfants.length) {
    garder.push(...enfants);
  } else {
    const fiche = path.join(racine, "SKILL.md");
    try {
      const fichier = lstatSync(fiche);
      if (fichier.isFile() && !fichier.isSymbolicLink()) {
        const base = path.basename(racine);
        if (!NOM_DOSSIER.test(base)) ignorees.push(base);
        else garder.push({ nom: nomSkill(readFileSync(fiche, "utf8"), racine), source: racine });
      }
    } catch {
      /* ce dossier n'est pas une skill */
    }
  }

  const bibliotheque = path.resolve(dest);
  mkdirSync(bibliotheque, { recursive: true });
  const presentes = listerSkills(bibliotheque);
  const noms = new Set(presentes.map((s) => s.nom));
  const dossiers = new Set(presentes.map((s) => path.basename(s.source)));
  for (const skill of garder) {
    const base = path.basename(skill.source);
    const cible = path.join(bibliotheque, base);
    if (!NOM_DOSSIER.test(base) || !dans(bibliotheque, cible)) {
      ignorees.push(skill.nom);
      continue;
    }
    if (path.resolve(skill.source) === path.resolve(cible) || existsSync(cible) || noms.has(skill.nom) || dossiers.has(base)) {
      dejaLa.push(skill.nom);
      continue;
    }
    if (dans(skill.source, cible)) {
      ignorees.push(skill.nom);
      continue;
    }
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(skill.source);
    } catch {
      ignorees.push(skill.nom);
      continue;
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      ignorees.push(skill.nom);
      continue;
    }
    cpSync(skill.source, cible, { recursive: true, dereference: true });
    ajoutees.push(skill.nom);
    noms.add(skill.nom);
    dossiers.add(base);
  }
  return { ajoutees: triNoms(ajoutees), dejaLa: triNoms(dejaLa), ignorees: triNoms(ignorees) };
}

/** Un fichier d'une skill envoyée au VPS. `binaire` : `contenu` est du base64. */
export interface FichierSkill {
  chemin: string;
  contenu: string;
  binaire?: boolean;
}

/** Un dossier de skill allumée pour au moins un agent. `nom` vient de l'en-tête, `dossier` du disque. */
export interface SkillEnvoyee {
  nom: string;
  dossier: string;
  fichiers: FichierSkill[];
}

const NOM_FICHIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;
const FICHIER_MAX = 400_000;
const FICHIERS_MAX = 40;
const SKILLS_MAX = 80;
const TOTAL_MAX = 4_000_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function cheminRelatif(chemin: string): string[] | null {
  if (!chemin || chemin.includes("\\") || chemin.startsWith("/") || chemin.includes("\0")) return null;
  const parts = chemin.split("/");
  if (!parts.length || parts.some((p) => !NOM_FICHIER.test(p) || p === "." || p === "..")) return null;
  return parts;
}

/** Les fichiers d'un dossier de skill. null : pas de SKILL.md, ou ce fichier ne tient pas dans l'envoi. */
function lireFichiersSkill(racine: string): FichierSkill[] | null {
  const fichiers: FichierSkill[] = [];
  const visiter = (absolu: string, relatif: string): boolean => {
    let noms: string[];
    try {
      noms = readdirSync(absolu).sort((a, b) => a.localeCompare(b, "en"));
    } catch {
      return relatif !== "";
    }
    for (const nom of noms) {
      if (nom.startsWith(".") || nom === "node_modules" || nom === ".git") continue;
      if (!NOM_FICHIER.test(nom)) continue;
      const chemin = relatif ? `${relatif}/${nom}` : nom;
      const cible = path.join(absolu, nom);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(cible);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (!visiter(cible, chemin)) return false;
        continue;
      }
      if (!st.isFile()) continue;
      if (fichiers.length >= FICHIERS_MAX) return false;
      let buf: Buffer;
      try {
        buf = readFileSync(cible);
      } catch {
        continue;
      }
      const binaire = buf.includes(0);
      const contenu = binaire ? buf.toString("base64") : buf.toString("utf8");
      if (contenu.length > FICHIER_MAX) {
        if (chemin === "SKILL.md") return false;
        continue;
      }
      fichiers.push(binaire ? { chemin, contenu, binaire: true } : { chemin, contenu });
    }
    return true;
  };
  if (!visiter(racine, "")) return null;
  if (!fichiers.some((f) => f.chemin === "SKILL.md" && !f.binaire && f.contenu.length > 0)) return null;
  fichiers.sort((a, b) => a.chemin.localeCompare(b.chemin, "en"));
  return fichiers;
}

/**
 * Les dossiers à envoyer : une skill du poste (ou de la bibliothèque) allumée pour
 * au moins un agent. `actifs` : les agents actifs, en plus de ceux déjà connus du choix.
 * Une skill éteinte pour tout le monde n'est pas dans la liste. Un lien, `node_modules`
 * ou `.git` n'est pas lu. Si `SKILL.md` ne tient pas, la skill ne part pas.
 */
export function skillsAEnvoyer(choix: SkillsParAgent, actifs: readonly string[], sources: SkillSource[]): SkillEnvoyee[] {
  const ids = new Set<string>(["principal"]);
  for (const id of [...actifs, ...choix.agentsConnus, ...Object.keys(choix.activees), ...Object.keys(choix.coupees)]) {
    if (id === "principal" || ID_AGENT.test(id)) ids.add(id);
  }
  const envoyees: SkillEnvoyee[] = [];
  let total = 0;
  for (const source of sources) {
    if (![...ids].some((id) => skillRecue(choix, id === "principal" ? null : id, source.nom, "poste"))) continue;
    if (envoyees.length >= SKILLS_MAX) break;
    const dossier = path.basename(source.source);
    if (!NOM_DOSSIER.test(dossier)) continue;
    const fichiers = lireFichiersSkill(source.source);
    if (!fichiers) continue;
    const poids = fichiers.reduce((n, f) => n + f.contenu.length, 0);
    if (total + poids > TOTAL_MAX) continue;
    envoyees.push({ nom: source.nom, dossier, fichiers });
    total += poids;
  }
  return envoyees.sort((a, b) => a.dossier.localeCompare(b.dossier, "en") || a.nom.localeCompare(b.nom, "fr"));
}

/** Empreinte du contenu envoyé : une édition de SKILL.md change l'envoi, sans changer le choix des interrupteurs. */
export function empreinteSkills(skills: readonly SkillEnvoyee[]): string {
  return createHash("sha256").update(JSON.stringify(skills)).digest("hex");
}

function octetsDe(fichier: FichierSkill): Buffer {
  if (!fichier.binaire) return Buffer.from(fichier.contenu, "utf8");
  const contenu = fichier.contenu;
  if (contenu.length % 4 !== 0 || !BASE64.test(contenu)) throw new Error("skills");
  const octets = Buffer.from(contenu, "base64");
  if (octets.length > FICHIER_MAX || octets.toString("base64") !== contenu) throw new Error("skills");
  return octets;
}

/** Vérifie l'envoi. Lève si un chemin sort du dossier, ou si un fichier est trop gros. N'écrit rien. */
export function normaliserSkillsRecues(brut: unknown): SkillEnvoyee[] {
  if (!Array.isArray(brut) || brut.length > SKILLS_MAX) throw new Error("skills");
  const vus = new Set<string>();
  const skills: SkillEnvoyee[] = [];
  let total = 0;
  for (const entree of brut) {
    const e = (entree ?? {}) as Partial<SkillEnvoyee>;
    const dossier = typeof e.dossier === "string" ? e.dossier : "";
    const nom = typeof e.nom === "string" && e.nom.length <= 80 ? e.nom : dossier;
    if (!NOM_DOSSIER.test(dossier) || vus.has(dossier) || !Array.isArray(e.fichiers) || e.fichiers.length > FICHIERS_MAX) throw new Error("skills");
    const chemins = new Set<string>();
    const fichiers: FichierSkill[] = [];
    for (const fichier of e.fichiers) {
      const f = (fichier ?? {}) as Partial<FichierSkill>;
      if (typeof f.chemin !== "string" || typeof f.contenu !== "string" || !cheminRelatif(f.chemin) || chemins.has(f.chemin)) throw new Error("skills");
      if (f.contenu.length > FICHIER_MAX || (f.binaire !== undefined && f.binaire !== true)) throw new Error("skills");
      const recu: FichierSkill = f.binaire === true ? { chemin: f.chemin, contenu: f.contenu, binaire: true } : { chemin: f.chemin, contenu: f.contenu };
      octetsDe(recu);
      chemins.add(f.chemin);
      fichiers.push(recu);
      total += f.contenu.length;
    }
    if (total > TOTAL_MAX) throw new Error("skills");
    if (!fichiers.some((f) => f.chemin === "SKILL.md" && !f.binaire && f.contenu.length > 0)) throw new Error("skills");
    vus.add(dossier);
    skills.push({ nom, dossier, fichiers });
  }
  return skills;
}

/**
 * Écrit la bibliothèque de l'app : exactement les dossiers reçus.
 * Un dossier absent de l'envoi est retiré de CETTE bibliothèque seulement.
 * Un lien est retiré, pas la cible. Le poste et `~/.claude` ne sont pas des arguments ici.
 */
export function ecrireBibliotheque(dest: string, brut: unknown): void {
  const skills = normaliserSkillsRecues(brut);
  const bibliotheque = path.resolve(dest);
  try {
    if (lstatSync(bibliotheque).isSymbolicLink()) throw new Error("skills");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as Error).message !== "skills") throw error;
    if ((error as Error).message === "skills") throw error;
  }
  mkdirSync(bibliotheque, { recursive: true, mode: 0o700 });
  const gardes = new Set<string>();
  for (const skill of skills) {
    const cible = path.join(bibliotheque, skill.dossier);
    if (!dans(bibliotheque, cible)) throw new Error("skills");
    try {
      const st = lstatSync(cible);
      if (st.isSymbolicLink()) rmSync(cible, { force: true });
      else rmSync(cible, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    mkdirSync(cible, { recursive: true, mode: 0o700 });
    for (const fichier of skill.fichiers) {
      const parts = cheminRelatif(fichier.chemin);
      if (!parts) throw new Error("skills");
      const fichierCible = path.join(cible, ...parts);
      if (!dans(cible, fichierCible)) throw new Error("skills");
      mkdirSync(path.dirname(fichierCible), { recursive: true, mode: 0o700 });
      writeFileSync(fichierCible, octetsDe(fichier), { mode: 0o600 });
    }
    gardes.add(skill.dossier);
  }
  for (const nom of readdirSync(bibliotheque)) {
    if (gardes.has(nom)) continue;
    const cible = path.join(bibliotheque, nom);
    if (!dans(bibliotheque, cible)) continue;
    const st = lstatSync(cible);
    if (st.isSymbolicLink()) rmSync(cible, { force: true });
    else rmSync(cible, { recursive: true, force: true });
  }
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
