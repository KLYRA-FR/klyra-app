import type { RoutineRun, RoutineSchedule } from "@/types/routines";

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export function libellePlanning(s: RoutineSchedule): string {
  switch (s.kind) {
    case "manual": return "À la demande";
    case "once": return `Une fois, le ${s.date.split("-").reverse().join("/")} à ${s.time}`;
    case "hourly": return s.minute === 0 ? "Toutes les heures, à l’heure pile" : `Toutes les heures, à la minute ${s.minute}`;
    case "daily": return `Chaque jour à ${s.time}`;
    case "weekdays": return `Du lundi au vendredi à ${s.time}`;
    case "weekly": return `Chaque ${JOURS[s.weekday]} à ${s.time}`;
    case "monthly": return `Le ${s.day === 1 ? "1er" : s.day} de chaque mois à ${s.time}`;
    case "interval": return `Toutes les ${s.amount} ${s.unit === "minutes" ? "minutes" : s.unit === "hours" ? "heures" : "jours"}`;
    case "custom": return `Expression cron : ${s.expression}`;
    case "advanced": {
      const jours = s.days.kind === "every-day" ? "tous les jours" : s.days.kind === "days-of-week" ? s.days.days.map((d) => JOURS[d]).join(", ") : `les ${s.days.days.join(", ")}`;
      const heure = s.time.kind === "at-time" ? `à ${s.time.time}` : `toutes les ${s.time.amount} ${s.time.unit === "minutes" ? "minutes" : "heures"}`;
      return `Programmation avancée : ${jours}, ${heure}, mois ${s.months.join(", ")}`;
    }
  }
}
export function quandRoutine(at: string | null, timezone: string): string {
  if (!at) return "—";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}
export const runActif = (r: RoutineRun) => ["queued", "running", "needs-attention"].includes(r.status);
export function libelleRun(r: RoutineRun): string {
  if (r.missed) return r.missed.capped ? "Plus de 999 manquées" : r.missed.count === 1 ? "Manquée" : `${r.missed.count} manquées`;
  if (r.outcome === "no-update" && r.status === "succeeded") return "Rien à signaler";
  const noms = { queued: "En attente", running: "En cours", "needs-attention": "Attend ton accord", succeeded: "Réussie", failed: "Échec", interrupted: "Interrompue", cancelled: "Annulée" };
  return noms[r.status] + (r.late ? " · en retard" : "");
}
export function lienRun(r: RoutineRun): string | null {
  if (!r.delivery) return null;
  return `/chat?id=${encodeURIComponent(r.delivery.chatId)}${r.delivery.messageId ? `&message=${encodeURIComponent(r.delivery.messageId)}` : ""}`;
}
export function dureeRun(r: RoutineRun): string | null {
  if (!r.startedAt || !r.finishedAt) return null;
  const secondes = Math.max(0, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000));
  return secondes < 60 ? `en ${secondes} s` : secondes < 3600 ? `en ${Math.round(secondes / 60)} min` : `en ${Math.floor(secondes / 3600)} h ${String(Math.floor(secondes / 60) % 60).padStart(2, "0")}`;
}
