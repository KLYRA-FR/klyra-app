import { rappelsDuJour, trierJour } from "./planning";

/**
 * « Ta journée » en tête de Chats (lot 2, E2-01) : les rendez-vous et les rappels à heure d'aujourd'hui,
 * du compte et de l'ordinateur, dans l'ordre des heures, et le nombre de rappels à faire (en retard
 * compris, comme « À faire aujourd'hui » du Planning). Pur, testé. Règle D-8 : la carte ne dit
 * « Rien de prévu » que si toutes les sources ont été lues ; ce choix revient à l'écran.
 */

export interface LigneJournee {
  cle: string;
  /** « 10:00 » ; null : toute la journée. */
  heure: string | null;
  titre: string;
  href: string;
}

export interface Journee {
  /** Les trois premiers éléments du jour : toute la journée d'abord, puis dans l'ordre des heures. */
  lignes: LigneJournee[];
  /** Les éléments du jour qui ne tiennent pas dans la carte. */
  autres: number;
  /** Les rappels pas faits du jour, en retard compris. */
  aFaire: number;
}

interface EvenementJour {
  cle: string;
  titre: string;
  jour: string;
  debut: string | null;
  href: string;
}

interface RappelJour {
  id: string;
  titre: string;
  jour: string | null;
  fin: string | null;
  heure: string | null;
  faite: boolean;
  priorite: number;
  href: string;
}

const MAX_LIGNES = 3;

export function journeeDuJour({ evenements, rappels, aujourdhui }: { evenements: EvenementJour[]; rappels: RappelJour[]; aujourdhui: string }): Journee {
  const aFaire = rappelsDuJour(rappels, aujourdhui, aujourdhui).filter((r) => !r.faite);
  const elements = trierJour([
    ...evenements.filter((e) => e.jour === aujourdhui),
    /* Un rappel à heure d'aujourd'hui se place parmi les rendez-vous ; les autres sont comptés dessous. */
    ...aFaire.filter((r) => r.heure && r.jour === aujourdhui).map((r) => ({ cle: `rappel-${r.id}`, titre: r.titre, jour: aujourdhui, debut: r.heure, href: r.href })),
  ]);
  return {
    lignes: elements.slice(0, MAX_LIGNES).map((e) => ({ cle: e.cle, heure: e.debut, titre: e.titre, href: e.href })),
    autres: Math.max(0, elements.length - MAX_LIGNES),
    aFaire: aFaire.length,
  };
}

/** « 2 rappels à faire aujourd'hui », « Un rappel à faire aujourd'hui », ou null. */
export function texteAFaire(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "Un rappel à faire aujourd’hui" : `${n} rappels à faire aujourd’hui`;
}

/** « Bonjour Camille » : le prénom du compte, sinon « Bonjour ». */
export function bonjour(nom: string | null | undefined): string {
  const prenom = nom?.trim().split(/\s+/)[0];
  return prenom ? `Bonjour ${prenom}` : "Bonjour";
}

const fmtDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/** « Mercredi 4 novembre ». */
export function dateDuJour(d: Date): string {
  const texte = fmtDate.format(d);
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
