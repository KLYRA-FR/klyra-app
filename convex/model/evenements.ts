/** Règles du calendrier commun, sans accès à la base (cf. `docs/CONVEX-PLAN.md`, § 3). */

export const TITRE_MAX = 200;
export const NOTES_MAX = 4_000;
export const PAGE_MAX = 300;
export const FENETRE_MAX_JOURS = 120;

const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

export const CLE_WEEKLY = "weekly-klyra";
export const WEEKLY = {
  titre: "Weekly KLYRA",
  notes: "Réunion de toute l’équipe",
  jour: "2026-10-27",
  debut: "09:00",
  fin: "09:30",
  debutMs: Date.UTC(2026, 9, 27, 9, 0),
} as const;

export interface SaisieEvenement {
  titre: string;
  notes: string;
  jour: string;
  debut: string | null;
  fin: string | null;
  jourEntier: boolean;
  repetition: "aucune" | "semaine";
  debutMs: number;
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

export function titreValide(titre: string): string | null {
  const propre = titre.trim().replace(/\s+/g, " ");
  return propre.length >= 1 && propre.length <= TITRE_MAX ? propre : null;
}

export function notesValides(notes: string): string | null {
  const propre = notes.trim();
  return propre.length <= NOTES_MAX ? propre : null;
}

/** null si la saisie est incohérente. L'instant vient de l'ordinateur : le serveur ne le recalcule pas. */
export function saisieValide(saisie: SaisieEvenement): SaisieEvenement | null {
  const titre = titreValide(saisie.titre);
  const notes = notesValides(saisie.notes);
  if (titre === null || notes === null || !estJour(saisie.jour)) return null;
  if (!Number.isFinite(saisie.debutMs) || saisie.debutMs < MIN_MS || saisie.debutMs > MAX_MS) return null;
  if (saisie.jourEntier) {
    if (saisie.debut !== null || saisie.fin !== null) return null;
  } else if (saisie.debut === null || saisie.fin === null || !HEURE.test(saisie.debut) || !HEURE.test(saisie.fin) || saisie.fin <= saisie.debut) {
    return null;
  }
  return {
    titre,
    notes,
    jour: saisie.jour,
    debut: saisie.debut,
    fin: saisie.fin,
    jourEntier: saisie.jourEntier,
    repetition: saisie.repetition,
    debutMs: saisie.debutMs,
  };
}

export function fenetreValide(debut: string, fin: string): boolean {
  if (!estJour(debut) || !estJour(fin) || debut >= fin) return false;
  const [da, dm, dj] = debut.split("-").map(Number);
  const [fa, fm, fj] = fin.split("-").map(Number);
  const ecart = (Date.UTC(fa, fm - 1, fj) - Date.UTC(da, dm - 1, dj)) / 86_400_000;
  return ecart <= FENETRE_MAX_JOURS;
}

function utc(jour: string): number {
  const [annee, mois, jourMois] = jour.split("-").map(Number);
  return Date.UTC(annee, mois - 1, jourMois);
}

export function ajouterJours(jour: string, jours: number): string {
  return new Date(utc(jour) + jours * 86_400_000).toISOString().slice(0, 10);
}

/** Les jours de l'événement dans [debut, fin). Une répétition hebdomadaire part du jour d'origine. */
export function joursDans(origine: string, repetition: "aucune" | "semaine", debut: string, fin: string): string[] {
  if (repetition === "aucune") return origine >= debut && origine < fin ? [origine] : [];
  const voulu = new Date(utc(origine)).getUTCDay();
  let curseur = origine < debut ? debut : origine;
  const ecart = (voulu - new Date(utc(curseur)).getUTCDay() + 7) % 7;
  curseur = ajouterJours(curseur, ecart);
  if (curseur < origine) curseur = ajouterJours(curseur, 7);
  const jours: string[] = [];
  for (let i = 0; i < FENETRE_MAX_JOURS && curseur < fin; i += 1) {
    jours.push(curseur);
    curseur = ajouterJours(curseur, 7);
  }
  return jours;
}
