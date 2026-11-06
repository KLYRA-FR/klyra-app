import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * L'OAuth des serveurs MCP distants (spécification MCP, autorisation) pour les
 * apps en direct de la Marketplace : découverte (WWW-Authenticate, puis
 * .well-known de la ressource et du serveur d'autorisation), inscription
 * dynamique du client, PKCE (S256), indicateur de ressource, retour sur une
 * adresse locale (127.0.0.1) et jetons renouvelables. La personne clique
 * « Autoriser » dans son navigateur : elle n'a jamais de jeton à copier.
 *
 * Module pur : ni Electron ni disque. Main lui donne le réseau et le navigateur.
 */

/** Le temps laissé pour autoriser dans le navigateur. */
const DELAI_CONNEXION_MS = 5 * 60 * 1000;

export type MethodeClient = "none" | "client_secret_post" | "client_secret_basic";

export interface ServeurAutorisation {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  methodes: string[];
}

export type Decouverte =
  /** Le serveur répond sans autorisation. */
  | { type: "ouvert" }
  | { type: "oauth"; resource: string; scope: string | null; serveur: ServeurAutorisation }
  /** OAuth, mais sans inscription dynamique : il faudrait une app OAuth créée chez l'éditeur. */
  | { type: "sans-inscription" }
  /** Ni OAuth découvrable ni accès libre. */
  | { type: "sans-oauth" };

/** Ce qu'il faut garder d'une connexion pour s'en servir et la renouveler. */
export interface ConnexionOAuth {
  clientId: string;
  secret: string | null;
  methode: MethodeClient;
  tokenEndpoint: string;
  resource: string;
  acces: string;
  renouvellement: string | null;
  /** `null` : le serveur n'a pas donné de durée. */
  expireLe: number | null;
}

export interface DependancesOAuth {
  fetch: typeof fetch;
  ouvrir: (url: string) => Promise<void> | void;
  maintenant?: () => number;
}

/** Un refus du serveur d'autorisation (jeton de renouvellement révoqué…), à distinguer d'une panne réseau. */
export class RefusOAuth extends Error {}

const base64url = (b: Buffer) => b.toString("base64url");

/** Toute adresse OAuth reçue doit être en https (un serveur local seulement pour les tests et le développement). */
export function adresseSure(v: unknown): string {
  const u = new URL(String(v));
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error("Le serveur a renvoyé une adresse non sécurisée.");
  return u.toString();
}

async function json(d: DependancesOAuth, url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await d.fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const v = (await r.json()) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Lit `resource_metadata` et `scope` d'un en-tête WWW-Authenticate Bearer. */
export function lireDefi(entete: string | null): { metadonnees: string | null; scope: string | null } {
  const valeur = (cle: string) => entete?.match(new RegExp(`${cle}="([^"]*)"`))?.[1] ?? null;
  return { metadonnees: valeur("resource_metadata"), scope: valeur("scope") };
}

/** Les adresses .well-known d'un serveur d'autorisation, dans l'ordre de la spécification MCP. */
export function adressesServeur(emetteur: string): string[] {
  const u = new URL(emetteur);
  const chemin = u.pathname.replace(/\/$/, "");
  if (!chemin) return [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
  return [`${u.origin}/.well-known/oauth-authorization-server${chemin}`, `${u.origin}/.well-known/openid-configuration${chemin}`, `${u.origin}${chemin}/.well-known/openid-configuration`];
}

async function serveurAutorisation(d: DependancesOAuth, emetteur: string): Promise<Record<string, unknown> | null> {
  for (const adresse of adressesServeur(emetteur)) {
    const m = await json(d, adresse);
    if (m && typeof m.authorization_endpoint === "string" && typeof m.token_endpoint === "string") return m;
  }
  return null;
}

/** Ce que le serveur MCP à cette adresse attend pour s'y connecter. */
export async function decouvrir(d: DependancesOAuth, url: string): Promise<Decouverte> {
  const cible = new URL(url);
  let defi: { metadonnees: string | null; scope: string | null } = { metadonnees: null, scope: null };
  try {
    const r = await d.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "KLYRA", version: "1" } } }),
    });
    await r.body?.cancel().catch(() => {});
    if (r.ok) return { type: "ouvert" };
    defi = lireDefi(r.headers.get("www-authenticate"));
  } catch {
    throw new Error("Ce serveur ne répond pas. Vérifie l’adresse.");
  }

  const chemin = cible.pathname.replace(/\/$/, "");
  const candidats = [defi.metadonnees, chemin ? `${cible.origin}/.well-known/oauth-protected-resource${chemin}` : null, `${cible.origin}/.well-known/oauth-protected-resource`];
  let ressource: Record<string, unknown> | null = null;
  for (const c of candidats) {
    if (!c) continue;
    try { adresseSure(c); } catch { continue; }
    ressource = await json(d, c);
    if (ressource) break;
  }

  let emetteur: string;
  let resource = url;
  let scope = defi.scope;
  if (ressource) {
    const serveurs = Array.isArray(ressource.authorization_servers) ? ressource.authorization_servers : [];
    if (typeof serveurs[0] !== "string") return { type: "sans-oauth" };
    emetteur = adresseSure(serveurs[0]);
    if (typeof ressource.resource === "string") {
      // La ressource annoncée doit être ce serveur, pas un autre.
      if (new URL(ressource.resource).origin !== cible.origin) throw new Error("Ce serveur annonce une autorisation pour un autre site.");
      resource = ressource.resource;
    }
    if (!scope && Array.isArray(ressource.scopes_supported) && ressource.scopes_supported.every((s) => typeof s === "string") && ressource.scopes_supported.length) {
      scope = (ressource.scopes_supported as string[]).join(" ");
    }
  } else {
    // Ancienne version de la spécification : le serveur d'autorisation à l'origine du serveur MCP.
    emetteur = cible.origin;
  }

  const m = await serveurAutorisation(d, emetteur);
  if (!m) return { type: "sans-oauth" };
  if (typeof m.registration_endpoint !== "string") return { type: "sans-inscription" };
  const pkce = Array.isArray(m.code_challenge_methods_supported) ? m.code_challenge_methods_supported : null;
  if (pkce && !pkce.includes("S256")) return { type: "sans-oauth" };
  return {
    type: "oauth",
    resource,
    scope,
    serveur: {
      authorization_endpoint: adresseSure(m.authorization_endpoint),
      token_endpoint: adresseSure(m.token_endpoint),
      registration_endpoint: adresseSure(m.registration_endpoint),
      methodes: Array.isArray(m.token_endpoint_auth_methods_supported) ? m.token_endpoint_auth_methods_supported.filter((v): v is string => typeof v === "string") : ["client_secret_basic"],
    },
  };
}

/** Un client public si le serveur l'accepte, sinon un client avec secret. */
export function methodeDemandee(methodes: string[]): MethodeClient {
  if (methodes.includes("none")) return "none";
  if (methodes.includes("client_secret_post")) return "client_secret_post";
  return "client_secret_basic";
}

async function demanderJeton(d: DependancesOAuth, c: Pick<ConnexionOAuth, "clientId" | "secret" | "methode" | "tokenEndpoint">, corps: Record<string, string>): Promise<Record<string, unknown>> {
  const entetes: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const parametres = { ...corps, client_id: c.clientId };
  if (c.methode === "client_secret_basic" && c.secret) entetes.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.secret)}`).toString("base64")}`;
  if (c.methode === "client_secret_post" && c.secret) Object.assign(parametres, { client_secret: c.secret });
  const r = await d.fetch(c.tokenEndpoint, { method: "POST", headers: entetes, body: new URLSearchParams(parametres).toString() });
  const v = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || typeof v.access_token !== "string") throw new RefusOAuth("Le serveur n’a pas accordé l’accès. Reconnecte-le.");
  return v;
}

function garder(d: DependancesOAuth, c: Omit<ConnexionOAuth, "acces" | "renouvellement" | "expireLe">, v: Record<string, unknown>, ancien: string | null): ConnexionOAuth {
  const maintenant = d.maintenant?.() ?? Date.now();
  return {
    ...c,
    acces: v.access_token as string,
    renouvellement: typeof v.refresh_token === "string" ? v.refresh_token : ancien,
    expireLe: typeof v.expires_in === "number" && v.expires_in > 0 ? maintenant + v.expires_in * 1000 : null,
  };
}

const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Inscrit KLYRA chez le serveur d'autorisation, ouvre le navigateur sur sa page
 * d'autorisation et attend le retour. `null` si la personne annule, refuse ou
 * laisse passer le délai.
 */
export async function autoriser(
  d: DependancesOAuth & { signal?: AbortSignal; delaiMs?: number },
  decouverte: Extract<Decouverte, { type: "oauth" }>,
  nom: string,
): Promise<ConnexionOAuth | null> {
  let serveur: Server | null = null;
  let liberer: (v: { code: string | null; erreur?: string }) => void = () => {};
  const retour = new Promise<{ code: string | null; erreur?: string }>((r) => { liberer = r; });
  const annuler = () => liberer({ code: null });
  d.signal?.addEventListener("abort", annuler);
  const minuterie = setTimeout(() => liberer({ code: null, erreur: "L’autorisation n’a pas été terminée dans le navigateur." }), d.delaiMs ?? DELAI_CONNEXION_MS);
  try {
    if (d.signal?.aborted) return null;
    const etat = base64url(randomBytes(24));
    const verificateur = base64url(randomBytes(48));
    serveur = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/callback" || u.searchParams.get("state") !== etat) { res.writeHead(404).end(); return; }
      const code = u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>KLYRA</title><body style="font-family:sans-serif;padding:48px"><p>${code ? `${echapper(nom)} est connecté. Tu peux fermer cet onglet et revenir dans KLYRA.` : "L’autorisation n’a pas abouti. Recommence depuis KLYRA."}</p></body>`);
      liberer(code ? { code } : { code: null, erreur: "L’autorisation a été refusée." });
    });
    await new Promise<void>((r) => serveur!.listen(0, "127.0.0.1", r));
    const redirection = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/callback`;

    const s = decouverte.serveur;
    const methode = methodeDemandee(s.methodes);
    const inscription = await d.fetch(s.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_name: "KLYRA", redirect_uris: [redirection], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: methode, ...(decouverte.scope ? { scope: decouverte.scope } : {}) }),
    });
    const client = (await inscription.json().catch(() => ({}))) as { client_id?: unknown; client_secret?: unknown; token_endpoint_auth_method?: unknown };
    if (!inscription.ok || typeof client.client_id !== "string") throw new Error(`${nom} refuse d’inscrire KLYRA. Réessaie plus tard.`);
    const secret = typeof client.client_secret === "string" ? client.client_secret : null;
    const accordee = ["none", "client_secret_post", "client_secret_basic"].includes(client.token_endpoint_auth_method as string) ? client.token_endpoint_auth_method as MethodeClient : secret ? (methode === "none" ? "client_secret_post" : methode) : "none";
    const base = { clientId: client.client_id, secret, methode: accordee, tokenEndpoint: s.token_endpoint, resource: decouverte.resource };

    const autorisation = new URL(s.authorization_endpoint);
    for (const [k, v] of Object.entries({
      response_type: "code", client_id: client.client_id, redirect_uri: redirection, state: etat,
      code_challenge: base64url(createHash("sha256").update(verificateur).digest()), code_challenge_method: "S256", resource: decouverte.resource,
      ...(decouverte.scope ? { scope: decouverte.scope } : {}),
    })) autorisation.searchParams.set(k, v);
    await d.ouvrir(autorisation.toString());

    const { code, erreur } = await retour;
    if (!code) {
      if (erreur && !d.signal?.aborted) throw new Error(erreur);
      return null;
    }
    const v = await demanderJeton(d, base, { grant_type: "authorization_code", code, redirect_uri: redirection, code_verifier: verificateur, resource: decouverte.resource });
    return garder(d, base, v, null);
  } finally {
    clearTimeout(minuterie);
    d.signal?.removeEventListener("abort", annuler);
    serveur?.close();
  }
}

/** Renouvelle le jeton d'accès. `RefusOAuth` si le serveur refuse (connexion à refaire). */
export async function renouveler(d: DependancesOAuth, c: ConnexionOAuth): Promise<ConnexionOAuth> {
  if (!c.renouvellement) throw new RefusOAuth("Ce serveur ne renouvelle pas l’accès. Reconnecte-le.");  const v = await demanderJeton(d, c, { grant_type: "refresh_token", refresh_token: c.renouvellement, resource: c.resource });
  const base = { clientId: c.clientId, secret: c.secret, methode: c.methode, tokenEndpoint: c.tokenEndpoint, resource: c.resource };
  return garder(d, base, v, c.renouvellement);
}
