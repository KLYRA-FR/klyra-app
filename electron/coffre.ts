import { app, clipboard, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ecrireCible, verifierCible } from "./coffre-fichier";
import { estGenreSecret, normaliserVariable, texteCourt, validerValeur, type GenreSecret } from "./coffre-regles";
import { listerCoffre, type ConnexionCoffre } from "./navigateur/coffre";

/**
 * Le Coffre de KLYRA (Réglages › Coffre) : tous les secrets de la personne au même endroit.
 * - Les clés API, jetons et mots de passe libres sont ici, dans `userData/coffre.json`, chacun
 *   chiffré par le trousseau du système (safeStorage), comme les clés des autres IA.
 * - Les connexions de sites restent dans le coffre du navigateur (`navigateur/coffre.ts`, son fichier
 *   et sa forme inchangés) : le Coffre les montre avec le reste.
 *
 * Une valeur ne quitte jamais ce process vers l'écran ni vers un agent : la personne la copie par le
 * presse-papiers du système (vidé après 30 s), un agent l'écrit dans un fichier hors de Git
 * (`ecrireSecretDansFichier`, ou par un VPS qui l'écrit chez lui) ou remplit une connexion du navigateur. L'écran l'envoie une seule fois,
 * quand la personne la tape ou la colle, et elle est chiffrée aussitôt.
 */

export type OrigineSecret = { par: "personne" } | { par: "agent"; roleId: string; chatId: string };

interface SecretStocke {
  id: string;
  variable: string;
  nom: string;
  genre: GenreSecret;
  service: string;
  note: string;
  /** Chiffré par le trousseau, en base64. */
  valeur: string;
  /** Les agents peuvent-ils s'en servir (sans la voir) ? */
  agents: boolean;
  origine: OrigineSecret;
  ajouteLe: number;
  modifieLe: number;
  utiliseLe: number | null;
}

export type SecretCoffre = Omit<SecretStocke, "valeur">;

export interface EtatCoffre {
  secrets: SecretCoffre[];
  connexions: ConnexionCoffre[];
  /** Le trousseau du système chiffre-t-il ? Sans lui, rien ne s'ajoute. */
  chiffrement: boolean;
}

const fichier = () => path.join(app.getPath("userData"), "coffre.json");

function publique(e: SecretStocke): SecretCoffre {
  const { valeur, ...reste } = e;
  void valeur;
  return reste;
}

function lire(): SecretStocke[] {
  try {
    if (!existsSync(fichier())) return [];
    const v = JSON.parse(readFileSync(fichier(), "utf8")) as unknown;
    if (!Array.isArray(v)) return [];
    return (v as SecretStocke[]).filter((e) => e && typeof e.id === "string" && typeof e.variable === "string" && typeof e.valeur === "string");
  } catch {
    return [];
  }
}

/* Une écriture à la fois : deux ajouts rapprochés ne s'écrasent pas. */
let file: Promise<unknown> = Promise.resolve();
function modifier<T>(fn: (liste: SecretStocke[]) => T): Promise<T> {
  const suite = file.then(async () => {
    const liste = lire();
    const r = fn(liste);
    const tmp = `${fichier()}.tmp`;
    await writeFile(tmp, JSON.stringify(liste), { encoding: "utf8", mode: 0o600 });
    await rename(tmp, fichier());
    signalerCoffre();
    return r;
  });
  file = suite.catch(() => undefined);
  return suite;
}

const ecouteurs = new Set<() => void>();
/** Le Coffre a changé (un agent y a rangé un secret, la personne en a retiré un…) : l'écran relit. */
export function surChangementCoffre(fn: () => void): () => void {
  ecouteurs.add(fn);
  return () => ecouteurs.delete(fn);
}
export function signalerCoffre(): void {
  for (const fn of ecouteurs) {
    try {
      fn();
    } catch {
      /* un écouteur fermé n'empêche pas les autres */
    }
  }
}

const chiffrer = (valeur: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le trousseau du système est indisponible : le secret ne peut pas être protégé.");
  return safeStorage.encryptString(valeur).toString("base64");
};
const dechiffrer = (e: SecretStocke) => safeStorage.decryptString(Buffer.from(e.valeur, "base64"));

export function listerSecrets(): SecretCoffre[] {
  return lire()
    .map(publique)
    .sort((a, b) => a.nom.localeCompare(b.nom) || a.variable.localeCompare(b.variable));
}

export function etatCoffre(): EtatCoffre {
  return { secrets: listerSecrets(), connexions: listerCoffre(), chiffrement: safeStorage.isEncryptionAvailable() };
}

export interface EntreeSecret {
  variable: unknown;
  nom?: unknown;
  genre?: unknown;
  service?: unknown;
  note?: unknown;
  valeur: unknown;
  agents?: unknown;
}

/**
 * Range un secret. Un nom de variable déjà pris est refusé, sauf pour la personne qui le remplace
 * exprès (`remplacer`) : un agent n'écrase jamais un secret.
 */
export async function ajouterSecret(entree: EntreeSecret, origine: OrigineSecret, remplacer = false): Promise<SecretCoffre> {
  const variable = normaliserVariable(entree.variable);
  const valeur = validerValeur(entree.valeur);
  const chiffre = chiffrer(valeur);
  const maintenant = Date.now();
  return modifier((liste) => {
    const existant = liste.find((e) => e.variable === variable);
    if (existant && !(remplacer && origine.par === "personne")) throw new Error(`Le coffre a déjà un secret ${variable}${origine.par === "agent" ? " : choisis un autre nom, ou utilise celui-ci" : ""}.`);
    const champs = {
      nom: texteCourt(entree.nom, 120) || variable,
      genre: estGenreSecret(entree.genre) ? entree.genre : ("cle-api" as GenreSecret),
      service: texteCourt(entree.service, 200),
      note: texteCourt(entree.note, 500),
      agents: entree.agents === undefined ? true : entree.agents === true,
    };
    if (existant) {
      Object.assign(existant, champs, { valeur: chiffre, modifieLe: maintenant });
      return publique(existant);
    }
    const nouveau: SecretStocke = { id: randomUUID(), variable, ...champs, valeur: chiffre, origine, ajouteLe: maintenant, modifieLe: maintenant, utiliseLe: null };
    liste.push(nouveau);
    return publique(nouveau);
  });
}

/** Ce que la personne change d'un secret, sans toucher à sa valeur (nom, service, note, agents). */
export async function modifierSecret(id: string, champs: { nom?: unknown; service?: unknown; note?: unknown; agents?: unknown; genre?: unknown }): Promise<SecretCoffre> {
  return modifier((liste) => {
    const e = liste.find((x) => x.id === id);
    if (!e) throw new Error("Ce secret n’est plus dans le coffre.");
    if (champs.nom !== undefined) e.nom = texteCourt(champs.nom, 120) || e.variable;
    if (champs.service !== undefined) e.service = texteCourt(champs.service, 200);
    if (champs.note !== undefined) e.note = texteCourt(champs.note, 500);
    if (champs.agents !== undefined) e.agents = champs.agents === true;
    if (estGenreSecret(champs.genre)) e.genre = champs.genre;
    e.modifieLe = Date.now();
    return publique(e);
  });
}

/** Une nouvelle valeur pour un secret (clé renouvelée), tapée par la personne. */
export async function remplacerValeurSecret(id: string, valeur: unknown): Promise<SecretCoffre> {
  const chiffre = chiffrer(validerValeur(valeur));
  return modifier((liste) => {
    const e = liste.find((x) => x.id === id);
    if (!e) throw new Error("Ce secret n’est plus dans le coffre.");
    e.valeur = chiffre;
    e.modifieLe = Date.now();
    return publique(e);
  });
}

export async function retirerSecret(id: string): Promise<void> {
  await modifier((liste) => {
    const i = liste.findIndex((x) => x.id === id);
    if (i !== -1) liste.splice(i, 1);
  });
}

/** Le secret permis aux agents qui porte ce nom, ou une erreur qui dit quoi faire. */
function permisAuxAgents(liste: SecretStocke[], variable: string): SecretStocke {
  const e = liste.find((x) => x.variable === variable);
  if (!e) throw new Error(`Le coffre n’a pas de secret ${variable} : demande-le avec coffre_demander.`);
  if (!e.agents) throw new Error(`La personne n’a pas permis aux agents d’utiliser ${variable} : demande-le avec coffre_demander, elle pourra te le permettre.`);
  return e;
}

/** Les secrets qu'un agent peut utiliser : nom de variable et description, jamais la valeur. */
export function secretsPourAgents(): SecretCoffre[] {
  return listerSecrets().filter((e) => e.agents);
}

/* ─── La personne copie une valeur ─────────────────────────────── */

let effacement: NodeJS.Timeout | null = null;
/** Le délai avant que le presse-papiers soit vidé, s'il contient toujours le secret. */
export const DELAI_PRESSE_PAPIERS = 30_000;

/**
 * Copie la valeur dans le presse-papiers du système, depuis ce process (l'écran ne la reçoit pas),
 * et l'en retire au bout de 30 s si personne n'a copié autre chose entre-temps.
 */
export function copierSecret(id: string): { delai: number } {
  const e = lire().find((x) => x.id === id);
  if (!e) throw new Error("Ce secret n’est plus dans le coffre.");
  const valeur = dechiffrer(e);
  clipboard.writeText(valeur);
  if (effacement) clearTimeout(effacement);
  effacement = setTimeout(() => {
    effacement = null;
    // readText est asynchrone dans les versions récentes d'Electron.
    void Promise.resolve(clipboard.readText()).then((t) => {
      if (t === valeur) clipboard.clear();
    });
  }, DELAI_PRESSE_PAPIERS);
  effacement.unref?.();
  return { delai: DELAI_PRESSE_PAPIERS };
}

/* ─── Un agent écrit un secret dans un fichier ─────────────────── */

/**
 * La valeur d'un secret permis aux agents, pour l'écrire là où un agent en a besoin : dans un fichier
 * de ce PC (`ecrireSecretDansFichier`), ou dans un fichier d'un VPS, qui l'écrit lui-même
 * (`coffre-outils.ts`, `executerCoffrePourServeur`). Ne va jamais dans la réponse d'un outil.
 */
export function valeurPourAgents(variable: unknown): string {
  const liste = lire();
  const secret = permisAuxAgents(liste, normaliserVariable(variable));
  const valeur = dechiffrer(secret);
  void modifier((l) => {
    const e = l.find((x) => x.id === secret.id);
    if (e) e.utiliseLe = Date.now();
  }).catch(() => undefined);
  return valeur;
}

/**
 * Écrit un secret dans un fichier de ce PC (règles de `coffre-fichier.ts`), pour un agent qui ne voit
 * jamais la valeur. Refusé aussi pour un secret que la personne n'a pas permis aux agents, et dans les
 * données de l'app.
 */
export async function ecrireSecretDansFichier(entree: { variable: unknown; chemin: unknown; format: unknown }): Promise<string> {
  const cible = await verifierCible(entree, { interdits: [app.getPath("userData")] });
  return ecrireCible(cible, valeurPourAgents(cible.variable));
}
