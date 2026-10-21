import type { Frequence } from "@/types/domain";

/**
 * Calcul des passages d'une tâche planifiée : la prochaine fois qu'elle part,
 * et sa fréquence en mots (« Tous les lundis à 09:00 »).
 */

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** 1 = lundi … 7 = dimanche. */
function jourSemaine(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

function aHeure(d: Date, heure: string): Date {
  const [h, m] = heure.split(":").map(Number);
  const r = new Date(d);
  r.setHours(h || 0, m || 0, 0, 0);
  return r;
}

/** Le premier passage strictement après `apres`. */
export function prochainPassage(f: Frequence, apres: Date): Date {
  if (f.type === "heure") {
    const r = new Date(apres);
    r.setMinutes(0, 0, 0);
    r.setHours(r.getHours() + 1);
    return r;
  }
  for (let i = 0; i < 400; i++) {
    const jour = new Date(apres);
    jour.setDate(jour.getDate() + i);
    const candidat = aHeure(jour, f.heure);
    if (candidat <= apres) continue;
    const js = jourSemaine(candidat);
    if (f.type === "jour") return candidat;
    if (f.type === "jours-ouvres" && js <= 5) return candidat;
    if (f.type === "semaine" && js === f.jour) return candidat;
    if (f.type === "mois" && candidat.getDate() === f.jour) return candidat;
  }
  return new Date(apres.getTime() + 86_400_000);
}

/** Les passages entre deux dates (pour la vue de la semaine). */
export function passagesEntre(f: Frequence, debut: Date, fin: Date, max = 48): Date[] {
  const out: Date[] = [];
  let d = new Date(debut.getTime() - 1);
  while (out.length < max) {
    d = prochainPassage(f, d);
    if (d >= fin) break;
    out.push(d);
  }
  return out;
}

export function libelleFrequence(f: Frequence): string {
  switch (f.type) {
    case "heure":
      return "Toutes les heures";
    case "jour":
      return `Tous les jours à ${f.heure}`;
    case "jours-ouvres":
      return `Du lundi au vendredi à ${f.heure}`;
    case "semaine":
      return `Tous les ${JOURS[f.jour - 1]}s à ${f.heure}`;
    case "mois":
      return `Le ${f.jour === 1 ? "1er" : f.jour} de chaque mois à ${f.heure}`;
  }
}

export const NOMS_JOURS = JOURS;
