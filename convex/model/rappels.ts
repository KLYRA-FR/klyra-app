/** Règles des rappels partagés, sans accès à la base (cf. `docs/CONVEX-PLAN.md`, § 2). */

export const TITRE_MAX = 200;
export const NOTES_MAX = 4_000;
export const LISTE_MAX = 80;
export const LOT_MAX = 100;
export const PAGE_MAX = 300;

const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LISTE = /^[A-Za-z0-9_-]{1,80}$/;
const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

export interface Echeance {
  jour: string | null;
  heure: string | null;
  fin: string | null;
  /** L'instant où le rappel passe en retard. null : pas de date. */
  echeance: number | null;
  jourEntier: boolean;
}

export interface SaisieEcheance {
  jour: string | null;
  heure: string | null;
  fin: string | null;
  echeance: number | null;
}

function estJour(valeur: string): boolean {
  const m = JOUR.exec(valeur);
  if (!m) return false;
  const annee = Number(m[1]);
  const mois = Number(m[2]);
  const jour = Number(m[3]);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  return date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour;
}

/** null si la saisie est incohérente. L'instant vient de l'ordinateur (son fuseau) : le serveur ne le recalcule pas. */
export function echeanceValide(saisie: SaisieEcheance): Echeance | null {
  const { jour, heure, fin, echeance } = saisie;
  if (jour === null) {
    return heure === null && fin === null && echeance === null ? { jour, heure, fin, echeance, jourEntier: false } : null;
  }
  if (!estJour(jour)) return null;
  if (heure !== null && !HEURE.test(heure)) return null;
  if (fin !== null && (!estJour(fin) || fin <= jour)) return null;
  if (typeof echeance !== "number" || !Number.isFinite(echeance) || echeance < MIN_MS || echeance > MAX_MS) return null;
  return { jour, heure, fin, echeance, jourEntier: heure === null };
}

export function titreValide(titre: string): string | null {
  const propre = titre.trim().replace(/\s+/g, " ");
  return propre.length >= 1 && propre.length <= TITRE_MAX ? propre : null;
}

/** Les notes gardent leurs retours à la ligne. null : trop longues. */
export function notesValides(notes: string): string | null {
  const propre = notes.trim();
  return propre.length <= NOTES_MAX ? propre : null;
}

/** null : pas de catégorie. false : refusée. */
export function listeValide(liste: string | null): string | null | false {
  if (liste === null) return null;
  return LISTE.test(liste) && liste.length <= LISTE_MAX ? liste : false;
}

export function origineValide(origine: string): string | null {
  const propre = origine.trim();
  return LISTE.test(propre) ? propre : null;
}

/** « Samedi 31 octobre 2026, 14:00 », à partir du jour écrit, sans le fuseau du serveur. */
export function libelleEcheance(jour: string | null, heure: string | null): string {
  if (jour === null) return "sans échéance";
  const [annee, mois, jourMois] = jour.split("-").map(Number);
  const libelle = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(annee, (mois ?? 1) - 1, jourMois ?? 1)));
  const jourEcrit = libelle.charAt(0).toUpperCase() + libelle.slice(1);
  return heure ? `${jourEcrit}, ${heure}` : jourEcrit;
}
