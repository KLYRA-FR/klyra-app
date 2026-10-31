import { depuisCle } from "@/lib/dates";
import type { Tache } from "@/types/domain";

/** L'instant où un rappel local devient en retard, dans le fuseau de cet ordinateur. */
export function echeanceLocale(jour: string | null, heure: string | null, fin: string | null): number | null {
  if (!jour) return null;
  if (heure) return new Date(`${jour}T${heure}`).getTime();
  const dernier = fin && fin > jour ? fin : jour;
  const date = depuisCle(dernier);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

const LISTE = /^[A-Za-z0-9_-]{1,80}$/;

/** Un rappel de l'ordinateur, prêt pour `rappels.importer`. null s'il n'a pas de titre, ou un id que le serveur refuserait. */
export function versImport(tache: Tache) {
  const titre = tache.titre.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!titre || !LISTE.test(tache.id)) return null;
  const jour = tache.date;
  const heure = jour ? tache.heure : null;
  const fin = jour && tache.fin && tache.fin > jour ? tache.fin : null;
  return {
    titre,
    notes: (tache.notes ?? "").trim().slice(0, 4_000),
    jour,
    heure,
    fin,
    echeance: echeanceLocale(jour, heure, fin),
    priorite: tache.priorite,
    origineLocale: tache.id,
    faite: tache.faite,
    liste: LISTE.test(tache.liste) ? tache.liste : null,
  };
}
