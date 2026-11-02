import { ErreurPoste, booleen, chaine, chaineOuNull } from "@/lib/poste/types";
import type { Report } from "@/lib/report";
import { ROLE_TEINTES, type Categorie, type Evenement, type RoleTeinte, type Tache } from "@/types/domain";

/**
 * Ce que l'ordinateur accepte du téléphone pour son planning (gestes `planning.*`) : les
 * arguments sont relus un par un, jamais pris tels quels. Les règles sont celles des fenêtres
 * du bureau (une fin avant le début est retirée, une date changée réarme la notification).
 */

const JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TITRE_MAX = 200;
const NOTES_MAX = 4_000;
const NOM_CATEGORIE_MAX = 80;
/** Au plus deux mois de départs de routines par demande (la grille du mois en fait six semaines). */
const FENETRE_MAX_MS = 62 * 86_400_000;
const REPORTS: Report[] = ["une-heure", "demain-matin", "lundi"];

const illisible = () => new ErreurPoste("arguments", "Demande illisible.");

function estJour(valeur: string): boolean {
  const m = JOUR.exec(valeur);
  if (!m) return false;
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  return date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour;
}

export function lireJourOuNull(args: Record<string, unknown>, cle: string): string | null {
  const valeur = chaineOuNull(args, cle, 10);
  if (valeur !== null && !estJour(valeur)) throw illisible();
  return valeur;
}

export function lireHeureOuNull(args: Record<string, unknown>, cle: string): string | null {
  const valeur = chaineOuNull(args, cle, 5);
  if (valeur !== null && !HEURE.test(valeur)) throw illisible();
  return valeur;
}

export function lirePriorite(args: Record<string, unknown>, cle: string): Tache["priorite"] {
  const valeur = args[cle];
  if (valeur !== 0 && valeur !== 1 && valeur !== 2 && valeur !== 3) throw illisible();
  return valeur;
}

export function lireReport(args: Record<string, unknown>): Report {
  const valeur = chaine(args, "report", 20);
  if (!REPORTS.includes(valeur as Report)) throw illisible();
  return valeur as Report;
}

/** Deux instants ISO, la fin après le début, au plus deux mois d'écart. */
export function lireFenetre(args: Record<string, unknown>): { debut: string; fin: string } {
  const debut = chaine(args, "debut", 40);
  const fin = chaine(args, "fin", 40);
  const [a, b] = [Date.parse(debut), Date.parse(fin)];
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > FENETRE_MAX_MS) throw illisible();
  return { debut: new Date(a).toISOString(), fin: new Date(b).toISOString() };
}

function titre(args: Record<string, unknown>, phrase: string): string {
  const propre = chaine(args, "titre", 2_000).trim().replace(/\s+/g, " ");
  if (!propre) throw new ErreurPoste("titre", phrase);
  if (propre.length > TITRE_MAX) throw new ErreurPoste("titre", "Ce titre est trop long.");
  return propre;
}

function notes(args: Record<string, unknown>): string {
  const propre = chaine(args, "notes", NOTES_MAX + 1_000).trim();
  if (propre.length > NOTES_MAX) throw new ErreurPoste("notes", "Ces notes sont trop longues.");
  return propre;
}

/**
 * Un rappel de l'ordinateur modifié depuis le téléphone (T-07, cocher). Le même rappel : sa
 * catégorie doit exister, sans date il n'a ni heure ni fin, une fin avant la date est retirée, et
 * une date ou une heure changée réarme sa notification (`notifiee` à faux), comme au bureau.
 */
export function rappelModifie(args: Record<string, unknown>, existant: Tache, categories: Categorie[]): Tache {
  const liste = chaine(args, "liste", 200);
  if (!categories.some((c) => c.id === liste)) throw new ErreurPoste("categorie", "Cette catégorie n’existe plus.");
  const date = lireJourOuNull(args, "jour");
  const heure = date ? lireHeureOuNull(args, "heure") : null;
  const finLue = date ? lireJourOuNull(args, "fin") : null;
  const fin = date && finLue && finLue > date ? finLue : null;
  const faite = booleen(args, "faite");
  const dateChangee = date !== existant.date || heure !== existant.heure;
  return {
    ...existant,
    titre: titre(args, "Donne un titre au rappel."),
    notes: notes(args),
    liste,
    date,
    heure,
    fin,
    priorite: lirePriorite(args, "priorite"),
    faite,
    faiteLe: faite === existant.faite ? existant.faiteLe : faite ? new Date().toISOString() : null,
    notifiee: dateChangee ? false : existant.notifiee,
  };
}

/**
 * Un événement de l'ordinateur modifié depuis le téléphone, avec les champs de sa fenêtre :
 * titre, date, heure « à » heure ou toute la journée, projet, notes. Sa notification repart
 * si la date ou l'heure de début change.
 */
export function evenementModifie(args: Record<string, unknown>, existant: Evenement): Evenement {
  const date = lireJourOuNull(args, "jour");
  if (date === null) throw illisible();
  const debut = lireHeureOuNull(args, "debut");
  const fin = debut ? lireHeureOuNull(args, "fin") : null;
  if (debut && fin && fin <= debut) throw new ErreurPoste("heure", "L’heure de fin doit suivre celle du début.");
  return {
    ...existant,
    titre: titre(args, "Donne un titre à l’événement."),
    notes: notes(args),
    date,
    debut,
    fin,
    projectId: chaineOuNull(args, "projectId", 200),
    notifie: date === existant.date && debut === existant.debut ? existant.notifie : false,
  };
}

/** Une catégorie : un nom, une teinte pastel des agents, une icône de la liste du bureau. */
export function categorieSaisie(args: Record<string, unknown>, icones: readonly string[]): Pick<Categorie, "nom" | "teinte" | "icone"> {
  const nom = chaine(args, "nom", 1_000).trim().replace(/\s+/g, " ");
  if (!nom) throw new ErreurPoste("nom", "Donne un nom à la catégorie.");
  if (nom.length > NOM_CATEGORIE_MAX) throw new ErreurPoste("nom", "Ce nom est trop long.");
  const teinte = chaine(args, "teinte", 40);
  const icone = chaine(args, "icone", 60);
  if (!(ROLE_TEINTES as string[]).includes(teinte) || !icones.includes(icone)) throw illisible();
  return { nom, teinte: teinte as RoleTeinte, icone };
}
