import { getField, parseAgentFile, serializeAgentFile, splitDescription, type Frontmatter } from "../../src/lib/agent-file";

/**
 * Une définition d'agent de la Bibliothèque KLYRA : la fiche seule. Jamais la mémoire, l'historique,
 * les conversations, les clés, les sessions ni les chemins de l'auteur.
 *
 * Ces règles servent deux fois : l'app montre l'aperçu exact de ce qui part avant de publier
 * (`preparerPublication`), et le serveur refuse ce qui ne les suit pas (`verifierDefinition`).
 */

/** Les seules clés d'en-tête partagées. Les autres (mémoire, hooks, serveurs MCP…) restent sur l'ordinateur. */
export const CLES_PARTAGEES = ["name", "displayName", "description", "model", "tools", "disallowedTools", "effort"] as const;

export const LIMITES = { contenu: 60_000, nom: 60, role: 40, description: 1_200, dependances: 20, libelle: 80 } as const;

/** Un emplacement propre à l'ordinateur de l'auteur, remplacé par `{{chemin:cle}}` et configuré par chacun. */
export interface Dependance {
  cle: string;
  libelle: string;
}

export interface CheminTrouve {
  chemin: string;
  ligne: number;
  cle: string;
}

export interface SecretTrouve {
  ligne: number;
  extrait: string;
}

export interface Publication {
  /** La fiche telle qu'elle sera partagée, mot pour mot. */
  contenu: string;
  slug: string;
  nom: string;
  description: string;
  capacites: string[];
  modele: string | null;
  dependances: Dependance[];
  /** Clés d'en-tête retirées : elles ne partent pas. */
  nonPartages: string[];
  chemins: CheminTrouve[];
  /** Un secret bloque la publication : à retirer de la fiche d'abord. */
  secrets: SecretTrouve[];
}

export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CLE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const ESPACE_RESERVE = /\{\{chemin:([a-z0-9][a-z0-9-]{0,39})\}\}/g;

/** Clés, jetons et mots de passe reconnaissables. Volontairement large : mieux vaut un faux positif qu'une fuite. */
const SECRETS: RegExp[] = [
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
  /\b(?:api[_-]?key|access[_-]?token|secret|password|passwd|mot de passe)\s*[:=]\s*["']?[^\s"']{8,}/i,
];

/** Chemins absolus d'un ordinateur (Mac, Linux, Windows) ou du dossier personnel. Les adresses web n'en sont pas. */
const CHEMIN =
  /(?<![\w.:/\\-])(?:~\/[^\s`"'()<>\]|,;]+|\/(?:Users|home|var|opt|srv|mnt|Volumes|private|tmp|etc|root|data)\/[^\s`"'()<>\]|,;]+|[A-Za-z]:\\[^\s`"'()<>\]|,;]+)/g;

function lignes(texte: string): string[] {
  return texte.replace(/\r\n/g, "\n").split("\n");
}

export function trouverSecrets(texte: string): SecretTrouve[] {
  const trouves: SecretTrouve[] = [];
  lignes(texte).forEach((l, i) => {
    for (const motif of SECRETS) {
      const m = l.match(motif);
      if (m) {
        trouves.push({ ligne: i + 1, extrait: `${m[0].slice(0, 6)}…` });
        break;
      }
    }
  });
  return trouves;
}

/** Une clé lisible tirée du dernier segment du chemin : `/Users/x/Clients/DIGITAL-OS` → `digital-os`. */
function cleDe(chemin: string, prises: Set<string>): string {
  const segments = chemin.replace(/[\\/.:]+$/, "").split(/[\\/]/).filter(Boolean);
  const base =
    (segments.at(-1) ?? "dossier")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,5}$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "dossier";
  let cle = CLE.test(base) ? base : "dossier";
  for (let n = 2; prises.has(cle); n++) cle = `${base.slice(0, 30)}-${n}`;
  prises.add(cle);
  return cle;
}

export function trouverChemins(texte: string): CheminTrouve[] {
  const trouves: CheminTrouve[] = [];
  const parChemin = new Map<string, string>();
  const prises = new Set<string>();
  lignes(texte).forEach((l, i) => {
    for (const m of l.matchAll(CHEMIN)) {
      const chemin = m[0].replace(/[.)]+$/, "");
      // Les dossiers de Claude Code et de l'app sont les mêmes chez chacun.
      if (/^~\/\.(?:claude|klyra)(?:\/|$)/.test(chemin)) continue;
      if (!parChemin.has(chemin)) parChemin.set(chemin, cleDe(chemin, prises));
      trouves.push({ chemin, ligne: i + 1, cle: parChemin.get(chemin)! });
    }
  });
  return trouves;
}

function enTetePartage(fm: Frontmatter): { entete: Frontmatter; retirees: string[] } {
  const garder = new Set<string>(CLES_PARTAGEES);
  return {
    entete: { entries: fm.entries.filter(([k]) => garder.has(k)) },
    retirees: fm.entries.map(([k]) => k).filter((k) => !garder.has(k)),
  };
}

/**
 * Ce qui partirait si l'on publiait cette fiche : en-tête réduit aux clés partagées, chemins
 * personnels remplacés par une dépendance à configurer, secrets signalés (la publication est alors refusée).
 */
export function preparerPublication(contenuLocal: string, libelles: Record<string, string> = {}): Publication {
  const { frontmatter, body } = parseAgentFile(contenuLocal);
  const { entete, retirees } = enTetePartage(frontmatter);
  const brut = serializeAgentFile({ frontmatter: entete, body });
  const chemins = trouverChemins(brut);
  let contenu = brut;
  // Les plus longs d'abord : un chemin qui en contient un autre est remplacé en entier.
  const uniques = [...new Map(chemins.map((c) => [c.chemin, c.cle])).entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [chemin, cle] of uniques) contenu = contenu.split(chemin).join(`{{chemin:${cle}}}`);
  const description = getField(frontmatter, "description") ?? "";
  const slug = getField(frontmatter, "name") ?? "";
  return {
    contenu,
    slug,
    nom: getField(frontmatter, "displayName") || slug,
    description,
    capacites: splitDescription(description).skills,
    modele: getField(frontmatter, "model") || null,
    dependances: uniques.map(([, cle]) => ({ cle, libelle: (libelles[cle] ?? "").trim() || `Dossier « ${cle} »` })),
    nonPartages: retirees,
    chemins,
    secrets: trouverSecrets(contenuLocal),
  };
}

export type RefusDefinition =
  | "fiche_invalide"
  | "nom_invalide"
  | "trop_long"
  | "cle_non_partagee"
  | "secret_detecte"
  | "chemin_personnel"
  | "dependance_invalide";

/** Le contrôle du serveur : la fiche reçue doit être exactement une publication propre. */
export function verifierDefinition(entree: { contenu: string; role: string; dependances: Dependance[] }):
  | { ok: true; slug: string; nom: string; description: string; capacites: string[]; modele: string | null }
  | { ok: false; refus: RefusDefinition } {
  const { contenu, role, dependances } = entree;
  if (contenu.length > LIMITES.contenu || role.length > LIMITES.role) return { ok: false, refus: "trop_long" };
  const { frontmatter, body } = parseAgentFile(contenu);
  if (!frontmatter.entries.length || !body.trim()) return { ok: false, refus: "fiche_invalide" };
  if (enTetePartage(frontmatter).retirees.length) return { ok: false, refus: "cle_non_partagee" };
  const slug = getField(frontmatter, "name") ?? "";
  const nom = (getField(frontmatter, "displayName") || slug).trim();
  const description = getField(frontmatter, "description") ?? "";
  if (!SLUG.test(slug) || !nom || nom.length > LIMITES.nom) return { ok: false, refus: "nom_invalide" };
  if (description.length > LIMITES.description) return { ok: false, refus: "trop_long" };
  if (trouverSecrets(contenu).length) return { ok: false, refus: "secret_detecte" };
  if (trouverChemins(contenu).length) return { ok: false, refus: "chemin_personnel" };
  const cites = new Set([...contenu.matchAll(ESPACE_RESERVE)].map((m) => m[1]));
  const declarees = new Set(dependances.map((d) => d.cle));
  if (
    dependances.length > LIMITES.dependances ||
    declarees.size !== dependances.length ||
    dependances.some((d) => !CLE.test(d.cle) || !d.libelle.trim() || d.libelle.length > LIMITES.libelle || !cites.has(d.cle)) ||
    [...cites].some((c) => !declarees.has(c))
  ) {
    return { ok: false, refus: "dependance_invalide" };
  }
  return { ok: true, slug, nom, description, capacites: splitDescription(description).skills, modele: getField(frontmatter, "model") || null };
}

/**
 * La fiche locale d'un agent reçu : chaque `{{chemin:cle}}` remplacé par le dossier choisi sur cet
 * ordinateur. Une dépendance sans valeur reste écrite telle quelle et est rendue dans `manquantes` :
 * l'agent n'est pas annoncé prêt.
 */
export function appliquerDependances(contenu: string, valeurs: Record<string, string>): { contenu: string; manquantes: string[] } {
  const manquantes = new Set<string>();
  const sortie = contenu.replace(ESPACE_RESERVE, (tout, cle: string) => {
    const valeur = valeurs[cle]?.trim();
    if (!valeur) {
      manquantes.add(cle);
      return tout;
    }
    return valeur;
  });
  return { contenu: sortie, manquantes: [...manquantes] };
}

/** Les dépendances encore à configurer dans une fiche locale. */
export function dependancesManquantes(contenu: string): string[] {
  return [...new Set([...contenu.matchAll(ESPACE_RESERVE)].map((m) => m[1]))];
}

/** La fiche locale avec un autre identifiant (collision de nom) : seul `name` change. */
export function avecIdentifiant(contenu: string, id: string): string {
  const { frontmatter, body } = parseAgentFile(contenu);
  const entries = frontmatter.entries.map(([k, v]): [string, string] => [k, k === "name" ? id : v]);
  return serializeAgentFile({ frontmatter: { entries }, body });
}

/** Un identifiant libre à partir de celui proposé : `dev`, puis `dev-2`, `dev-3`… */
export function identifiantLibre(propose: string, pris: (id: string) => boolean): string {
  const base = SLUG.test(propose) ? propose.slice(0, 60) : "agent";
  if (!pris(base)) return base;
  for (let n = 2; n < 1000; n++) if (!pris(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`;
}
