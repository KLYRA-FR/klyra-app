import type { Evenement } from "@/types/domain";
import type { Creneau } from "../../electron/cartes-interactives";

export * from "../../electron/cartes-interactives";

/**
 * Les cartes interactives, côté écran : les règles communes au PC et au VPS sont dans
 * electron/cartes-interactives.ts (réexportées ici) ; ici, ce que le planning de la personne dit
 * d'un créneau proposé.
 */

const minutes = (heure: string) => {
  const [h, m] = heure.split(":").map(Number);
  return h * 60 + m;
};

/** Le jour de la semaine d'une date « AAAA-MM-JJ », sans fuseau. */
const jourDe = (date: string) => {
  const [a, m, j] = date.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j)).getUTCDay();
};

/**
 * Les rendez-vous du planning qui tombent pendant ce créneau : le même jour (ou chaque semaine, ce
 * jour-là, pour un rendez-vous qui se répète), toute la journée ou dont les heures se chevauchent.
 */
export function occupations(creneau: Creneau, evenements: readonly Evenement[]): Evenement[] {
  const debut = minutes(creneau.heure);
  const fin = debut + creneau.duree;
  return evenements.filter((e) => {
    const jour = e.date === creneau.date || (!!e.repete && !e.occurrence && e.date <= creneau.date && jourDe(e.date) === jourDe(creneau.date));
    if (!jour) return false;
    if (!e.debut) return true;
    const d = minutes(e.debut);
    const f = e.fin ? minutes(e.fin) : d + 60;
    return d < fin && debut < f;
  });
}
