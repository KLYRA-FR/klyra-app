import type { Evenement } from "@/types/domain";
import { cleJour } from "./dates";

/**
 * Les rendez-vous de toute l'équipe KLYRA, visibles dans chaque compte : ils
 * se répètent chaque semaine et ne se modifient pas depuis l'app.
 */
const RENDEZ_VOUS: { id: string; titre: string; jour: number; debut: string; fin: string; notes: string }[] = [
  /* jour : 0 dimanche … 2 mardi. */
  { id: "weekly-klyra", titre: "Weekly KLYRA", jour: 2, debut: "09:00", fin: "09:30", notes: "Réunion de toute l’équipe" },
];

/** Les rendez-vous d'équipe entre deux dates (fin exclue), comme des événements. */
export function evenementsEquipeEntre(debut: Date, fin: Date): Evenement[] {
  const liste: Evenement[] = [];
  for (const d = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate()); d < fin; d.setDate(d.getDate() + 1)) {
    for (const r of RENDEZ_VOUS) {
      if (d.getDay() !== r.jour) continue;
      const cle = cleJour(d);
      liste.push({ id: `${r.id}-${cle}`, titre: r.titre, date: cle, debut: r.debut, fin: r.fin, notes: r.notes, projectId: null, notifie: false, equipe: true, repete: true });
    }
  }
  return liste;
}
