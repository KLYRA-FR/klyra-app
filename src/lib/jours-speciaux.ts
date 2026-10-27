import { cleJour } from "./dates";

/**
 * Les jours que tout le monde voit dans le calendrier, quel que soit le compte :
 * jours fériés en France, fêtes du calendrier et changements d'heure. Calculés
 * sur le poste, rien n'est stocké.
 */
export type GenreJour = "ferie" | "fete" | "heure";

export interface JourSpecial {
  cle: string;
  nom: string;
  genre: GenreJour;
}

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus). */
function paques(annee: number): Date {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(annee, mois - 1, jour);
}

const plus = (d: Date, jours: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + jours);

/** Le dernier dimanche d'un mois (mois de 0 à 11). */
function dernierDimanche(annee: number, mois: number): Date {
  const fin = new Date(annee, mois + 1, 0);
  return plus(fin, -fin.getDay());
}

/** Le n-ième dimanche d'un mois (n à partir de 1). */
function nemeDimanche(annee: number, mois: number, n: number): Date {
  const premier = new Date(annee, mois, 1);
  return plus(premier, ((7 - premier.getDay()) % 7) + (n - 1) * 7);
}

function joursDeLAnnee(annee: number): JourSpecial[] {
  const p = paques(annee);
  const pentecote = plus(p, 49);
  /* Fête des mères : dernier dimanche de mai, ou premier de juin si c'est la Pentecôte. */
  const meres = dernierDimanche(annee, 4);
  const fixe = (mois: number, jour: number) => new Date(annee, mois - 1, jour);
  const liste: [Date, string, GenreJour][] = [
    [fixe(1, 1), "Jour de l’An", "ferie"],
    [plus(p, 1), "Lundi de Pâques", "ferie"],
    [fixe(5, 1), "Fête du Travail", "ferie"],
    [fixe(5, 8), "Victoire 1945", "ferie"],
    [plus(p, 39), "Ascension", "ferie"],
    [plus(p, 50), "Lundi de Pentecôte", "ferie"],
    [fixe(7, 14), "Fête nationale", "ferie"],
    [fixe(8, 15), "Assomption", "ferie"],
    [fixe(11, 1), "Toussaint", "ferie"],
    [fixe(11, 11), "Armistice 1918", "ferie"],
    [fixe(12, 25), "Noël", "ferie"],
    [fixe(2, 14), "Saint-Valentin", "fete"],
    [p, "Pâques", "fete"],
    [pentecote, "Pentecôte", "fete"],
    [cleJour(meres) === cleJour(pentecote) ? plus(meres, 7) : meres, "Fête des mères", "fete"],
    [nemeDimanche(annee, 5, 3), "Fête des pères", "fete"],
    [fixe(12, 24), "Réveillon de Noël", "fete"],
    [fixe(12, 31), "Saint-Sylvestre", "fete"],
    [dernierDimanche(annee, 2), "Heure d’été", "heure"],
    [dernierDimanche(annee, 9), "Heure d’hiver", "heure"],
  ];
  return liste.map(([d, nom, genre]) => ({ cle: cleJour(d), nom, genre }));
}

/** Les jours spéciaux entre deux dates (fin exclue), rangés par jour. */
export function joursSpeciauxEntre(debut: Date, fin: Date): Map<string, JourSpecial[]> {
  const de = cleJour(debut);
  const a = cleJour(fin);
  const m = new Map<string, JourSpecial[]>();
  for (let annee = debut.getFullYear(); annee <= fin.getFullYear(); annee++) {
    for (const j of joursDeLAnnee(annee)) {
      if (j.cle >= de && j.cle < a) m.set(j.cle, [...(m.get(j.cle) ?? []), j]);
    }
  }
  return m;
}
