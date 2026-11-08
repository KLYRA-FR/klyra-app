import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Les souvenirs de chaque agent, lus là où Claude Code les écrit, pour le graphe de la page Mémoire.
 * Lecture seule : rien n'est copié, déplacé ni modifié. Le graphe est recalculé à chaque lecture ;
 * supprimer ce module laisse les fichiers intacts. Un fichier par souvenir (frontmatter `name`,
 * `description`, `metadata.type`), MEMORY.md n'est qu'un sommaire.
 */

export type TypeSouvenir = "user" | "feedback" | "project" | "reference";
export interface SouvenirGraphe {
  /** Stable : l'agent et l'empreinte du chemin réel. */
  id: string;
  /** `name` du frontmatter, sinon le nom du fichier sans extension (cible des liens `[[…]]`). */
  nom: string;
  /** Nom du fichier sans `.md` (autre cible possible d'un lien). */
  fichier: string;
  description: string;
  type: TypeSouvenir | null;
  agent: string;
  /** Dernière modification du fichier (ISO). */
  date: string;
  chemin: string;
  prive: boolean;
  /** Projet de l'app quand le souvenir vit dans le dossier d'un projet. */
  projetId: string | null;
  liens: string[];
  remplace: string[];
}
export interface DossierSouvenirs { dossier: string; agent: string; projetId: string | null }
export interface LectureSouvenirs { souvenirs: SouvenirGraphe[]; dossiers: { chemin: string; agent: string; nombre: number }[]; tronque: boolean }
export interface RacinesSouvenirs {
  /** Dossier de l'app (userData sur le PC, `donnees` du serveur). */
  donnees: string;
  /** Configuration de Claude Code du poste (`CLAUDE_CONFIG_DIR` ou `~/.claude`). */
  configClaude: string;
  home: string;
  /** Dossiers des projets de l'app, gardés seulement s'ils sont sous `home`. */
  projets?: { id: string; dossier: string }[];
}

const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_PROJET = /^[a-zA-Z0-9_.:@-]{1,160}$/;
const FICHIERS_MAX = 5000;
const TAILLE_MAX = 512 * 1024;

function noms(dossier: string): string[] {
  try { return readdirSync(dossier); } catch { return []; }
}
function estDossier(chemin: string): boolean {
  try { return statSync(chemin).isDirectory(); } catch { return false; }
}
function reel(chemin: string): string | null {
  try { return realpathSync(chemin); } catch { return null; }
}
function sous(racine: string, chemin: string): boolean {
  return chemin === racine || chemin.startsWith(racine + path.sep);
}

/** Agent d'une mémoire automatique : `…-atelier-<agent>` est l'atelier de cet agent, le reste est à l'assistant. */
export function agentDuProjetClaude(nom: string): string {
  const m = /-atelier-([a-z0-9][a-z0-9-]{0,63})$/.exec(nom);
  return m ? m[1] : "principal";
}

/** Tous les dossiers de mémoire connus, sans doublon (chemin réel), avec l'agent auteur. */
export function dossiersSouvenirs(r: RacinesSouvenirs): DossierSouvenirs[] {
  const vus = new Map<string, DossierSouvenirs>();
  const ajouter = (dossier: string, agent: string, projetId: string | null = null) => {
    if (!ID_AGENT.test(agent) || !estDossier(dossier)) return;
    const vrai = reel(dossier);
    if (vrai && !vus.has(vrai)) vus.set(vrai, { dossier: vrai, agent, projetId });
  };
  const agentMemory = (base: string, projetId: string | null = null) => {
    for (const sousDossier of ["agent-memory", "agent-memory-local"]) {
      const racine = path.join(base, sousDossier);
      for (const agent of noms(racine)) ajouter(path.join(racine, agent), agent, projetId);
    }
  };
  const projetsClaude = (config: string, agentFixe: string | null) => {
    const racine = path.join(config, "projects");
    for (const nom of noms(racine)) ajouter(path.join(racine, nom, "memory"), agentFixe ?? agentDuProjetClaude(nom));
  };
  // Configuration du poste : mémoire « user » des agents et mémoire automatique des sessions.
  agentMemory(r.configClaude);
  projetsClaude(r.configClaude, null);
  // Dossier que Claude Code lit à la place de ~/.claude, un par agent (et par compte supplémentaire).
  const preparation = path.join(r.donnees, "preparation");
  for (const agent of noms(preparation)) {
    if (!ID_AGENT.test(agent)) continue;
    agentMemory(path.join(preparation, agent));
    projetsClaude(path.join(preparation, agent), agent);
  }
  const comptes = path.join(r.donnees, "preparation-comptes");
  for (const compte of noms(comptes)) {
    for (const agent of noms(path.join(comptes, compte))) {
      if (!ID_AGENT.test(agent)) continue;
      agentMemory(path.join(comptes, compte, agent));
      projetsClaude(path.join(comptes, compte, agent), agent);
    }
  }
  // Ateliers des agents (VPS : ~/atelier, PC : ~/.klyra/atelier) : mémoire « project » de chaque agent.
  for (const atelier of [path.join(r.home, "atelier"), path.join(r.home, ".klyra", "atelier")]) {
    for (const nom of noms(atelier)) agentMemory(path.join(atelier, nom, ".claude"));
  }
  // Dossiers des projets de l'app, seulement sous le dossier de la personne.
  const home = reel(r.home);
  for (const p of r.projets ?? []) {
    if (!home || !ID_PROJET.test(p.id) || typeof p.dossier !== "string" || !p.dossier) continue;
    const vrai = reel(p.dossier);
    if (vrai && sous(home, vrai)) agentMemory(path.join(vrai, ".claude"), p.id);
  }
  return [...vus.values()];
}

/** Frontmatter simple (clé: valeur, un niveau d'imbrication, listes `- x` ou `[a, b]`). Pas de YAML complet. */
export function lireEnTete(texte: string): { champs: Record<string, string | string[]>; corps: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(texte);
  if (!m) return { champs: {}, corps: texte };
  const champs: Record<string, string | string[]> = {};
  let parent = "", derniere = "";
  for (const ligne of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(ligne);
    if (item && derniere) {
      const avant = champs[derniere];
      champs[derniere] = [...(Array.isArray(avant) ? avant : avant ? [avant] : []), nettoyer(item[1])];
      continue;
    }
    const kv = /^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(ligne);
    if (!kv) continue;
    const [, indent, cle, brut] = kv;
    if (!indent) parent = brut.trim() ? "" : cle;
    const nom = indent && parent ? `${parent}.${cle}` : cle;
    derniere = nom;
    const v = brut.trim();
    if (!v) continue;
    champs[nom] = v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1).split(",").map(nettoyer).filter(Boolean) : nettoyer(v);
  }
  return { champs, corps: texte.slice(m[0].length) };
}
function nettoyer(v: string): string {
  return v.trim().replace(/^["']|["']$/g, "").trim();
}
function champ(c: Record<string, string | string[]>, ...cles: string[]): string | string[] | undefined {
  for (const k of cles) if (c[k] !== undefined) return c[k];
  return undefined;
}
function texteDe(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join(", ") : v ?? "";
}
function listeDe(v: string | string[] | undefined): string[] {
  const liste = Array.isArray(v) ? v : v ? [v] : [];
  return liste.map((x) => x.replace(/^\[\[|\]\]$/g, "").trim()).filter(Boolean);
}
const VRAI = new Set(["oui", "true", "yes", "1", "vrai"]);

/** Cibles des liens `[[nom]]` ou `[[nom|libellé]]` du corps. */
export function liensWiki(corps: string): string[] {
  const out = new Set<string>();
  for (const m of corps.matchAll(/\[\[([^\]\n|#]{1,160})(?:[#|][^\]\n]*)?\]\]/g)) out.add(m[1].trim());
  return [...out];
}

export function lireSouvenir(chemin: string, d: DossierSouvenirs, texte: string, mtime: Date): SouvenirGraphe {
  const { champs, corps } = lireEnTete(texte);
  const type = texteDe(champ(champs, "metadata.type", "type"));
  const nom = texteDe(champ(champs, "name")) || path.basename(chemin).replace(/\.md$/i, "");
  return {
    id: `souvenir:${d.agent}:${createHash("sha256").update(chemin).digest("hex").slice(0, 16)}`,
    nom: nom.slice(0, 160),
    fichier: path.basename(chemin).replace(/\.md$/i, ""),
    description: texteDe(champ(champs, "description")).replace(/\s+/g, " ").slice(0, 280),
    type: (["user", "feedback", "project", "reference"] as const).find((t) => t === type) ?? null,
    agent: d.agent,
    date: mtime.toISOString(),
    chemin,
    prive: VRAI.has(texteDe(champ(champs, "metadata.prive", "prive", "metadata.private", "private")).toLowerCase()),
    projetId: d.projetId,
    liens: liensWiki(corps),
    remplace: listeDe(champ(champs, "metadata.remplace", "remplace", "metadata.replaces", "replaces")),
  };
}

/** Lit chaque souvenir (fichiers `.md` du dossier et de ses sous-dossiers, hors MEMORY.md). */
export function lireSouvenirsGraphe(r: RacinesSouvenirs): LectureSouvenirs {
  const souvenirs: SouvenirGraphe[] = [], dossiers: LectureSouvenirs["dossiers"] = [];
  let tronque = false;
  for (const d of dossiersSouvenirs(r)) {
    let nombre = 0;
    const visiter = (dossier: string, profondeur: number) => {
      for (const nom of noms(dossier).sort()) {
        if (souvenirs.length >= FICHIERS_MAX) { tronque = true; return; }
        if (nom.startsWith(".")) continue;
        const chemin = path.join(dossier, nom);
        let st;
        try { st = statSync(chemin); } catch { continue; }
        if (st.isDirectory()) { if (profondeur < 3) visiter(chemin, profondeur + 1); continue; }
        if (!st.isFile() || !/\.md$/i.test(nom) || /^MEMORY\.md$/i.test(nom) || st.size > TAILLE_MAX) continue;
        const vrai = reel(chemin);
        if (!vrai || !sous(d.dossier, vrai)) continue;
        try {
          souvenirs.push(lireSouvenir(vrai, d, readFileSync(vrai, "utf8"), st.mtime));
          nombre++;
        } catch { /* illisible : on n'invente pas son contenu */ }
      }
    };
    visiter(d.dossier, 0);
    if (nombre) dossiers.push({ chemin: d.dossier, agent: d.agent, nombre });
  }
  return { souvenirs, dossiers, tronque };
}

/* ─── Recherche dans le contenu (phase 2) ──────────────────────────────── */

export interface TrouveContenu { chemin: string; extrait: string; occurrences: number }
const TEXTES = /\.(md|markdown|txt|csv|json|html?|log)$/i;
const cacheTextes = new Map<string, { mtime: number; texte: string; plat: string }>();
const CACHE_MAX = 4000;

export function aplatir(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
/** Les mots d'une recherche, sans accent ni casse ; tous doivent être présents. */
export function motsRecherche(requete: unknown): string[] {
  if (typeof requete !== "string") return [];
  return [...new Set(aplatir(requete.slice(0, 300)).split(/[^a-z0-9_-]+/).filter((m) => m.length >= 2))].slice(0, 12);
}
function lireTexte(chemin: string): { texte: string; plat: string } | null {
  let st;
  try { st = statSync(chemin); } catch { cacheTextes.delete(chemin); return null; }
  if (!st.isFile() || st.size > TAILLE_MAX) return null;
  const avant = cacheTextes.get(chemin);
  if (avant && avant.mtime === st.mtimeMs) return avant;
  try {
    const texte = readFileSync(chemin, "utf8");
    if (texte.includes("\0")) return null;
    const entree = { mtime: st.mtimeMs, texte, plat: aplatir(texte) };
    if (cacheTextes.size >= CACHE_MAX) cacheTextes.delete(cacheTextes.keys().next().value as string);
    cacheTextes.set(chemin, entree);
    return entree;
  } catch { return null; }
}
/** Un extrait d'une ligne autour du premier mot trouvé (sans le frontmatter). */
function extraitAutour(texte: string, plat: string, mot: string): string {
  const debutCorps = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(texte)?.[0].length ?? 0;
  let i = plat.indexOf(mot, debutCorps);
  if (i < 0) i = plat.indexOf(mot);
  const debut = Math.max(0, i - 60), fin = Math.min(texte.length, i + mot.length + 100);
  return `${debut > 0 ? "…" : ""}${texte.slice(debut, fin).replace(/\s+/g, " ").trim()}${fin < texte.length ? "…" : ""}`;
}

/**
 * Cherche les mots dans le contenu des souvenirs et des fichiers texte publiés. Les fichiers sont relus seulement
 * s'ils ont changé (cache en mémoire du processus, jamais sur le disque). `fichiers` : chemins publiés connus,
 * gardés seulement sous `home`.
 */
export function chercherContenu(r: RacinesSouvenirs, requete: unknown, fichiers: unknown = [], limite = 200): { trouves: TrouveContenu[]; mots: string[] } {
  const mots = motsRecherche(requete);
  if (!mots.length) return { trouves: [], mots };
  const home = reel(r.home);
  const chemins = new Set(lireSouvenirsGraphe(r).souvenirs.map((s) => s.chemin));
  for (const f of Array.isArray(fichiers) ? fichiers.slice(0, 2000) : []) {
    if (typeof f !== "string" || !TEXTES.test(f)) continue;
    const vrai = reel(f);
    if (vrai && home && sous(home, vrai)) chemins.add(vrai);
  }
  const trouves: TrouveContenu[] = [];
  for (const chemin of chemins) {
    const t = lireTexte(chemin);
    if (!t || !mots.every((m) => t.plat.includes(m))) continue;
    let occurrences = 0;
    for (const m of mots) for (let i = t.plat.indexOf(m); i >= 0 && occurrences < 999; i = t.plat.indexOf(m, i + m.length)) occurrences++;
    trouves.push({ chemin, extrait: extraitAutour(t.texte, t.plat, mots[0]), occurrences });
  }
  trouves.sort((a, b) => b.occurrences - a.occurrences);
  return { trouves: trouves.slice(0, limite), mots };
}
