import { cleJour, depuisCle } from "@/lib/dates";
import type { Tache } from "@/types/domain";

/**
 * Reporter un rappel en un clic (point 7) : « Dans 1 h », « Demain matin »,
 * « Lundi ». Le report modifie le même rappel : seules sa date, son heure (et
 * la fin d'une période, décalée d'autant) changent, et sa notification est
 * réarmée pour la nouvelle échéance. Tout se calcule en heure locale du poste,
 * à partir de `maintenant` (une horloge qu'on peut fixer dans les tests).
 *
 * La règle :
 * - « Dans 1 h » : maintenant + 60 min, à la minute supérieure ; le jour suit
 *   (23:30 → demain 00:30). Au changement d'heure, c'est une vraie heure plus
 *   tard ; si l'heure locale obtenue est ambiguë (heure répétée à l'automne),
 *   on prend la première minute qui ne l'est plus, pour ne jamais sonner tout de suite ;
 * - « Demain matin » : le jour suivant, à `HEURE_MATIN` ;
 * - « Lundi » : le prochain lundi après aujourd'hui (un lundi : celui de la
 *   semaine suivante), à `HEURE_MATIN` ;
 * - la nouvelle échéance est toujours dans le futur.
 */

/** L'heure du matin des reports « Demain matin » et « Lundi ». */
export const HEURE_MATIN = "09:00";

export type Report = "une-heure" | "demain-matin" | "lundi";

export interface Echeance {
  date: string;
  heure: string;
}

const deux = (n: number) => String(n).padStart(2, "0");
const heureDe = (d: Date) => `${deux(d.getHours())}:${deux(d.getMinutes())}`;
/** L'instant qu'une date et une heure locales désignent (comme le fait la boucle des notifications). */
const instant = (e: Echeance) => new Date(`${e.date}T${e.heure}`).getTime();

/** La nouvelle échéance d'un report, en heure locale. */
export function echeanceReportee(report: Report, maintenant: Date): Echeance {
  if (report === "une-heure") {
    let cible = Math.ceil((maintenant.getTime() + 60 * 60_000) / 60_000) * 60_000;
    /* Une heure locale répétée (passage à l'heure d'hiver) se relit comme sa première occurrence :
       on avance jusqu'à la première minute qui se relit à l'identique. */
    for (let i = 0; i < 120; i++) {
      const d = new Date(cible);
      const e = { date: cleJour(d), heure: heureDe(d) };
      if (instant(e) >= cible) return e;
      cible += 60_000;
    }
    const d = new Date(cible);
    return { date: cleJour(d), heure: heureDe(d) };
  }
  const jour = depuisCle(cleJour(maintenant));
  if (report === "demain-matin") {
    jour.setDate(jour.getDate() + 1);
  } else {
    /* getDay : 0 dimanche … 1 lundi. Un lundi : le lundi d'après. */
    const ecart = (8 - jour.getDay()) % 7 || 7;
    jour.setDate(jour.getDate() + ecart);
  }
  return { date: cleJour(jour), heure: HEURE_MATIN };
}

/** Les reports proposés : sans « Lundi » quand il viserait la même échéance que « Demain matin » (le dimanche). */
export function reportsProposes(maintenant: Date): Report[] {
  const memeQueDemain = echeanceReportee("lundi", maintenant).date === echeanceReportee("demain-matin", maintenant).date;
  return memeQueDemain ? ["une-heure", "demain-matin"] : ["une-heure", "demain-matin", "lundi"];
}

/** Les jours entre deux dates « 2026-10-22 », en jours de calendrier (sans effet du changement d'heure). */
function joursEntre(de: string, a: string): number {
  const [x, y] = [de, a].map((c) => {
    const [an, m, j] = c.split("-").map(Number);
    return Date.UTC(an, m - 1, j);
  });
  return Math.round((y - x) / 86_400_000);
}

function decaler(cle: string, jours: number): string {
  const d = depuisCle(cle);
  d.setDate(d.getDate() + jours);
  return cleJour(d);
}

/**
 * Le même rappel, reporté : sa date et son heure changent, une période garde sa
 * durée, et sa notification repartira à la nouvelle échéance (`notifiee` à faux).
 * Le texte, les notes, la catégorie, l'urgence, le drapeau, l'état et les dates
 * de création ne bougent pas.
 */
export function reporter(tache: Tache, report: Report, maintenant: Date): Tache {
  const { date, heure } = echeanceReportee(report, maintenant);
  const duree = tache.date && tache.fin && tache.fin > tache.date ? joursEntre(tache.date, tache.fin) : 0;
  const reporte: Tache = { ...tache, date, heure, notifiee: false };
  if (duree > 0) reporte.fin = decaler(date, duree);
  else if (tache.fin !== undefined) reporte.fin = null;
  return reporte;
}

/**
 * Le rappel reporté, relu par son id dans les rappels tels qu'ils sont au moment
 * du clic ; `null` s'il a été supprimé ou coché entre-temps : rien à écrire
 * (`enregistrerTache` recréerait un rappel supprimé).
 */
export function reporterParId(taches: Tache[], id: string, report: Report, maintenant: Date): Tache | null {
  const actuel = taches.find((t) => t.id === id);
  return actuel && !actuel.faite ? reporter(actuel, report, maintenant) : null;
}
