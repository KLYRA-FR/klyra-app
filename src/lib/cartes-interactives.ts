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

/* ─── Le planning sur le téléphone ────────────────────────────────── */

/** Les jours que couvrent des créneaux, pour lire le calendrier du compte (fin exclue). */
export function fenetreCreneaux(creneaux: readonly Creneau[]): { debut: string; fin: string; finMs: number } | null {
  if (!creneaux.length) return null;
  const jours = creneaux.map((c) => c.date).sort();
  const [a, m, j] = jours.at(-1)!.split("-").map(Number);
  const lendemain = new Date(a, m - 1, j + 1);
  const fin = `${lendemain.getFullYear()}-${String(lendemain.getMonth() + 1).padStart(2, "0")}-${String(lendemain.getDate()).padStart(2, "0")}`;
  return { debut: jours[0], fin, finMs: lendemain.getTime() };
}

/** Un rendez-vous du calendrier du compte, tel que le compte le rend (une occurrence par jour). */
export interface OccurrencePlanning {
  id: string;
  /** Le rendez-vous dont c'est une occurrence (une répétition en a une par jour). */
  evenementId?: string;
  titre: string;
  jour: string;
  debut: string | null;
  fin: string | null;
  jourEntier: boolean;
}

/**
 * Le planning à croiser sur le téléphone : le calendrier du compte (déjà développé jour par jour) et
 * les rendez-vous de l'ordinateur, s'il les a donnés. Un même rendez-vous du compte, copié sur
 * l'ordinateur, ne compte qu'une fois.
 */
export function planningTelephone(compte: readonly OccurrencePlanning[] | null | undefined, poste: readonly Evenement[] | null | undefined): Evenement[] {
  const duCompte: Evenement[] = (compte ?? []).map((o) => ({
    id: o.id,
    titre: o.titre,
    date: o.jour,
    debut: o.jourEntier ? null : o.debut,
    fin: o.jourEntier ? null : o.fin,
    notes: "",
    projectId: null,
    notifie: false,
    occurrence: true,
  }));
  const ids = new Set((compte ?? []).map((o) => o.evenementId ?? o.id));
  return [...duCompte, ...(poste ?? []).filter((e) => !e.compteId || !ids.has(e.compteId))];
}
