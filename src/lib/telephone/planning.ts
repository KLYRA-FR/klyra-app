import { cleJour, depuisCle, echeance, enRetard, grilleMois, libelleEcheance, libelleJourCourt } from "@/lib/dates";
import { echeanceLocale } from "@/lib/rappel-compte";
import { echeanceReportee, reporter, type Report } from "@/lib/report";
import type { Categorie, Tache } from "@/types/domain";

/**
 * Le Planning du téléphone (spec mobile T-05, T-06), sans React : les fenêtres de lecture, la
 * bande de 7 jours, la grille du mois, la liste groupée par jour et les sections de rappels.
 * Les règles des dates et des reports restent celles du bureau (`dates.ts`, `report.ts`).
 */

export type VueAgenda = "jour" | "semaine" | "mois";

export function ajouterJours(cle: string, n: number): string {
  const d = depuisCle(cle);
  d.setDate(d.getDate() + n);
  return cleJour(d);
}

/** Le lundi de la semaine d'un jour. */
export function lundiDe(cle: string): string {
  const d = depuisCle(cle);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return cleJour(d);
}

/** La bande de 7 jours : la semaine du jour choisi, lundi d'abord. */
export function joursDeLaSemaine(cle: string): string[] {
  const lundi = lundiDe(cle);
  return Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
}

/** « ‹ » et « › » : une semaine en jour et en semaine, un mois en mois (le jour gardé, ramené à la fin d'un mois plus court). */
export function decaler(cle: string, vue: VueAgenda, sens: 1 | -1): string {
  if (vue !== "mois") return ajouterJours(cle, 7 * sens);
  const d = depuisCle(cle);
  const dernier = new Date(d.getFullYear(), d.getMonth() + sens + 1, 0).getDate();
  return cleJour(new Date(d.getFullYear(), d.getMonth() + sens, Math.min(d.getDate(), dernier)));
}

/** Ce que le calendrier du compte lit : la semaine (jour et semaine) ou les 42 jours de la grille (mois). Fin exclue. */
export function fenetreAgenda(vue: VueAgenda, cle: string): { debut: string; fin: string; finMs: number } {
  if (vue === "mois") {
    const d = depuisCle(cle);
    const cases = grilleMois(d.getFullYear(), d.getMonth());
    const debut = cleJour(cases[0]);
    const fin = ajouterJours(debut, cases.length);
    return { debut, fin, finMs: depuisCle(fin).getTime() };
  }
  const debut = lundiDe(cle);
  const fin = ajouterJours(debut, 7);
  return { debut, fin, finMs: depuisCle(fin).getTime() };
}

export interface CaseMois {
  cle: string;
  /** Le numéro du jour. */
  numero: number;
  /** Faux pour les jours du mois d'avant ou d'après, affichés en bord de grille. */
  dansLeMois: boolean;
  occupe: boolean;
}

/** La grille compacte du mois : 42 cases, lundi d'abord, un point par jour occupé. */
export function grilleDuMois(cle: string, occupes: ReadonlySet<string>): CaseMois[] {
  const d = depuisCle(cle);
  return grilleMois(d.getFullYear(), d.getMonth()).map((jour) => {
    const c = cleJour(jour);
    return { cle: c, numero: jour.getDate(), dansLeMois: jour.getMonth() === d.getMonth(), occupe: occupes.has(c) };
  });
}

/** Les jours d'une période (un rappel « du 22 au 25 »), bornés à 366 jours. */
function joursCouverts(jour: string, fin: string | null): string[] {
  const dernier = fin && fin > jour ? fin : jour;
  const jours: string[] = [];
  for (let c = jour; c <= dernier && jours.length < 366; c = ajouterJours(c, 1)) jours.push(c);
  return jours;
}

/**
 * Les jours qui ont un point dans la grille : un événement, ou un rappel à faire (chaque jour de sa
 * période). Les départs des routines n'en mettent pas : une routine de chaque jour remplirait la grille.
 */
export function joursOccupes(evenements: { jour: string }[], rappels: { jour: string | null; fin: string | null; faite: boolean }[]): Set<string> {
  const occupes = new Set(evenements.map((e) => e.jour));
  for (const r of rappels) {
    if (r.faite || !r.jour) continue;
    for (const c of joursCouverts(r.jour, r.fin)) occupes.add(c);
  }
  return occupes;
}

/* ─── Agenda : la liste du jour et de la semaine ─────────────────── */

/** Ce qui a sa place dans la liste d'un jour : un événement ou un départ de routine. */
export interface ElementJour {
  jour: string;
  /** « 09:30 » ; null = toute la journée, en tête. */
  debut: string | null;
}

/** Toute la journée d'abord, puis dans l'ordre des heures ; à égalité, l'ordre reçu. */
export function trierJour<T extends ElementJour>(elements: T[]): T[] {
  return [...elements].sort((a, b) => (a.debut ?? "").localeCompare(b.debut ?? ""));
}

/** La semaine : les éléments rangés sous chacun des jours demandés, dans l'ordre des jours. */
export function regrouperParJour<T extends ElementJour>(elements: T[], jours: string[]): { cle: string; elements: T[] }[] {
  const parJour = new Map<string, T[]>(jours.map((cle) => [cle, []]));
  for (const element of elements) parJour.get(element.jour)?.push(element);
  return jours.map((cle) => ({ cle, elements: trierJour(parJour.get(cle) ?? []) }));
}

const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Un départ de routine lu sur le poste (un instant UTC), posé à son jour et son heure sur ce téléphone. */
export function placerDepart(at: string): { jour: string; debut: string } | null {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return { jour: cleJour(date), debut: fmtHeure.format(date) };
}

/* ─── Rappels ─────────────────────────────────────────────────────── */

/**
 * Un rappel tel que le téléphone l'affiche, qu'il vienne du compte ou du poste (un rappel de
 * l'ordinateur pas encore mis dans le compte).
 */
export interface RappelTelephone {
  id: string;
  source: "compte" | "poste";
  titre: string;
  notes: string;
  jour: string | null;
  heure: string | null;
  fin: string | null;
  priorite: 0 | 1 | 2 | 3;
  faite: boolean;
  /** L'id de sa catégorie ; null : aucune. */
  liste: string | null;
  retard: boolean;
  /** Peut changer le titre, la date, l'urgence, la personne, et supprimer. */
  createur: boolean;
  /** Peut le ranger dans une catégorie. */
  assigneAMoi: boolean;
  /** Créé par quelqu'un d'autre : « Par Léa ». */
  recu: boolean;
  /** L'autre personne : celle à qui je l'ai assigné, ou celle qui me l'a assigné. */
  autre: string | null;
  /** La personne à qui il est assigné (compte) ; null pour un rappel de l'ordinateur. */
  assigneA: string | null;
}

/** Ce que le compte renvoie d'un rappel (`rappels.mes`, `rappels.assignes`). */
export interface RappelDuCompte {
  _id: string;
  titre: string;
  notes: string;
  jour: string | null;
  heure: string | null;
  fin: string | null;
  creePar: string;
  assigneA: string;
  statut: "a_faire" | "fait" | "en_retard";
  priorite: 0 | 1 | 2 | 3;
  liste: string | null;
}

export function depuisCompte(r: RappelDuCompte, moiId: string): RappelTelephone {
  const createur = r.creePar === moiId;
  return {
    id: r._id,
    source: "compte",
    titre: r.titre,
    notes: r.notes,
    jour: r.jour,
    heure: r.heure,
    fin: r.fin,
    priorite: r.priorite,
    faite: r.statut === "fait",
    liste: r.liste,
    retard: r.statut === "en_retard",
    createur,
    assigneAMoi: r.assigneA === moiId,
    recu: !createur,
    autre: createur ? (r.assigneA === moiId ? null : r.assigneA) : r.creePar,
    assigneA: r.assigneA,
  };
}

/** Un rappel de l'ordinateur : créé et rangé par la personne, en retard selon la même règle qu'au bureau. */
export function depuisPoste(t: Tache): RappelTelephone {
  return {
    id: t.id,
    source: "poste",
    titre: t.titre,
    notes: t.notes,
    jour: t.date,
    heure: t.date ? t.heure : null,
    fin: t.date && t.fin && t.fin > t.date ? t.fin : null,
    priorite: t.priorite,
    faite: t.faite,
    liste: t.liste,
    retard: !t.faite && enRetard(echeance(t), t.fin ? null : t.heure),
    createur: true,
    assigneAMoi: true,
    recu: false,
    autre: null,
    assigneA: null,
  };
}

/** Comme les colonnes du bureau : datés d'abord, par échéance (sans heure = fin de journée), puis par urgence. */
export function trierRappels<T extends { jour: string | null; heure: string | null; priorite: number }>(liste: T[]): T[] {
  const cle = (r: T) => (r.jour ? `${r.jour}T${r.heure ?? "23:59"}` : "~");
  return [...liste].sort((a, b) => {
    if (Boolean(a.jour) !== Boolean(b.jour)) return a.jour ? -1 : 1;
    return cle(a).localeCompare(cle(b)) || b.priorite - a.priorite;
  });
}

/**
 * « À faire aujourd'hui » d'un jour : les rappels dont la période couvre ce jour, et pour aujourd'hui
 * ceux en retard des jours d'avant (comme « À faire » de l'accueil du bureau). Les terminés du jour
 * restent, barrés.
 */
export function rappelsDuJour<T extends { jour: string | null; fin: string | null; faite: boolean; heure: string | null; priorite: number }>(
  rappels: T[],
  cle: string,
  aujourdhui: string,
): T[] {
  const couvre = (r: T) => !!r.jour && r.jour <= cle && cle <= (r.fin && r.fin > r.jour ? r.fin : r.jour);
  const enRetardAvant = (r: T) => cle === aujourdhui && !r.faite && !!r.jour && (r.fin && r.fin > r.jour ? r.fin : r.jour) < cle;
  return trierRappels(rappels.filter((r) => couvre(r) || enRetardAvant(r)));
}

export type GroupeRappels = "mes" | "assignes" | "recus";

export interface SectionRappels {
  /** Clé stable (repli de la section) : l'id de la catégorie, ou le groupe. */
  id: string;
  groupe: GroupeRappels;
  titre: string;
  categorie: Categorie | null;
  rappels: RappelTelephone[];
  aFaire: number;
}

/**
 * Les sections de T-06, dans l'ordre de la spec : « Mes rappels » (une section par catégorie
 * quand l'ordinateur les a données, sinon une seule), « Ceux que j'ai assignés », « Assignés par
 * l'équipe ». Même règle que les colonnes du bureau (`rappelsDansColonne`) : un rappel sans
 * catégorie connue va dans la première, sauf un rappel reçu, qui reste dans « Assignés par
 * l'équipe » tant qu'on ne l'a pas rangé. Les sections vides ne sont pas rendues, sauf les
 * catégories (on peut y ranger un rappel).
 */
export function sectionsRappels({
  mes,
  assignes,
  categories,
  voirFaits,
  gardes = new Set(),
}: {
  /** Les miens : ceux du compte qui me sont assignés, et ceux de l'ordinateur. */
  mes: RappelTelephone[];
  assignes: RappelTelephone[];
  /** null : l'ordinateur ne les a pas données (fermé). */
  categories: Categorie[] | null;
  voirFaits: boolean;
  /** Cochés à l'instant : ils restent visibles, barrés, même terminés masqués. */
  gardes?: ReadonlySet<string>;
}): SectionRappels[] {
  const visibles = (liste: RappelTelephone[]) => trierRappels(liste.filter((r) => voirFaits || !r.faite || gardes.has(r.id)));
  const section = (id: string, groupe: GroupeRappels, titre: string, categorie: Categorie | null, liste: RappelTelephone[]): SectionRappels => ({
    id,
    groupe,
    titre,
    categorie,
    rappels: visibles(liste),
    aFaire: liste.filter((r) => !r.faite).length,
  });

  const ids = new Set((categories ?? []).map((c) => c.id));
  const sansCategorie = (r: RappelTelephone) => r.liste === null || !ids.has(r.liste);
  const recus = mes.filter((r) => r.recu && sansCategorie(r));
  const ranges = mes.filter((r) => !(r.recu && sansCategorie(r)));

  const sections: SectionRappels[] = [];
  if (categories && categories.length > 0) {
    categories.forEach((categorie, i) => {
      const liste = ranges.filter((r) => r.liste === categorie.id || (i === 0 && sansCategorie(r)));
      sections.push(section(categorie.id, "mes", categorie.nom, categorie, liste));
    });
  } else if (ranges.length > 0) {
    sections.push(section("mes", "mes", "Mes rappels", null, ranges));
  }
  if (assignes.length > 0) sections.push(section("assignes", "assignes", "Ceux que j’ai assignés", null, assignes));
  if (recus.length > 0) sections.push(section("recus", "recus", "Assignés par l’équipe", null, recus));
  return sections;
}

/* ─── Reporter ────────────────────────────────────────────────────── */

/** L'urgence en mots : « !! » seul ne se lit pas (§ 2). */
export const NOMS_URGENCE: Record<0 | 1 | 2 | 3, string> = { 0: "Aucune", 1: "priorité basse", 2: "priorité moyenne", 3: "priorité haute" };

/** Où poser la ligne « maintenant » : avant le premier élément à venir. Les éléments sans heure restent au-dessus. */
export function placeMaintenant(elements: { debut: string | null }[], heure: string): number {
  const i = elements.findIndex((e) => e.debut !== null && e.debut > heure);
  return i === -1 ? elements.length : i;
}

/** La catégorie qui reprend les rappels d'une catégorie supprimée : la première qui reste, comme `planning.supprimerCategorie`. */
export function categorieDeRepli<T extends { id: string }>(categories: readonly T[], id: string): T | null {
  return categories.find((c) => c.id !== id) ?? null;
}

export const NOMS_REPORT: Record<Report, string> = { "une-heure": "Dans 1 h", "demain-matin": "Demain matin", lundi: "Lundi" };

/** La cible écrite à droite, comme `MenuReporter` : « Aujourd'hui, 15:45 » pour Dans 1 h, le jour en clair pour les autres. */
export function cibleReport(report: Report, maintenant: Date): string {
  const { date, heure } = echeanceReportee(report, maintenant);
  return report === "une-heure" ? libelleEcheance(date, heure) : libelleJourCourt(date, heure);
}

const RAPPEL_VIDE: Tache = {
  id: "",
  titre: "",
  notes: "",
  liste: "",
  date: null,
  heure: null,
  fin: null,
  priorite: 0,
  signalee: false,
  faite: false,
  faiteLe: null,
  projectId: null,
  creeLe: "",
  notifiee: false,
};

/**
 * Le report d'un rappel du compte, par la règle du bureau (`reporter`) : nouvelle date et heure, une
 * période garde sa durée, et l'instant du retard est recalculé dans le fuseau de ce téléphone.
 */
export function reportCompte(
  rappel: { jour: string | null; heure: string | null; fin: string | null },
  report: Report,
  maintenant: Date,
): { jour: string; heure: string | null; fin: string | null; echeance: number | null } {
  const reporte = reporter({ ...RAPPEL_VIDE, date: rappel.jour, heure: rappel.heure, fin: rappel.fin }, report, maintenant);
  const jour = reporte.date ?? cleJour(maintenant);
  const fin = reporte.fin && reporte.fin > jour ? reporte.fin : null;
  return { jour, heure: reporte.heure, fin, echeance: echeanceLocale(jour, reporte.heure, fin) };
}
