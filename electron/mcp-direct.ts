import { app, safeStorage, shell } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { autoriser, decouvrir, RefusOAuth, renouveler, type ConnexionOAuth, type DependancesOAuth } from "./mcp-oauth";

/**
 * Les MCP directs de la Marketplace : une app connue (Linear, Supabase…) ou un
 * serveur MCP saisi à la main, branché sans passer par Composio.
 *
 * La connexion passe par l'OAuth du serveur MCP (electron/mcp-oauth.ts) : la
 * personne autorise dans son navigateur, sans jeton à copier. Un jeton collé
 * reste possible seulement pour un serveur saisi à la main qui n'a pas d'OAuth,
 * et les jetons déjà enregistrés continuent de marcher.
 *
 * Jetons et secrets sont chiffrés par le trousseau du système (safeStorage)
 * dans userData/mcp-direct.json. Ils ne reviennent jamais vers l'écran : ils
 * partent seulement dans la configuration MCP des agents.
 */

/** Les apps connues et leur serveur MCP distant officiel. `composio` : l'app passe par Composio (pas d'inscription OAuth ouverte). */
export const APPS_MCP = {
  github: { nom: "GitHub", url: "https://api.githubcopilot.com/mcp/", via: "composio" },
  linear: { nom: "Linear", url: "https://mcp.linear.app/mcp", via: "oauth" },
  supabase: { nom: "Supabase", url: "https://mcp.supabase.com/mcp", via: "oauth" },
  neon: { nom: "Neon", url: "https://mcp.neon.tech/mcp", via: "oauth" },
  stripe: { nom: "Stripe", url: "https://mcp.stripe.com", via: "oauth" },
} as const;
export type AppMcp = keyof typeof APPS_MCP;

/** Une connexion OAuth, ses secrets chiffrés en base64. */
type OAuthStocke = Omit<ConnexionOAuth, "secret" | "acces" | "renouvellement"> & { secret: string | null; acces: string; renouvellement: string | null };

interface McpStocke {
  id: string;
  /** L'app du catalogue, ou `null` pour un serveur saisi à la main. */
  app: AppMcp | null;
  nom: string;
  url: string;
  /** Un jeton collé (ancienne connexion, ou serveur sans OAuth), chiffré en base64 ; `null` sinon. */
  jeton: string | null;
  oauth?: OAuthStocke | null;
  /** Le serveur a refusé de renouveler l'accès : à reconnecter. */
  expire?: boolean;
}

/** Ce que l'interface voit d'un MCP direct : tout, sauf les secrets. */
export interface McpDirect {
  id: string;
  app: AppMcp | null;
  nom: string;
  url: string;
  avecJeton: boolean;
  connexion: "oauth" | "jeton" | "aucune";
  aReconnecter: boolean;
}

/** Le résultat d'une connexion par le navigateur. */
export type ResultatConnexion =
  | { statut: "connecte"; liste: McpDirect[] }
  | { statut: "annule"; liste: McpDirect[] }
  /** Pas d'OAuth utilisable : un jeton collé reste le dernier recours (serveur saisi à la main seulement). */
  | { statut: "sans-oauth"; liste: McpDirect[] };

const fichier = () => path.join(app.getPath("userData"), "mcp-direct.json");

/** Gardée en mémoire : la configuration des agents se construit sans attendre le disque. */
let cache: McpStocke[] = [];
/** Les écritures passent l'une après l'autre (connexion et renouvellement). */
let file: Promise<unknown> = Promise.resolve();
const enSerie = <T>(f: () => Promise<T>): Promise<T> => {
  const p = file.then(f, f);
  file = p.catch(() => {});
  return p;
};

async function lire(): Promise<McpStocke[]> {
  try {
    const v = JSON.parse(await readFile(fichier(), "utf8")) as unknown;
    return Array.isArray(v) ? (v as McpStocke[]) : [];
  } catch {
    return [];
  }
}

async function ecrire(liste: McpStocke[]) {
  const temporaire = `${fichier()}.tmp`;
  await writeFile(temporaire, JSON.stringify(liste), { encoding: "utf8", mode: 0o600 });
  await rename(temporaire, fichier());
  cache = liste;
}

const vue = (m: McpStocke): McpDirect => ({
  id: m.id, app: m.app, nom: m.nom, url: m.url,
  avecJeton: m.jeton !== null,
  connexion: m.oauth ? "oauth" : m.jeton !== null ? "jeton" : "aucune",
  aReconnecter: !!m.expire,
});

const chiffrer = (v: string) => safeStorage.encryptString(v).toString("base64");
const dechiffrer = (v: string) => safeStorage.decryptString(Buffer.from(v, "base64"));

function stocker(c: ConnexionOAuth): OAuthStocke {
  return { ...c, secret: c.secret ? chiffrer(c.secret) : null, acces: chiffrer(c.acces), renouvellement: c.renouvellement ? chiffrer(c.renouvellement) : null };
}

function relireConnexion(o: OAuthStocke): ConnexionOAuth {
  return { ...o, secret: o.secret ? dechiffrer(o.secret) : null, acces: dechiffrer(o.acces), renouvellement: o.renouvellement ? dechiffrer(o.renouvellement) : null };
}

/** Lit la liste une fois, à l'ouverture de l'app. */
export async function chargerMcpDirects(): Promise<void> {
  cache = await lire();
  await renouvelerMcpDirects();
}

export async function listerMcpDirects(): Promise<McpDirect[]> {
  return (await lire()).map(vue);
}

/** L'adresse doit être en https (sauf un serveur local). */
function verifierUrl(url: string): string {
  let u: URL;
  try { u = new URL(url.trim()); }
  catch { throw new Error("Cette adresse n’est pas valide."); }
  if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("L’adresse doit commencer par https://.");
  return u.toString();
}

function verifierCoffre() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le trousseau du système est indisponible : l’accès ne peut pas être protégé.");
}

/** Nom et adresse d'une entrée, vérifiés ; `remplace` : l'entrée qu'on reconnecte (elle garde son nom). */
function cible(liste: McpStocke[], entree: { app?: string | null; nom?: string; url?: string; remplace?: string }) {
  const ancien = entree.remplace ? liste.find((m) => m.id === entree.remplace) : undefined;
  if (entree.remplace && !ancien) throw new Error("Ce serveur n’est plus dans la liste.");
  const appId = ancien ? ancien.app : entree.app ?? null;
  const connue = appId ? APPS_MCP[appId as AppMcp] : null;
  if (appId && !connue) throw new Error("App inconnue.");
  const nom = (ancien?.nom ?? connue?.nom ?? String(entree.nom ?? "").trim()).slice(0, 40);
  const url = verifierUrl(connue?.url ?? ancien?.url ?? String(entree.url ?? ""));
  if (!nom) throw new Error("Il manque le nom du serveur.");
  const autres = liste.filter((m) => m.id !== ancien?.id);
  if (connue && autres.some((m) => m.app === appId)) throw new Error(`${connue.nom} est déjà connecté.`);
  if (autres.some((m) => m.nom.toLowerCase() === nom.toLowerCase())) throw new Error(`Un serveur s’appelle déjà « ${nom} ».`);
  return { ancien, app: appId as AppMcp | null, connue, nom, url };
}

/** Garde l'entrée : en place si elle en remplace une (même id, donc mêmes noms d'outils pour les agents), sinon à la fin. */
function poser(liste: McpStocke[], m: McpStocke): McpStocke[] {
  return liste.some((x) => x.id === m.id) ? liste.map((x) => (x.id === m.id ? m : x)) : [...liste, m];
}

/** Dernier recours : un serveur saisi à la main, sans OAuth, avec ou sans jeton collé. */
export async function ajouterMcpDirect(entree: { app: string | null; nom?: string; url?: string; jeton?: string }): Promise<McpDirect[]> {
  if (entree.app) throw new Error("Cette app se connecte par autorisation dans le navigateur.");
  return enSerie(async () => {
    const liste = await lire();
    const { nom, url } = cible(liste, { nom: entree.nom, url: entree.url });
    const jeton = String(entree.jeton ?? "").trim();
    if (jeton) verifierCoffre();
    const nouvelle = poser(liste, { id: randomUUID(), app: null, nom, url, jeton: jeton ? chiffrer(jeton) : null });
    await ecrire(nouvelle);
    return nouvelle.map(vue);
  });
}

const dependances = (): DependancesOAuth => ({ fetch: globalThis.fetch, ouvrir: (url) => shell.openExternal(url) });
let enCours: AbortController | null = null;

/**
 * Connecte une app connue, un serveur saisi à la main, ou reconnecte une entrée
 * (`remplace`, aussi pour passer un ancien jeton à l'autorisation) : ouvre le
 * navigateur sur la page d'autorisation du serveur et attend le retour. Un ancien
 * jeton n'est remplacé qu'une fois l'autorisation obtenue.
 */
export async function connecterMcpDirect(entree: { app?: string | null; nom?: string; url?: string; remplace?: string }): Promise<ResultatConnexion> {
  if (enCours) throw new Error("Une autorisation est déjà en cours dans le navigateur.");
  const controle = new AbortController();
  enCours = controle;
  try {
    const avant = cible(await lire(), entree);
    if (avant.connue?.via === "composio") throw new Error(`${avant.connue.nom} se connecte par Composio.`);
    const d = dependances();
    const decouverte = await decouvrir(d, avant.url);
    const sansOAuth = async (): Promise<ResultatConnexion> => {
      if (avant.connue || avant.ancien) throw new Error(`${avant.nom} ne propose pas d’autorisation par le navigateur.`);
      return { statut: "sans-oauth", liste: (await lire()).map(vue) };
    };
    if (decouverte.type === "sans-oauth" || decouverte.type === "sans-inscription") return await sansOAuth();
    let oauth: OAuthStocke | null = null;
    if (decouverte.type === "oauth") {
      verifierCoffre();
      const connexion = await autoriser({ ...d, signal: controle.signal }, decouverte, avant.nom);
      if (!connexion) return { statut: "annule", liste: (await lire()).map(vue) };
      oauth = stocker(connexion);
    }
    return await enSerie(async () => {
      const liste = await lire();
      // Relu après le navigateur : la liste a pu changer entre-temps.
      const { ancien, app: appId, nom, url } = cible(liste, entree);
      const nouvelle = poser(liste, { id: ancien?.id ?? randomUUID(), app: appId, nom, url, jeton: null, oauth });
      await ecrire(nouvelle);
      return { statut: "connecte" as const, liste: nouvelle.map(vue) };
    });
  } finally {
    if (enCours === controle) enCours = null;
  }
}

export function annulerMcpDirect(): void {
  enCours?.abort();
}

export async function retirerMcpDirect(id: string): Promise<McpDirect[]> {
  return enSerie(async () => {
    const liste = (await lire()).filter((m) => m.id !== id);
    await ecrire(liste);
    return liste.map(vue);
  });
}

/** Un jeton qui expire avant cette marge est renouvelé. */
const MARGE_MS = 5 * 60 * 1000;

/** Renouvelle les accès OAuth qui expirent bientôt. Un refus du serveur marque l'entrée « à reconnecter » ; une panne réseau réessaie plus tard. */
export function renouvelerMcpDirects(): Promise<void> {
  const proches = cache.filter((m) => m.oauth && !m.expire && m.oauth.expireLe !== null && m.oauth.expireLe - Date.now() < MARGE_MS);
  if (!proches.length) return Promise.resolve();
  return enSerie(async () => {
    let liste = await lire();
    let change = false;
    for (const p of proches) {
      const m = liste.find((x) => x.id === p.id);
      if (!m?.oauth || m.expire) continue;
      try {
        const neuve = await renouveler(dependances(), relireConnexion(m.oauth));
        liste = poser(liste, { ...m, oauth: stocker(neuve) });
        change = true;
      } catch (e) {
        if (!(e instanceof RefusOAuth)) continue;
        liste = poser(liste, { ...m, expire: true });
        change = true;
      }
    }
    if (change) await ecrire(liste);
  }).catch(() => {});
}

/** Le nom du serveur côté Claude Code : ses outils s'appellent `mcp__<nom>__…`. */
function nomServeur(m: McpStocke): string {
  return m.app ?? `mcp-${m.id.slice(0, 8)}`;
}

/** Les serveurs à ajouter à la configuration MCP d'un agent. Un secret illisible ou un accès expiré écarte son serveur. */
export function serveursMcpDirects(): Record<string, { type: "http"; url: string; headers?: Record<string, string> }> {
  const serveurs: Record<string, { type: "http"; url: string; headers?: Record<string, string> }> = {};
  let renouveler = false;
  for (const m of cache) {
    let jeton: string | null = null;
    try {
      if (m.oauth) {
        if (m.expire) continue;
        if (m.oauth.expireLe !== null && m.oauth.expireLe - Date.now() < MARGE_MS) renouveler = true;
        if (m.oauth.expireLe !== null && m.oauth.expireLe - Date.now() <= 30_000) continue;
        jeton = dechiffrer(m.oauth.acces);
      } else if (m.jeton) jeton = dechiffrer(m.jeton);
    } catch {
      continue;
    }
    serveurs[nomServeur(m)] = { type: "http", url: m.url, ...(jeton ? { headers: { Authorization: `Bearer ${jeton}` } } : {}) };
  }
  if (renouveler) void renouvelerMcpDirects();
  return serveurs;
}
