import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { connexionPourPage, hoteDeSaisie } from "./regles";

/**
 * Le coffre du navigateur de KLYRA : les connexions (site, identifiant, mot de passe) que la
 * personne y range, pour remplir une page de connexion sans que l'agent voie le mot de passe.
 * Chiffré par le trousseau du système (safeStorage) dans userData/coffre-navigateur.json, comme
 * les clés des autres IA. Rien n'en sort vers l'écran ni vers un agent, sauf le site et l'identifiant ;
 * le mot de passe ne va que dans le champ d'une page de ce site (cf. `scriptRemplirConnexion`).
 */

interface Stockee {
  id: string;
  hote: string;
  identifiant: string;
  /** Chiffré par le trousseau, en base64. */
  motDePasse: string;
  /** Les agents peuvent-ils s'en servir (sinon, seulement la personne, d'un clic) ? */
  agents: boolean;
  ajouteLe: number;
  utiliseLe: number | null;
}

export type ConnexionCoffre = Omit<Stockee, "motDePasse">;

const fichier = () => path.join(app.getPath("userData"), "coffre-navigateur.json");
function publique(e: Stockee): ConnexionCoffre {
  const { motDePasse, ...reste } = e;
  void motDePasse;
  return reste;
}

function lire(): Stockee[] {
  try {
    if (!existsSync(fichier())) return [];
    const v = JSON.parse(readFileSync(fichier(), "utf8")) as unknown;
    return Array.isArray(v) ? (v as Stockee[]).filter((e) => e && typeof e.id === "string" && typeof e.hote === "string" && typeof e.motDePasse === "string") : [];
  } catch {
    return [];
  }
}

async function ecrire(liste: Stockee[]): Promise<void> {
  const tmp = `${fichier()}.tmp`;
  await writeFile(tmp, JSON.stringify(liste), { encoding: "utf8", mode: 0o600 });
  await rename(tmp, fichier());
}

export function listerCoffre(): ConnexionCoffre[] {
  return lire().map(publique).sort((a, b) => a.hote.localeCompare(b.hote) || a.identifiant.localeCompare(b.identifiant));
}

export async function ajouterAuCoffre(entree: { site: unknown; identifiant: unknown; motDePasse: unknown; agents: unknown }): Promise<ConnexionCoffre[]> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le trousseau du système est indisponible : le mot de passe ne peut pas être protégé.");
  const hote = hoteDeSaisie(String(entree.site ?? ""));
  const identifiant = String(entree.identifiant ?? "").trim().slice(0, 300);
  const motDePasse = String(entree.motDePasse ?? "");
  if (!motDePasse || motDePasse.length > 1_000) throw new Error("Indique le mot de passe.");
  const liste = lire();
  const existant = liste.find((e) => e.hote === hote && e.identifiant.toLowerCase() === identifiant.toLowerCase());
  const chiffre = safeStorage.encryptString(motDePasse).toString("base64");
  if (existant) {
    existant.motDePasse = chiffre;
    existant.agents = entree.agents === true;
  } else liste.push({ id: randomUUID(), hote, identifiant, motDePasse: chiffre, agents: entree.agents === true, ajouteLe: Date.now(), utiliseLe: null });
  await ecrire(liste);
  return listerCoffre();
}

export async function retirerDuCoffre(id: string): Promise<ConnexionCoffre[]> {
  await ecrire(lire().filter((e) => e.id !== id));
  return listerCoffre();
}

export async function changerAgentsCoffre(id: string, agents: boolean): Promise<ConnexionCoffre[]> {
  const liste = lire();
  const e = liste.find((x) => x.id === id);
  if (!e) throw new Error("Cette connexion n’est plus dans le coffre.");
  e.agents = agents === true;
  await ecrire(liste);
  return listerCoffre();
}

/** Les connexions qui valent pour cette page (et, pour un agent, celles qu'il a le droit d'utiliser). */
export function connexionsPour(url: string, parAgent: boolean): ConnexionCoffre[] {
  return listerCoffre().filter((e) => connexionPourPage(e.hote, url) && (!parAgent || e.agents));
}

/** Le secret d'une connexion, pour la page de son site seulement. Ne quitte jamais le process principal. */
export function secretPour(id: string, url: string, parAgent: boolean): { identifiant: string; motDePasse: string; hote: string } {
  const liste = lire();
  const e = liste.find((x) => x.id === id);
  if (!e || !connexionPourPage(e.hote, url)) throw new Error("Cette connexion ne vaut pas pour cette page.");
  if (parAgent && !e.agents) throw new Error("La personne n’a pas permis aux agents d’utiliser cette connexion.");
  e.utiliseLe = Date.now();
  void ecrire(liste).catch(() => undefined);
  return { identifiant: e.identifiant, motDePasse: safeStorage.decryptString(Buffer.from(e.motDePasse, "base64")), hote: e.hote };
}
