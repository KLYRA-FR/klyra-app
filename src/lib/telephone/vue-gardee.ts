/**
 * La vue gardée (socle mobile § 5.4, décision de Corentin du 04/11) : la dernière réponse lue d'une
 * lecture de l'ordinateur, gardée sur ce téléphone seulement, pour l'afficher en lecture seule quand
 * l'ordinateur est fermé. Rien dans le compte (M-7). Une vue vaut pour un compte, un poste, une
 * lecture et ses arguments : un autre compte ou un autre ordinateur ne la voit jamais. Effacée à la
 * déconnexion de ce téléphone et quand le compte change. Pur, testé (`vue-gardee.test.ts`).
 */

export interface VueGardee<T> {
  data: T;
  /** L'heure de la lecture (horloge du téléphone). */
  lu: number;
}

/** Ce que la vue gardée utilise du stockage du navigateur (`localStorage`). */
export type Stock = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const PREFIXE = "klyra:vue:";
/** Une vue plus grande n'est pas gardée (un fichier ouvert dans la visionneuse, surtout) : environ 1 Mo. */
export const TAILLE_MAX_VUE = 500_000;
/** Toutes les vues ensemble, en caractères : sous le quota d'un `localStorage` (5 Mo). */
export const TAILLE_MAX_TOTALE = 1_500_000;

function stockParDefaut(): Stock | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** La clé d'une vue : compte, poste, lecture, arguments. */
export function cleVue(compte: string, poste: string, type: string, args: string): string {
  return `${PREFIXE}${compte}|${poste}|${type}|${args}`;
}

function clesVues(stock: Stock): string[] {
  const cles: string[] = [];
  for (let i = 0; i < stock.length; i++) {
    const cle = stock.key(i);
    if (cle?.startsWith(PREFIXE)) cles.push(cle);
  }
  return cles;
}

function lireBrut<T>(brut: string | null): VueGardee<T> | null {
  if (!brut) return null;
  try {
    const vue = JSON.parse(brut) as Partial<VueGardee<T>> | null;
    if (!vue || typeof vue.lu !== "number" || !Number.isFinite(vue.lu) || !("data" in vue)) return null;
    return { data: vue.data as T, lu: vue.lu };
  } catch {
    return null;
  }
}

export function lireVue<T>(cle: string, stock: Stock | null = stockParDefaut()): VueGardee<T> | null {
  if (!stock) return null;
  try {
    return lireBrut<T>(stock.getItem(cle));
  } catch {
    return null;
  }
}

/**
 * Garde une lecture. Trop grande : l'ancienne vue de cette clé est retirée (elle serait fausse).
 * Le total dépassé ou le stockage plein : les vues les plus anciennes partent d'abord.
 */
export function garderVue(cle: string, data: unknown, lu: number, stock: Stock | null = stockParDefaut()): boolean {
  if (!stock) return false;
  let brut: string;
  try {
    brut = JSON.stringify({ data, lu });
  } catch {
    return false;
  }
  try {
    if (brut.length > TAILLE_MAX_VUE) {
      stock.removeItem(cle);
      return false;
    }
    const autres = clesVues(stock)
      .filter((c) => c !== cle)
      .map((c) => {
        const valeur = stock.getItem(c) ?? "";
        return { cle: c, taille: valeur.length, lu: lireBrut(valeur)?.lu ?? 0 };
      })
      .sort((a, b) => a.lu - b.lu);
    let total = brut.length + autres.reduce((somme, v) => somme + v.taille, 0);
    while (total > TAILLE_MAX_TOTALE && autres.length > 0) {
      const vieille = autres.shift()!;
      stock.removeItem(vieille.cle);
      total -= vieille.taille;
    }
    for (;;) {
      try {
        stock.setItem(cle, brut);
        return true;
      } catch {
        const vieille = autres.shift();
        if (!vieille) return false;
        stock.removeItem(vieille.cle);
      }
    }
  } catch {
    return false;
  }
}

/** Déconnexion de ce téléphone : toutes les vues. `sauf` : le compte connecté garde les siennes. */
export function effacerVues(stock: Stock | null = stockParDefaut(), sauf?: string) {
  if (!stock) return;
  try {
    for (const cle of clesVues(stock)) {
      if (sauf === undefined || !cle.startsWith(`${PREFIXE}${sauf}|`)) stock.removeItem(cle);
    }
  } catch {
    /* Sans stockage, rien n'a été gardé. */
  }
}

const deux = (n: number) => String(n).padStart(2, "0");
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function memeJour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * « Vue à 18:42 » (aujourd'hui), « Vue hier à 18:42 », « Vue le 2 nov. à 18:42 ». `mot` s'accorde
 * avec ce qui est montré (« Vus » pour des rappels).
 */
export function libelleVue(lu: number, maintenant: number, mot = "Vue"): string {
  const d = new Date(lu);
  const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}`;
  const jour = new Date(maintenant);
  if (memeJour(d, jour)) return `${mot} à ${heure}`;
  const hier = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate() - 1);
  if (memeJour(d, hier)) return `${mot} hier à ${heure}`;
  return `${mot} le ${d.getDate()} ${MOIS[d.getMonth()]} à ${heure}`;
}
