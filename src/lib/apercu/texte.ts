/**
 * Les fichiers texte que la visionneuse met en forme : CSV et TSV en tableau,
 * JSON minifié réindenté. Le reste du texte (code, txt…) garde la vue numérotée.
 */

export type Rendu = "markdown" | "tableau" | "json" | "brut";

export function renduDe(chemin: string): Rendu {
  const ext = /\.([^./\\]+)$/.exec(chemin)?.[1].toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "csv" || ext === "tsv") return "tableau";
  if (ext === "json") return "json";
  return "brut";
}

/** Au-delà, le tableau n'affiche que le début (le fichier entier reste dans la vue source). */
export const LIGNES_TABLEAU_MAX = 2000;

/** Le séparateur d'un CSV : celui qui revient le plus sur la première ligne (« ; » pour l'Excel français). */
function separateurDe(texte: string, tsv: boolean): string {
  if (tsv) return "\t";
  const premiere = texte.slice(0, texte.search(/\n|$/)).replace(/"[^"]*"/g, "");
  const compte = (c: string) => premiere.split(c).length - 1;
  return [";", "\t", "|"].reduce((meilleur, c) => (compte(c) > compte(meilleur) ? c : meilleur), ",");
}

/** Un CSV (RFC 4180 : guillemets, "" pour un guillemet, retours à la ligne dans un champ). */
export function lireCsv(source: string, tsv = false): string[][] {
  const texte = source.replace(/^﻿/, "");
  const separateur = separateurDe(texte, tsv);
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"' && champ === "") guillemets = true;
    else if (c === separateur) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else champ += c;
  }
  if (champ || ligne.length) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes;
}

export const estNombre = (v: string) => /^[-+]?(\d[\d\s  ]*)([.,]\d+)?\s?(%|€|\$)?$/.test(v.trim());

/** La première ligne est un en-tête : des libellés tous remplis, distincts, sans nombre, et des données dessous. */
export function aUnEntete(lignes: string[][]): boolean {
  const [premiere, ...reste] = lignes;
  if (!premiere || !reste.length) return false;
  const valeurs = premiere.map((v) => v.trim());
  return valeurs.every((v) => v && !estNombre(v)) && new Set(valeurs).size === valeurs.length;
}

/**
 * Un JSON valide écrit sur une seule ligne (ou presque), réindenté sur deux
 * espaces pour la lecture ; null s'il est invalide ou déjà lisible. Les valeurs
 * sont recopiées telles quelles (grands nombres, échappements) : rien n'est réinterprété.
 */
export function indenterJson(source: string): string | null {
  const texte = source.replace(/^﻿/, "");
  try {
    JSON.parse(texte);
  } catch {
    return null;
  }
  if (!texte.split("\n").some((l) => l.length > 200)) return null;
  let sortie = "";
  let niveau = 0;
  const alaLigne = () => `\n${"  ".repeat(niveau)}`;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (c === '"') {
      let j = i + 1;
      while (j < texte.length && texte[j] !== '"') j += texte[j] === "\\" ? 2 : 1;
      sortie += texte.slice(i, j + 1);
      i = j;
    } else if (c === "{" || c === "[") {
      let k = i + 1;
      while (/\s/.test(texte[k] ?? "")) k++;
      if (texte[k] === (c === "{" ? "}" : "]")) {
        sortie += c + texte[k];
        i = k;
      } else {
        niveau++;
        sortie += c + alaLigne();
      }
    } else if (c === "}" || c === "]") {
      niveau--;
      sortie += alaLigne() + c;
    } else if (c === ",") sortie += `,${alaLigne()}`;
    else if (c === ":") sortie += ": ";
    else if (!/\s/.test(c)) sortie += c;
  }
  return sortie;
}
