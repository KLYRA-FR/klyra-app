import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { filtreSkills } from "./connaissances-agent";
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
 * `projects` et `sessions`, jamais une copie, jamais une suppression. Avec un compte Claude supplémentaire
 * choisi pour la conversation, la connexion est celle de ce compte (dossier préparé à part, cf. `compte`).
 * Les skills personnelles copiées viennent de `userData/bibliotheque-skills` dès que ce dossier
 * existe (la copie du premier lancement). Sans lui, elles viennent encore du poste.
 * Les plugins et `settings.json` du poste sont des liens : Claude Code les charge comme avant.
 * Rien ici n'écrit dans le dossier du poste.
 *
 * Le PC envoie au VPS les dossiers des skills allumées pour au moins un agent.
 * Le VPS les écrit dans sa bibliothèque (`donnees/bibliotheque-skills`). Une skill
 * éteinte pour tout le monde ne part pas. Rien n'est supprimé sur le poste, ni dans
 * `~/.claude` du VPS : seule cette bibliothèque est remplacée par l'envoi.
 *
 * Codex ne lit pas `.claude/skills`. Chaque agent a son `CODEX_HOME`
 * (`userData/preparation-codex/<agent>`) : les skills allumées pour lui, et des liens
 * vers `config.toml` et `auth.json` du Codex du poste. Son `HOME` est vide de skills,
 * pour que `~/.agents/skills` du poste ne passe pas. Le processus du compte n'a pas ce dossier.
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

/** Un lien dans le dossier préparé est retiré, sans suivre la cible (jamais le poste). */
function oterSiLien(chemin: string): void {
  try {
    if (lstatSync(chemin).isSymbolicLink()) rmSync(chemin, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
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

const MAX_SKILLS_APPELE = 32;
const MAX_TEXTE_SKILL = 40_000;
const NOM_SKILL = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,80}$/;
const NOM_OUTIL = /^[^\n\r]{1,120}$/;

/** Découpe l'en-tête YAML. Sans en-tête, `lignes` est null et le texte reste le corps. */
function couperEntete(contenu: string): { lignes: string[] | null; corps: string } {
  const texte = contenu.replace(/\r\n/g, "\n");
  if (!texte.startsWith("---\n")) return { lignes: null, corps: texte };
  const fin = texte.indexOf("\n---", 3);
  if (fin < 0) return { lignes: null, corps: texte };
  const apres = texte.slice(fin + 4);
  return { lignes: texte.slice(4, fin).split("\n"), corps: apres.startsWith("\n") ? apres.slice(1) : apres };
}

interface BlocEntete {
  cle: string;
  valeur: string;
  suite: string[];
}

function blocsEntete(lignes: string[]): BlocEntete[] {
  const sortie: BlocEntete[] = [];
  for (const ligne of lignes) {
    const m = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(ligne);
    if (m) sortie.push({ cle: m[1], valeur: m[2], suite: [] });
    else if (sortie.length) sortie[sortie.length - 1].suite.push(ligne);
  }
  return sortie;
}

function nomsListe(bloc: BlocEntete, motif: RegExp): string[] {
  /* Une liste YAML : une entrée par ligne, espaces compris (`Bash(git *)`).
     Une valeur sur la même ligne : découpée par les virgules. */
  const morceaux = bloc.suite.length ? bloc.suite : bloc.valeur.replace(/^\[|\]$/g, "").split(/[\n,]/);
  return morceaux
    .map((l) => l.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, ""))
    .filter((n) => motif.test(n));
}

function blocListe(cle: string, noms: string[], motif: RegExp): BlocEntete | null {
  const propres = [...new Set(noms)].filter((n) => motif.test(n));
  if (!propres.length) return null;
  return { cle, valeur: "", suite: propres.map((n) => `  - ${n}`) };
}

function ecrireEntete(blocs: BlocEntete[], corps: string): string {
  const lignes = blocs.flatMap((b) => [`${b.cle}:${b.valeur === "" ? "" : ` ${b.valeur}`}`, ...b.suite]);
  return `---\n${lignes.join("\n")}\n---\n\n${corps.trim()}\n`;
}

function texteSkill(source: string): string | null {
  try {
    const texte = readFileSync(path.join(source, "SKILL.md"), "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    return texte || null;
  } catch {
    return null;
  }
}

/**
 * La copie de fiche qu'un agent appelé lit. L'outil Skill est retiré : il montrerait
 * le catalogue de l'agent qui a lancé la session (prouvé le 04/11/2026, Claude Code 2.1.306).
 * Les skills allumées pour lui et présentes dans cette session sont préchargées (`skills`).
 * Celles que la session a coupées sont écrites dans le corps : `skillOverrides` les
 * empêcherait d'être préchargées. La fiche d'origine n'est pas modifiée.
 */
export function ficheAgentAppele(contenu: string, skills: { nom: string; source: string }[], dansSession: (nom: string) => boolean): string {
  const { lignes, corps } = couperEntete(contenu);
  const retenues = skills.slice(0, MAX_SKILLS_APPELE);
  const precharge = retenues.filter((s) => dansSession(s.nom));
  const hors = retenues.filter((s) => !dansSession(s.nom));
  const tous = lignes?.length ? blocsEntete(lignes) : [];
  const outils = tous.find((b) => b.cle === "disallowedTools");
  const reste = tous.filter((b) => b.cle !== "skills" && b.cle !== "disallowedTools");
  const skillsBloc = blocListe("skills", precharge.map((s) => s.nom), NOM_SKILL);
  const outilsBloc = blocListe("disallowedTools", [...(outils ? nomsListe(outils, NOM_OUTIL) : []), "Skill"], NOM_OUTIL);
  const entete = [...reste, ...(skillsBloc ? [skillsBloc] : []), ...(outilsBloc ? [outilsBloc] : [])];
  const ajouts: string[] = [];
  for (const s of hors) {
    const texte = texteSkill(s.source);
    if (!texte) continue;
    const coupe = texte.length > MAX_TEXTE_SKILL;
    const corpsSkill = coupe ? `${texte.slice(0, MAX_TEXTE_SKILL)}\n\n[Coupée ici : lis la suite dans ${path.join(s.source, "SKILL.md")}.]` : texte;
    ajouts.push(`<competence nom="${s.nom}">\n${corpsSkill}\n</competence>`);
  }
  return ecrireEntete(entete, [corps.trim(), ...ajouts].filter(Boolean).join("\n\n"));
}

function ecrireFiches(dossier: string, fiches: { id: string; contenu: string }[]): void {
  const agents = path.join(dossier, "agents");
  oterSiLien(agents);
  mkdirSync(agents, { recursive: true });
  const gardes = new Set<string>();
  for (const fiche of fiches) {
    if (!ID_AGENT.test(fiche.id)) continue;
    const cible = path.join(agents, `${fiche.id}.md`);
    if (!dans(agents, cible)) continue;
    oterSiLien(cible);
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
  oterSiLien(racine);
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
  /** Choix des interrupteurs. Présent : la copie de chaque autre agent reçoit son catalogue. */
  choix?: SkillsParAgent | null;
  /** Dossier Claude lu pour lister les skills. Jamais le dossier préparé. */
  configClaude?: string | null;
  /** Projet de la session : ses skills de projet entrent dans le catalogue. */
  dossierProjet?: string | null;
  /**
   * Un compte Claude supplémentaire choisi pour la conversation (`claude-comptes/<id>`) : un dossier préparé à part
   * (`preparation-comptes/<id>/<agent>`), dont la connexion est un lien vers celle de ce compte. Son `.claude.json`
   * (profil du compte) ne se mêle pas à celui du compte des agents. Absent : le compte des agents.
   */
  compte?: { id: string; dossier: string } | null;
}

/**
 * Prépare le dossier de l'agent et le rend. null : pas de dossier d'app
 * (la session reste sur le poste, comme avant).
 */
export function preparerSessionClaude(session: SessionClaude): { dossier: string; skills: string[]; catalogue: string } | null {
  if (!session.userData) return null;
  const id = session.agent && ID_AGENT.test(session.agent) ? session.agent : "principal";
  const compte = session.compte && NOM_DOSSIER.test(session.compte.id) ? session.compte : null;
  const dossier = compte ? path.join(session.userData, "preparation-comptes", compte.id, id) : path.join(session.userData, "preparation", id);
  const poste = session.poste || path.join(session.home, ".claude");
  const catalogues = new Map<string, { nom: string; source: string }[]>();
  if (session.choix && session.configClaude) {
    for (const agent of session.idsActifs) {
      if (!ID_AGENT.test(agent) || agent === id) continue;
      catalogues.set(agent, filtreSkills(session.choix, agent, session.configClaude, session.dossierProjet ?? null).dossiers);
    }
  }
  const fiches: { id: string; contenu: string }[] = [];
  for (const agent of session.idsActifs) {
    if (!ID_AGENT.test(agent)) continue;
    try {
      const brut = readFileSync(path.join(session.dossierAgents, `${agent}.md`), "utf8");
      const skills = catalogues.get(agent);
      fiches.push({ id: agent, contenu: skills ? ficheAgentAppele(brut, skills, session.garder) : brut });
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
    identifiants: path.join(compte ? compte.dossier : poste, ".credentials.json"),
    projects: path.join(poste, "projects"),
    sessions: path.join(poste, "sessions"),
    plugins: path.join(poste, "plugins"),
    reglages: path.join(poste, "settings.json"),
    reglagesLocaux: path.join(poste, "settings.local.json"),
  });
  const catalogue = [...catalogues.entries()]
    .map(([agent, liste]) => `${agent}:${liste.map((s) => s.nom).sort((a, b) => a.localeCompare(b, "fr")).join(",")}`)
    .sort((a, b) => a.localeCompare(b, "fr"))
    .join("\n");
  return { dossier, skills: skills.map((s) => s.nom), catalogue };
}

export interface SessionCodex {
  userData: string;
  agent: string | null;
  /** Skills allumées pour cet agent (`filtreSkills(...).dossiers`). */
  dossiers: { nom: string; source: string }[];
  /** Dossier Codex du poste (`CODEX_HOME` ou `~/.codex`). On y lie la config et l'auth, jamais les skills. */
  codexPoste: string | null;
}

/**
 * Prépare le `CODEX_HOME` de cet agent : seulement ses skills allumées.
 * Ne modifie ni le poste, ni le dossier Codex d'origine.
 */
export function preparerSessionCodex(session: SessionCodex): { codexHome: string; home: string; skills: string[]; empreinte: string } {
  const id = session.agent && ID_AGENT.test(session.agent) ? session.agent : "principal";
  const codexHome = path.join(session.userData, "preparation-codex", id);
  const home = path.join(codexHome, "home");
  mkdirSync(home, { recursive: true });
  const skills = session.dossiers.filter((d) => {
    const base = path.basename(d.source);
    return NOM_DOSSIER.test(base) && existsSync(path.join(d.source, "SKILL.md"));
  });
  ecrireSkills(
    codexHome,
    skills.map((d) => ({ nom: d.nom, source: d.source })),
  );
  const poste = session.codexPoste ? path.resolve(session.codexPoste) : null;
  if (poste && poste !== path.resolve(codexHome) && !dans(codexHome, poste) && !dans(poste, codexHome)) {
    lier(path.join(poste, "config.toml"), path.join(codexHome, "config.toml"));
    lier(path.join(poste, "auth.json"), path.join(codexHome, "auth.json"));
  }
  const noms = skills.map((d) => path.basename(d.source)).sort((a, b) => a.localeCompare(b, "fr"));
  return { codexHome, home, skills: skills.map((d) => d.nom), empreinte: noms.join("\n") };
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
