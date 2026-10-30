import type { Tache } from "@/types/domain";

/** Dates du calendrier et des tâches, en heure locale. */

/** « 2026-10-22 » pour une date locale. */
export function cleJour(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const j = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${j}`;
}

/** « 2026-10-22 » → Date locale à minuit. */
export function depuisCle(cle: string): Date {
  const [a, m, j] = cle.split("-").map(Number);
  return new Date(a, (m ?? 1) - 1, j ?? 1);
}

export const aujourdhui = () => cleJour(new Date());

/** Les 42 jours (6 semaines, lundi d'abord) affichés pour un mois. */
export function grilleMois(annee: number, mois: number): Date[] {
  const premier = new Date(annee, mois, 1);
  const decalage = (premier.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(annee, mois, 1 - decalage + i));
}

const jourLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const jourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });

const capitaliser = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « Mercredi 22 octobre » */
export function libelleJour(cle: string): string {
  return capitaliser(jourLong.format(depuisCle(cle)));
}

/** « Aujourd'hui », « Demain », « Hier », sinon « Ven. 24 oct. », avec l'heure si elle est donnée. */
export function libelleEcheance(cle: string, heure: string | null): string {
  const diff = Math.round((depuisCle(cle).getTime() - depuisCle(aujourdhui()).getTime()) / 86_400_000);
  const jour = diff === 0 ? "Aujourd’hui" : diff === 1 ? "Demain" : diff === -1 ? "Hier" : capitaliser(jourCourt.format(depuisCle(cle)));
  return heure ? `${jour}, ${heure}` : jour;
}

/** Le jour écrit en clair, même demain : « Sam. 31 oct., 09:00 ». */
export function libelleJourCourt(cle: string, heure: string | null): string {
  const jour = capitaliser(jourCourt.format(depuisCle(cle)));
  return heure ? `${jour}, ${heure}` : jour;
}

/** « Lun. 27 oct. → Jeu. 30 oct. » pour un rappel sur plusieurs jours, sinon l'échéance. */
export function libellePeriode(cle: string, heure: string | null, fin: string | null | undefined): string {
  if (!fin || fin <= cle) return libelleEcheance(cle, heure);
  return `${libelleEcheance(cle, heure)} → ${libelleEcheance(fin, null)}`;
}

/** Le jour qui compte pour le retard : le dernier jour d'une période, sinon la date. */
export function echeance(t: { date: string | null; fin?: string | null }): string | null {
  return t.fin && t.date && t.fin > t.date ? t.fin : t.date;
}

/** En retard : la date (et l'heure) est passée. */
export function enRetard(cle: string | null, heure: string | null): boolean {
  if (!cle) return false;
  if (heure) return new Date(`${cle}T${heure}`).getTime() < Date.now();
  return cle < aujourdhui();
}

/* ─── Reporter un rappel en un clic ────────────────────────────── */

/** L'heure du matin de l'app (nouvel événement, routines) : celle de « Demain matin » et « Lundi ». */
export const HEURE_MATIN = "09:00";

/** Les trois reports : « Dans 1 h », « Demain matin », « Lundi ». */
export type ReportRapide = "heure" | "demain" | "lundi";

/** Les reports proposés : le dimanche, « Lundi » viserait le même jour que « Demain matin », il n'est pas proposé. */
export function reportsProposes(maintenant: Date): ReportRapide[] {
  return maintenant.getDay() === 0 ? ["heure", "demain"] : ["heure", "demain", "lundi"];
}

const CINQ_MIN = 5 * 60_000;
const deux = (n: number) => String(n).padStart(2, "0");
const heureDe = (d: Date) => `${deux(d.getHours())}:${deux(d.getMinutes())}`;

/**
 * La nouvelle échéance d'un report, en heure locale, toujours dans le futur :
 * - « Dans 1 h » : maintenant sans les secondes, + 60 min, arrondi aux 5 min
 *   supérieures (14:42 → 15:45, 23:30 → demain 00:30). Des millisecondes ajoutées :
 *   minuit et les changements d'heure passent sans cas à part. Une heure locale
 *   répétée (passage à l'heure d'hiver) se relit comme sa première occurrence,
 *   déjà passée : on avance jusqu'à la première qui se relit à l'identique ;
 * - « Demain matin » : le lendemain (jour de calendrier), à `HEURE_MATIN` ;
 * - « Lundi » : le prochain lundi strictement après aujourd'hui (un lundi : +7), à `HEURE_MATIN`.
 */
export function cibleReport(choix: ReportRapide, maintenant: Date): { date: string; heure: string } {
  if (choix === "heure") {
    const minute = Math.floor(maintenant.getTime() / 60_000) * 60_000;
    let cible = Math.ceil((minute + 60 * 60_000) / CINQ_MIN) * CINQ_MIN;
    for (let i = 0; i < 24; i++) {
      const d = new Date(cible);
      const e = { date: cleJour(d), heure: heureDe(d) };
      if (new Date(`${e.date}T${e.heure}`).getTime() >= cible) return e;
      cible += CINQ_MIN;
    }
    const d = new Date(cible);
    return { date: cleJour(d), heure: heureDe(d) };
  }
  const jour = depuisCle(cleJour(maintenant));
  /* getDay : 0 dimanche … 1 lundi. */
  jour.setDate(jour.getDate() + (choix === "demain" ? 1 : (8 - jour.getDay()) % 7 || 7));
  return { date: cleJour(jour), heure: HEURE_MATIN };
}

/** Les jours de calendrier entre deux dates « 2026-10-22 », sans effet du changement d'heure. */
function joursEntre(de: string, a: string): number {
  const [x, y] = [de, a].map((c) => {
    const [an, m, j] = c.split("-").map(Number);
    return Date.UTC(an, m - 1, j);
  });
  return Math.round((y - x) / 86_400_000);
}

/**
 * Le même rappel, reporté : sa date et son heure changent, une période est
 * décalée en bloc (même durée), et sa notification repartira à la nouvelle
 * échéance (`notifiee` à faux). Tout le reste est identique. `null` si la cible
 * est déjà son échéance : rien à écrire.
 */
export function reporter(tache: Tache, choix: ReportRapide, maintenant: Date): Tache | null {
  const { date, heure } = cibleReport(choix, maintenant);
  if (date === tache.date && heure === tache.heure) return null;
  const reporte: Tache = { ...tache, date, heure, notifiee: false };
  const duree = tache.date && tache.fin && tache.fin > tache.date ? joursEntre(tache.date, tache.fin) : 0;
  if (duree > 0) {
    const fin = depuisCle(date);
    fin.setDate(fin.getDate() + duree);
    reporte.fin = cleJour(fin);
  } else if (tache.fin !== undefined) reporte.fin = null;
  return reporte;
}
