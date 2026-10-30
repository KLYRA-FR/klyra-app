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
