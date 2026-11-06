import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { adressesServeur, autoriser, decouvrir, lireDefi, methodeDemandee, RefusOAuth, renouveler, type Decouverte } from "./mcp-oauth.ts";

/**
 * L'OAuth des serveurs MCP (electron/mcp-oauth.ts) contre de faux serveurs, sur
 * les profils relevés le 06/11/2026 : Linear (défi avec scope, client public),
 * Stripe (serveur d'autorisation avec chemin), Supabase (client avec secret),
 * GitHub (pas d'inscription dynamique). Le retour du navigateur passe par la
 * vraie adresse locale.
 *   node --experimental-strip-types --test electron/mcp-oauth.test.mts
 */

type Route = (u: URL, init: RequestInit, corps: Record<string, string> | null) => Response | null;
type Appel = { url: URL; methode: string; corps: Record<string, string> | null; entetes: Record<string, string> };

function fauxReseau(routes: Route) {
  const appels: Appel[] = [];
  const fetch = (async (entree: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(entree));
    const entetes = (init.headers ?? {}) as Record<string, string>;
    const type = entetes["Content-Type"] ?? "";
    const corps = typeof init.body === "string" ? (type.includes("json") ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : null;
    appels.push({ url, methode: init.method ?? "GET", corps, entetes });
    return routes(url, init, corps) ?? new Response("introuvable", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, appels };
}

const non = () => new Response("", { status: 401 });

/** Le profil Linear : défi avec resource_metadata et scope, serveur d'autorisation à la même origine. */
const linear: Route = (u, _init, corps) => {
  if (u.href === "https://mcp.linear.app/mcp") return new Response("", { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="OAuth", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp", scope="read write"' } });
  if (u.pathname === "/.well-known/oauth-protected-resource/mcp") return Response.json({ resource: "https://mcp.linear.app/mcp", authorization_servers: ["https://mcp.linear.app"], scopes_supported: ["read", "write"] });
  if (u.pathname === "/.well-known/oauth-authorization-server") return Response.json({ authorization_endpoint: "https://mcp.linear.app/authorize", token_endpoint: "https://mcp.linear.app/token", registration_endpoint: "https://mcp.linear.app/register", code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"] });
  if (u.pathname === "/register") return Response.json({ client_id: "client_linear", token_endpoint_auth_method: "none" }, { status: 201 });
  if (u.pathname === "/token" && corps?.grant_type === "authorization_code") return Response.json({ access_token: "acces_1", refresh_token: "renouv_1", expires_in: 3600 });
  if (u.pathname === "/token" && corps?.grant_type === "refresh_token") return corps.refresh_token === "renouv_1" ? Response.json({ access_token: "acces_2", expires_in: 3600 }) : Response.json({ error: "invalid_grant" }, { status: 400 });
  return null;
};

/** Ce que fait le navigateur : il suit l'adresse d'autorisation jusqu'au retour local. */
function navigateur(reponse: (autorisation: URL) => Record<string, string>) {
  const vues: URL[] = [];
  const ouvrir = async (adresse: string) => {
    const a = new URL(adresse);
    vues.push(a);
    const retour = new URL(a.searchParams.get("redirect_uri")!);
    for (const [k, v] of Object.entries(reponse(a))) retour.searchParams.set(k, v);
    setTimeout(() => void globalThis.fetch(retour).then((r) => r.text()), 10);
  };
  return { ouvrir, vues };
}

test("le défi WWW-Authenticate se lit", () => {
  assert.deepEqual(lireDefi('Bearer resource_metadata="https://x.test/.well-known/oauth-protected-resource", scope="a b"'), { metadonnees: "https://x.test/.well-known/oauth-protected-resource", scope: "a b" });
  assert.deepEqual(lireDefi(null), { metadonnees: null, scope: null });
});

test("adresses .well-known d'un serveur d'autorisation avec ou sans chemin", () => {
  assert.deepEqual(adressesServeur("https://mcp.linear.app"), ["https://mcp.linear.app/.well-known/oauth-authorization-server", "https://mcp.linear.app/.well-known/openid-configuration"]);
  assert.deepEqual(adressesServeur("https://access.stripe.com/mcp"), ["https://access.stripe.com/.well-known/oauth-authorization-server/mcp", "https://access.stripe.com/.well-known/openid-configuration/mcp", "https://access.stripe.com/mcp/.well-known/openid-configuration"]);
});

test("méthode du client : public si possible", () => {
  assert.equal(methodeDemandee(["client_secret_basic", "none"]), "none");
  assert.equal(methodeDemandee(["client_secret_basic", "client_secret_post"]), "client_secret_post");
  assert.equal(methodeDemandee([]), "client_secret_basic");
});

test("découverte Linear : ressource, scope du défi, inscription", async () => {
  const { fetch } = fauxReseau(linear);
  const d = await decouvrir({ fetch, ouvrir: () => {} }, "https://mcp.linear.app/mcp");
  assert.equal(d.type, "oauth");
  assert.ok(d.type === "oauth");
  assert.equal(d.resource, "https://mcp.linear.app/mcp");
  assert.equal(d.scope, "read write");
  assert.equal(d.serveur.registration_endpoint, "https://mcp.linear.app/register");
});

test("découverte Stripe : ressource à la racine, serveur d'autorisation avec chemin", async () => {
  const { fetch, appels } = fauxReseau((u) => {
    if (u.href === "https://mcp.stripe.com/") return new Response("", { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.stripe.com/.well-known/oauth-protected-resource"' } });
    if (u.href === "https://mcp.stripe.com/.well-known/oauth-protected-resource") return Response.json({ resource: "https://mcp.stripe.com", authorization_servers: ["https://access.stripe.com/mcp"], scopes_supported: ["mcp"] });
    if (u.href === "https://access.stripe.com/.well-known/oauth-authorization-server/mcp") return Response.json({ authorization_endpoint: "https://access.stripe.com/mcp/oauth2/authorize", token_endpoint: "https://access.stripe.com/mcp/oauth2/token", registration_endpoint: "https://access.stripe.com/mcp/oauth2/register", code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
    return null;
  });
  const d = await decouvrir({ fetch, ouvrir: () => {} }, "https://mcp.stripe.com");
  assert.ok(d.type === "oauth");
  assert.equal(d.resource, "https://mcp.stripe.com");
  assert.equal(d.scope, "mcp", "sans scope dans le défi : ceux de la ressource");
  assert.equal(d.serveur.token_endpoint, "https://access.stripe.com/mcp/oauth2/token");
  assert.equal(appels[0].methode, "POST", "la sonde est une vraie requête initialize");
});

test("découverte GitHub : OAuth sans inscription dynamique", async () => {
  const { fetch } = fauxReseau((u) => {
    if (u.href === "https://api.githubcopilot.com/mcp/") return new Response("", { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_request", resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"' } });
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp/") return Response.json({ resource: "https://api.githubcopilot.com/mcp/", authorization_servers: ["https://github.com/login/oauth"] });
    if (u.href === "https://github.com/.well-known/oauth-authorization-server/login/oauth") return Response.json({ authorization_endpoint: "https://github.com/login/oauth/authorize", token_endpoint: "https://github.com/login/oauth/access_token", code_challenge_methods_supported: ["S256"] });
    return null;
  });
  assert.deepEqual(await decouvrir({ fetch, ouvrir: () => {} }, "https://api.githubcopilot.com/mcp/"), { type: "sans-inscription" });
});

test("découverte : serveur ouvert, serveur sans OAuth, serveur injoignable", async () => {
  const ouvert = fauxReseau((u) => (u.hostname === "ouvert.test" ? Response.json({ jsonrpc: "2.0", id: 1, result: {} }) : null));
  assert.deepEqual(await decouvrir({ fetch: ouvert.fetch, ouvrir: () => {} }, "https://ouvert.test/mcp"), { type: "ouvert" });
  const ferme = fauxReseau((u) => (u.pathname === "/mcp" ? non() : null));
  assert.deepEqual(await decouvrir({ fetch: ferme.fetch, ouvrir: () => {} }, "https://ferme.test/mcp"), { type: "sans-oauth" });
  const panne = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(decouvrir({ fetch: panne, ouvrir: () => {} }, "https://panne.test/mcp"), /ne répond pas/);
});

test("découverte : une ressource annoncée pour un autre site, ou une adresse en http, est refusée", async () => {
  const autre = fauxReseau((u) => {
    if (u.pathname === "/mcp") return new Response("", { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://piege.test/.well-known/oauth-protected-resource"' } });
    if (u.hostname === "piege.test") return Response.json({ resource: "https://piege.test/mcp", authorization_servers: ["https://piege.test"] });
    return null;
  });
  await assert.rejects(decouvrir({ fetch: autre.fetch, ouvrir: () => {} }, "https://vrai.test/mcp"), /autre site/);
  const clair = fauxReseau((u) => {
    if (u.pathname === "/mcp") return non();
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp") return Response.json({ resource: "https://clair.test/mcp", authorization_servers: ["http://as.clair.test"] });
    return null;
  });
  await assert.rejects(decouvrir({ fetch: clair.fetch, ouvrir: () => {} }, "https://clair.test/mcp"), /non sécurisée/);
});

test("autorisation complète : inscription publique, PKCE, ressource, retour local", async () => {
  const { fetch, appels } = fauxReseau(linear);
  const d = await decouvrir({ fetch, ouvrir: () => {} }, "https://mcp.linear.app/mcp");
  assert.ok(d.type === "oauth");
  let defi = "";
  const nav = navigateur((a) => { defi = a.searchParams.get("code_challenge")!; return { code: "code_ok", state: a.searchParams.get("state")! }; });
  const c = await autoriser({ fetch, ouvrir: nav.ouvrir, maintenant: () => 1_000 }, d, "Linear");
  assert.ok(c);
  assert.deepEqual({ ...c }, { clientId: "client_linear", secret: null, methode: "none", tokenEndpoint: "https://mcp.linear.app/token", resource: "https://mcp.linear.app/mcp", acces: "acces_1", renouvellement: "renouv_1", expireLe: 1_000 + 3_600_000 });
  const a = nav.vues[0];
  assert.equal(a.origin + a.pathname, "https://mcp.linear.app/authorize");
  assert.equal(a.searchParams.get("code_challenge_method"), "S256");
  assert.equal(a.searchParams.get("resource"), "https://mcp.linear.app/mcp");
  assert.equal(a.searchParams.get("scope"), "read write");
  assert.match(a.searchParams.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const inscription = appels.find((x) => x.url.pathname === "/register")!;
  assert.equal(inscription.corps!.token_endpoint_auth_method, "none");
  assert.deepEqual(inscription.corps!.redirect_uris, [a.searchParams.get("redirect_uri")]);
  const jeton = appels.find((x) => x.url.pathname === "/token")!;
  assert.equal(createHash("sha256").update(jeton.corps!.code_verifier).digest("base64url"), defi, "le vérificateur correspond au défi");
  assert.equal(jeton.corps!.resource, "https://mcp.linear.app/mcp");
  assert.equal(jeton.corps!.client_secret, undefined);
});

test("client avec secret (profil Supabase) : le secret part dans la demande de jeton", async () => {
  const { fetch, appels } = fauxReseau((u, _i, corps) => {
    if (u.pathname === "/mcp") return new Response("", { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.supabase.test/.well-known/oauth-protected-resource/mcp"' } });
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp") return Response.json({ resource: "https://mcp.supabase.test/mcp", authorization_servers: ["https://api.supabase.test"], scopes_supported: ["projects:read"] });
    if (u.href === "https://api.supabase.test/.well-known/oauth-authorization-server") return Response.json({ authorization_endpoint: "https://api.supabase.test/v1/oauth/authorize", token_endpoint: "https://api.supabase.test/v1/oauth/token", registration_endpoint: "https://api.supabase.test/register", code_challenge_methods_supported: ["S256", "plain"], token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"] });
    if (u.pathname === "/register") return Response.json({ client_id: "client_supa", client_secret: "secret_supa" }, { status: 201 });
    if (u.pathname === "/v1/oauth/token") return corps?.client_secret === "secret_supa" ? Response.json({ access_token: "acces_supa", refresh_token: "r" }) : Response.json({ error: "invalid_client" }, { status: 401 });
    return null;
  });
  const d = await decouvrir({ fetch, ouvrir: () => {} }, "https://mcp.supabase.test/mcp");
  assert.ok(d.type === "oauth");
  const nav = navigateur((a) => ({ code: "c", state: a.searchParams.get("state")! }));
  const c = await autoriser({ fetch, ouvrir: nav.ouvrir }, d, "Supabase");
  assert.equal(c?.methode, "client_secret_post");
  assert.equal(c?.secret, "secret_supa");
  assert.equal(c?.expireLe, null, "sans durée annoncée : pas d'expiration supposée");
  assert.equal(appels.find((x) => x.url.pathname === "/register")!.corps!.token_endpoint_auth_method, "client_secret_post");
});

test("refus dans le navigateur, mauvais état ignoré, annulation", async () => {
  const { fetch } = fauxReseau(linear);
  const d = (await decouvrir({ fetch, ouvrir: () => {} }, "https://mcp.linear.app/mcp")) as Extract<Decouverte, { type: "oauth" }>;
  const refus = navigateur((a) => ({ error: "access_denied", state: a.searchParams.get("state")! }));
  await assert.rejects(autoriser({ fetch, ouvrir: refus.ouvrir }, d, "Linear"), /refusée/);

  const mauvais = navigateur(() => ({ code: "volé", state: "faux" }));
  assert.equal(await autoriser({ fetch, ouvrir: mauvais.ouvrir, delaiMs: 300 }, d, "Linear").catch((e: Error) => e.message), "L’autorisation n’a pas été terminée dans le navigateur.");

  const controle = new AbortController();
  const attente = autoriser({ fetch, ouvrir: () => { setTimeout(() => controle.abort(), 20); }, signal: controle.signal }, d, "Linear");
  assert.equal(await attente, null);
});

test("renouvellement : nouveau jeton, ancien jeton de renouvellement gardé ; refus distingué d'une panne", async () => {
  const { fetch } = fauxReseau(linear);
  const base = { clientId: "client_linear", secret: null, methode: "none" as const, tokenEndpoint: "https://mcp.linear.app/token", resource: "https://mcp.linear.app/mcp", acces: "acces_1", renouvellement: "renouv_1", expireLe: 0 };
  const neuve = await renouveler({ fetch, ouvrir: () => {}, maintenant: () => 5_000 }, base);
  assert.equal(neuve.acces, "acces_2");
  assert.equal(neuve.renouvellement, "renouv_1");
  assert.equal(neuve.expireLe, 5_000 + 3_600_000);
  await assert.rejects(renouveler({ fetch, ouvrir: () => {} }, { ...base, renouvellement: "revoque" }), RefusOAuth);
  await assert.rejects(renouveler({ fetch, ouvrir: () => {} }, { ...base, renouvellement: null }), RefusOAuth);
  const panne = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(renouveler({ fetch: panne, ouvrir: () => {} }, base), (e) => !(e instanceof RefusOAuth));
});
