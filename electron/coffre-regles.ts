/**
 * Les règles du Coffre de KLYRA, sans Electron ni disque : partagées par le process principal
 * (`coffre.ts`, `coffre-outils.ts`) et l'écran (la carte sécurisée d'une conversation, Réglages › Coffre).
 *
 * Un secret du coffre a un nom de variable (STRIPE_SECRET_KEY) : c'est par lui qu'un agent le demande,
 * le retrouve et l'écrit dans un fichier, sans jamais en voir la valeur.
 */

export type GenreSecret = "cle-api" | "jeton" | "mot-de-passe" | "autre";

export const GENRES_SECRET: Record<GenreSecret, string> = {
  "cle-api": "Clé API",
  jeton: "Jeton d’accès",
  "mot-de-passe": "Mot de passe",
  autre: "Autre secret",
};

export const estGenreSecret = (v: unknown): v is GenreSecret => typeof v === "string" && v in GENRES_SECRET;

/** Une valeur : pas vide, 10 000 caractères au plus (une clé privée PEM y tient). */
export const VALEUR_MAX = 10_000;

/** Ce qu'un agent peut écrire dans un fichier avec `coffre_ecrire_fichier`. */
export type FormatFichier = "env" | "modele" | "brut";
export const FORMATS_FICHIER: FormatFichier[] = ["env", "modele", "brut"];

/** Le texte sans accents, pour en tirer un nom de variable. */
function sansAccents(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Le nom de variable d'un secret : MAJUSCULES, chiffres et _, commence par une lettre, 2 à 64
 * caractères. « stripe-secret key » devient STRIPE_SECRET_KEY ; un nom vide ou illisible est refusé.
 */
export function normaliserVariable(v: unknown): string {
  const brut = typeof v === "string" ? sansAccents(v).trim() : "";
  const nom = brut
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
    .replace(/_+$/, "");
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(nom)) throw new Error("Donne un nom de variable en lettres, chiffres et _, qui commence par une lettre (ex. STRIPE_SECRET_KEY).");
  return nom;
}

/** Un nom de variable proposé d'après ce que la personne tape (« Clé API Stripe » → CLE_API_STRIPE), ou "" . */
export function variableProposee(nom: string): string {
  try {
    return normaliserVariable(nom);
  } catch {
    return "";
  }
}

/** Un texte court d'un champ (nom, service, note, raison) : une ligne, coupé à `max`. */
export function texteCourt(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** La valeur d'un secret : refusée vide ou trop longue. Les espaces autour, collés par mégarde, partent. */
export function validerValeur(v: unknown): string {
  const valeur = typeof v === "string" ? v.replace(/^[\s\u200b\ufeff]+|[\s\u200b\ufeff]+$/g, "") : "";
  if (!valeur) throw new Error("La valeur est vide.");
  if (valeur.length > VALEUR_MAX) throw new Error("La valeur dépasse 10 000 caractères.");
  return valeur;
}

/** La ligne `VARIABLE=valeur` d'un fichier .env, entre guillemets si la valeur en a besoin. */
export function ligneEnv(variable: string, valeur: string): string {
  if (/[\r\n]/.test(valeur)) throw new Error("Une valeur sur plusieurs lignes ne va pas dans un fichier .env : utilise le format « brut ».");
  if (/^[A-Za-z0-9_\-.:/+=@~,%]+$/.test(valeur)) return `${variable}=${valeur}`;
  return `${variable}="${valeur.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
}

/**
 * Le contenu d'un fichier .env avec la ligne du secret : la ligne existante de cette variable est
 * remplacée (son `export ` gardé), sinon la ligne est ajoutée à la fin. Rien d'autre ne change.
 */
export function ecrireDansEnv(contenu: string, variable: string, valeur: string): { contenu: string; remplace: boolean } {
  const ligne = ligneEnv(variable, valeur);
  const motif = new RegExp(`^(\\s*export\\s+)?${variable}\\s*=.*$`);
  const lignes = contenu.split("\n");
  let remplace = false;
  const nouvelles = lignes.map((l) => {
    const m = l.match(motif);
    if (!m || remplace) return l;
    remplace = true;
    return `${m[1] ? "export " : ""}${ligne}`;
  });
  if (remplace) return { contenu: nouvelles.join("\n"), remplace };
  const base = contenu && !contenu.endsWith("\n") ? `${contenu}\n` : contenu;
  return { contenu: `${base}${ligne}\n`, remplace };
}

/** La marque qu'un fichier modèle porte à la place du secret. */
export const marqueModele = (variable: string) => `{{coffre:${variable}}}`;

/** Le contenu d'un fichier modèle où chaque `{{coffre:VARIABLE}}` devient la valeur. */
export function remplacerModele(contenu: string, variable: string, valeur: string): { contenu: string; n: number } {
  const marque = marqueModele(variable);
  const morceaux = contenu.split(marque);
  return { contenu: morceaux.join(valeur), n: morceaux.length - 1 };
}

/** Une demande de secret d'un agent (outil `coffre_demander`), lisible des deux côtés. Null si elle ne tient pas. */
export interface DemandeSecret {
  variable: string;
  nom: string;
  genre: GenreSecret;
  service: string;
  raison: string;
  ouTrouver: string;
}

export function lireDemandeSecret(entree: Record<string, unknown>): DemandeSecret | null {
  let variable: string;
  try {
    variable = normaliserVariable(entree.variable);
  } catch {
    return null;
  }
  const nom = texteCourt(entree.nom, 120) || variable;
  return {
    variable,
    nom,
    genre: estGenreSecret(entree.genre) ? entree.genre : "cle-api",
    service: texteCourt(entree.service, 200),
    raison: texteCourt(entree.raison, 400),
    ouTrouver: texteCourt(entree.ou_trouver, 300),
  };
}

/** Ce que la personne répond, dans la conversation, une fois la carte sécurisée remplie (jamais la valeur). */
export function messageReponseCoffre(etat: "rangee" | "permise" | "refusee", d: { nom: string; variable: string }): string {
  if (etat === "rangee") return `C’est rangé dans le coffre : « ${d.nom} » (${d.variable}). Tu peux t’en servir sans voir sa valeur.`;
  if (etat === "permise") return `« ${d.nom} » (${d.variable}) est déjà dans le coffre : tu peux t’en servir sans voir sa valeur.`;
  return `Je ne te donne pas « ${d.nom} » (${d.variable}). Continue sans, ou dis-moi ce qu’il te faudrait d’autre.`;
}
