import type { Version } from "../data/changelog";

/** Les dates s'affichent à l'heure de Paris : une version publiée à 23 h UTC est déjà du lendemain. */
const FUSEAU = "Europe/Paris";

const jourLong = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: FUSEAU });
const jourCourt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: FUSEAU });
const mois = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: FUSEAU });
const jourIso = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: FUSEAU });

/** « 2 novembre 2026 ». */
export function dateLongue(iso: string): string {
  return jourLong.format(new Date(iso));
}

/** « 2 nov. ». */
export function dateCourte(iso: string): string {
  return jourCourt.format(new Date(iso));
}

/** « 2026-11-02 », pour l'attribut `datetime`. */
export function dateIso(iso: string): string {
  return jourIso.format(new Date(iso));
}

/** « Novembre 2026 ». */
export function libelleMois(iso: string): string {
  const texte = mois.format(new Date(iso));
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** « 0.1.65 » → « v0-1-65 », l'ancre de la version dans la page. */
export function ancre(version: string): string {
  return `v${version.replaceAll(".", "-")}`;
}

/** Les versions rangées par mois, dans l'ordre de la liste. */
export function parMois(versions: Version[]): { mois: string; versions: Version[] }[] {
  const groupes: { mois: string; versions: Version[] }[] = [];
  for (const version of versions) {
    const libelle = libelleMois(version.publiee);
    const dernier = groupes.at(-1);
    if (dernier?.mois === libelle) dernier.versions.push(version);
    else groupes.push({ mois: libelle, versions: [version] });
  }
  return groupes;
}

export type Morceau = { type: "texte" | "gras" | "code"; texte: string };

/** Découpe un texte de note en morceaux : **gras**, `code`, le reste en texte. Jamais de HTML. */
export function morceaux(texte: string): Morceau[] {
  const resultat: Morceau[] = [];
  const motif = /\*\*(.+?)\*\*|`(.+?)`/g;
  let curseur = 0;
  for (const trouve of texte.matchAll(motif)) {
    const debut = trouve.index ?? 0;
    if (debut > curseur) resultat.push({ type: "texte", texte: texte.slice(curseur, debut) });
    if (trouve[1] !== undefined) resultat.push({ type: "gras", texte: trouve[1] });
    else resultat.push({ type: "code", texte: trouve[2] });
    curseur = debut + trouve[0].length;
  }
  if (curseur < texte.length) resultat.push({ type: "texte", texte: texte.slice(curseur) });
  return resultat;
}
