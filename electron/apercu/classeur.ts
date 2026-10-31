/**
 * Ce qu'un classeur (xlsx, xls) donne à la visionneuse : ses feuilles visibles,
 * chacune en grille de textes déjà mis en forme (dates, pourcentages, décimales).
 * Les formules ne sont pas recalculées : on montre le dernier résultat enregistré.
 */

export interface Cellule {
  texte: string;
  /** Un nombre (ou une date) : aligné à droite. */
  nombre?: true;
}

export interface Feuille {
  nom: string;
  /** Lignes depuis la première (A1), cellules vides à null. */
  lignes: (Cellule | null)[][];
  colonnes: number;
  /** Lignes et colonnes au-delà de l'aperçu. */
  tronquee: boolean;
}

export const LIGNES_MAX = 2000;
export const COLONNES_MAX = 100;

/** Les cellules posées une à une (ordre quelconque), rendues en grille dense. */
export class Grille {
  private lignes: (Cellule | null)[][] = [];
  private colonnes = 0;
  private tronquee = false;

  poser(ligne: number, colonne: number, cellule: Cellule) {
    if (!cellule.texte) return;
    if (ligne >= LIGNES_MAX || colonne >= COLONNES_MAX) {
      this.tronquee = true;
      return;
    }
    const rangee = (this.lignes[ligne] ??= []);
    rangee[colonne] = cellule;
    this.colonnes = Math.max(this.colonnes, colonne + 1);
  }

  feuille(nom: string): Feuille {
    const lignes = Array.from(this.lignes, (r) => Array.from({ length: this.colonnes }, (_, c) => r?.[c] ?? null));
    return { nom, lignes, colonnes: this.colonnes, tronquee: this.tronquee };
  }
}

/** « B12 » → [11, 1]. */
export function reference(ref: string): [number, number] | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  let colonne = 0;
  for (const c of m[1].toUpperCase()) colonne = colonne * 26 + c.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, colonne - 1];
}

/* ─── Formats de nombre ─────────────────────────────────────────── */

/** Formats intégrés d'Excel (ceux qui changent l'affichage). */
const FORMATS_INTEGRES: Record<number, string> = {
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  5: "#,##0 €",
  6: "#,##0 €",
  7: "#,##0.00 €",
  8: "#,##0.00 €",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  14: "dd/mm/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm",
  19: "h:mm:ss",
  20: "h:mm",
  21: "h:mm:ss",
  22: "dd/mm/yyyy h:mm",
  37: "#,##0",
  38: "#,##0",
  39: "#,##0.00",
  40: "#,##0.00",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss",
  48: "0.0E+0",
  49: "@",
};

export function formatIntegre(id: number): string | null {
  return FORMATS_INTEGRES[id] ?? null;
}

const deux = (n: number) => String(n).padStart(2, "0");

/** Le numéro de série d'Excel en date (jour 1 = 1/1/1900, ou 2/1/1904). */
function dateDeSerie(serie: number, date1904: boolean): Date {
  const origine = date1904 ? Date.UTC(1904, 0, 1) : serie < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(origine + Math.round(serie * 86400) * 1000);
}

/** Un nombre tel qu'Excel l'afficherait avec ce format, en français. */
export function formaterNombre(valeur: number, format: string | null, date1904 = false): string {
  if (!Number.isFinite(valeur)) return String(valeur);
  // Sans le texte entre guillemets, les caractères échappés et les couleurs [Rouge].
  const code = (format ?? "").split(";")[0].replace(/"[^"]*"|\\.|_.|\*./g, "").replace(/\[(?![hms]+\])[^\]]*\]/gi, "");
  const devise = /€/.test(format ?? "") ? " €" : "";
  const standard = /^(general|standard|@)?$/i.test(code.trim());

  if (!standard && /[dy]|[hs]|\bm{1,5}\b/i.test(code) && !/E[+-]/i.test(code)) {
    const d = dateDeSerie(valeur, date1904);
    const jour = `${deux(d.getUTCDate())}/${deux(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    const heure = `${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}${/s/i.test(code) ? `:${deux(d.getUTCSeconds())}` : ""}`;
    const avecDate = /[dy]/i.test(code) || (/m/i.test(code) && !/[hs]/i.test(code));
    const avecHeure = /[hs]/i.test(code);
    if (/\[h\]/i.test(code)) {
      const secondes = Math.round(valeur * 86400);
      return `${Math.floor(secondes / 3600)}:${deux(Math.floor(secondes / 60) % 60)}:${deux(secondes % 60)}`;
    }
    return [avecDate ? jour : "", avecHeure ? heure : ""].filter(Boolean).join(" ");
  }

  const decimales = (code.match(/\.([0#?]+)/)?.[1].length ?? null) as number | null;
  const groupe = /[#0],[#0]/.test(code);
  if (/%/.test(code)) {
    return `${(valeur * 100).toLocaleString("fr-FR", { minimumFractionDigits: decimales ?? 0, maximumFractionDigits: decimales ?? 0 })} %`;
  }
  if (/E[+-]/i.test(code)) return valeur.toExponential(decimales ?? 2).replace(".", ",").toUpperCase();
  if (!standard && (decimales !== null || groupe || /^0+$/.test(code.trim()))) {
    return valeur.toLocaleString("fr-FR", { minimumFractionDigits: decimales ?? 0, maximumFractionDigits: decimales ?? 0, useGrouping: groupe }) + devise;
  }
  // Standard : jusqu'à 15 chiffres significatifs, sans bruit de virgule flottante.
  return Number(valeur.toPrecision(15)).toLocaleString("fr-FR", { maximumFractionDigits: 10, useGrouping: false }) + devise;
}
