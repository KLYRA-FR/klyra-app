/** Formats de date de l'interface, en français. */

const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysBetween(iso: string, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Heure d'un message : « 09:41 ». */
export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

/** Jour et heure d'un message : « 7 oct. à 14:32 ». */
export function formatJourHeure(iso: string): string {
  return `${dayMonth.format(new Date(iso))} à ${formatTime(iso)}`;
}

const complete = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" });

/** Date complète, au survol d'une date courte : « jeudi 30 octobre 2026 à 14:32 ». */
export function formatDateComplete(iso: string): string {
  return complete.format(new Date(iso));
}

/** Date courte des listes : « 09:52 », « Hier », « Lun. », « 7 oct. ». */
export function formatListDate(iso: string, now: Date = new Date()): string {
  const days = daysBetween(iso, now);
  if (days <= 0) return formatTime(iso);
  if (days === 1) return "Hier";
  if (days < 7) return capitalize(weekday.format(new Date(iso)));
  return dayMonth.format(new Date(iso));
}

/** Séparateur de jour dans le fil : « Aujourd’hui · 09:41 ». */
export function formatDaySeparator(iso: string, now: Date = new Date()): string {
  const days = daysBetween(iso, now);
  const label = days <= 0 ? "Aujourd’hui" : days === 1 ? "Hier" : capitalize(dayMonth.format(new Date(iso)));
  return `${label} · ${formatTime(iso)}`;
}

/** Même jour calendaire ? Sert à placer les séparateurs. */
export function isSameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}
