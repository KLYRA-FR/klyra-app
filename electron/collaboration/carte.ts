/**
 * La carte de passation : un seul commentaire par Issue, réécrit à chaque étape. Tout ce qu'il faut pour
 * reprendre le travail, depuis n'importe quel poste, sans la conversation d'origine. Module pur.
 * Les données sont en JSON dans un commentaire HTML (lues par le code), et répétées en clair (lues par
 * les personnes). Voir `docs/consignes/collaboration.md`.
 */

const MARQUEUR = /<!-- klyra:carte (\{[\s\S]*?\}) -->/;

/** Sans commit ni mise à jour de la carte pendant ce temps, un autre poste peut reprendre. */
export const BAIL_MS = 2 * 60 * 60_000;

export type StatutCarte = "en-cours" | "bloque" | "a-revoir" | "termine";
export type VerdictRevue = "ok" | "corrections";

export interface Carte {
  statut: StatutCarte;
  /** Le compte GitHub de la personne responsable, pas celui de l'agent. */
  responsable: string;
  agent: string;
  /** Fin du bail, en ISO. */
  bail: string;
  /** Monte de un à chaque reprise par un autre poste. */
  generation: number;
  /** Le commit sur lequel l'analyse reste valable, et les chemins qu'elle couvre. */
  analyseSha: string | null;
  chemins: string[];
  resume: string;
  decisions: string[];
  verifie: string;
  nonVerifie: string;
  prochainGeste: string;
  /** Corrections déjà tentées après une CI rouge. */
  essaisCi: number;
  /** Tours de review déjà faits, et le commit du dernier. */
  toursRevue: number;
  revueSha: string | null;
  revue: VerdictRevue | null;
  /** Le commit pour lequel la fusion a déjà été demandée : on ne redemande pas. */
  fusionDemandeeSha: string | null;
  /** Jetons consommés par étape. */
  consommation: Record<string, number>;
}

export function nouvelleCarte(c: { responsable: string; agent: string; maintenant: number; generation?: number }): Carte {
  return {
    statut: "en-cours",
    responsable: c.responsable,
    agent: c.agent,
    bail: new Date(c.maintenant + BAIL_MS).toISOString(),
    generation: c.generation ?? 0,
    analyseSha: null,
    chemins: [],
    resume: "",
    decisions: [],
    verifie: "",
    nonVerifie: "",
    prochainGeste: "",
    essaisCi: 0,
    toursRevue: 0,
    revueSha: null,
    revue: null,
    fusionDemandeeSha: null,
    consommation: {},
  };
}

export function prolongerBail(carte: Carte, maintenant: number): Carte {
  return { ...carte, bail: new Date(maintenant + BAIL_MS).toISOString() };
}

export function bailTermine(carte: Carte, maintenant: number): boolean {
  const fin = Date.parse(carte.bail);
  return Number.isNaN(fin) || fin <= maintenant;
}

/** Clés, jetons et mots de passe reconnaissables : mieux vaut un faux positif qu'une fuite. */
const SECRETS: RegExp[] = [
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
  /\b(?:api[_-]?key|access[_-]?token|secret|password|passwd|mot de passe)\s*[:=]\s*["']?[^\s"']{8,}/i,
];

/** Chemins d'un ordinateur : ils n'ont rien à faire sur GitHub. */
const CHEMIN_PERSONNEL = /(?<![\w.:/\\-])(?:~\/|\/(?:Users|home|root)\/|[A-Za-z]:\\Users\\)[^\s`"'()<>\]|,;]+/;

/** Pourquoi ce texte ne doit pas partir sur GitHub, ou null. */
export function motifRefus(texte: string): "secret" | "chemin_personnel" | null {
  if (SECRETS.some((m) => m.test(texte))) return "secret";
  if (CHEMIN_PERSONNEL.test(texte)) return "chemin_personnel";
  return null;
}

/** Le texte lisible ne peut ni ouvrir ni fermer un commentaire : pas de fausse carte dans un résumé. */
function clair(texte: string): string {
  return texte.replace(/<!--/g, "‹!--").replace(/-->/g, "--›");
}

function liste(valeurs: string[]): string {
  return valeurs.length ? valeurs.map(clair).join(" · ") : "—";
}

/** Le commentaire tel qu'il part sur GitHub. `-->` ne peut pas apparaître dans le JSON. */
export function ecrireCarte(carte: Carte): string {
  const donnees = JSON.stringify(carte).replace(/--/g, "-\\u002d");
  const conso = Object.entries(carte.consommation).map(([etape, jetons]) => `${etape} ${jetons}`);
  return [
    `<!-- klyra:carte ${donnees} -->`,
    `**Statut :** ${carte.statut} · **Responsable :** @${clair(carte.responsable)} · **Agent :** ${clair(carte.agent)} · **Bail :** ${clair(carte.bail)}`,
    `**Analyse valable sur :** ${clair(carte.analyseSha ?? "—")} · **Chemins :** ${liste(carte.chemins)}`,
    `**Résumé :** ${clair(carte.resume) || "—"}`,
    `**Décisions :** ${liste(carte.decisions)}`,
    `**Vérifié :** ${clair(carte.verifie) || "—"} · **Non vérifié :** ${clair(carte.nonVerifie) || "—"}`,
    `**Prochain geste :** ${clair(carte.prochainGeste) || "—"}`,
    `**Consommation :** ${liste(conso)}`,
  ].join("\n\n");
}

const estTexte = (v: unknown): v is string => typeof v === "string";
const estNombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const estTextes = (v: unknown): v is string[] => Array.isArray(v) && v.every(estTexte);
const texteOuNul = (v: unknown): v is string | null => v === null || estTexte(v);
const STATUTS: readonly unknown[] = ["en-cours", "bloque", "a-revoir", "termine"];

/** La carte d'un commentaire, ou null : un texte mal formé ne vaut jamais comme état. */
export function lireCarte(corps: string): Carte | null {
  const trouve = MARQUEUR.exec(corps);
  if (trouve === null) return null;
  let brut: unknown;
  try {
    brut = JSON.parse(trouve[1]);
  } catch {
    return null;
  }
  if (typeof brut !== "object" || brut === null) return null;
  const c = brut as Record<string, unknown>;
  const consommation = c.consommation;
  const valide =
    STATUTS.includes(c.statut) &&
    estTexte(c.responsable) &&
    estTexte(c.agent) &&
    estTexte(c.bail) &&
    estNombre(c.generation) &&
    texteOuNul(c.analyseSha) &&
    estTextes(c.chemins) &&
    estTexte(c.resume) &&
    estTextes(c.decisions) &&
    estTexte(c.verifie) &&
    estTexte(c.nonVerifie) &&
    estTexte(c.prochainGeste) &&
    estNombre(c.essaisCi) &&
    estNombre(c.toursRevue) &&
    texteOuNul(c.revueSha) &&
    (c.revue === null || c.revue === "ok" || c.revue === "corrections") &&
    texteOuNul(c.fusionDemandeeSha) &&
    typeof consommation === "object" &&
    consommation !== null &&
    Object.values(consommation).every(estNombre);
  return valide ? (brut as Carte) : null;
}

export function estCarte(corps: string): boolean {
  return MARQUEUR.test(corps);
}
