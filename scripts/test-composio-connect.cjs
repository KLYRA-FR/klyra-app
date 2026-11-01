/**
 * Composio Connect (electron/composio-connect.ts) : le flux OAuth complet contre
 * un faux Composio. Le retour du navigateur passe par la vraie adresse locale.
 *   pnpm build:electron && node scripts/test-composio-connect.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Test Node CommonJS. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { ComposioConnect, URL_CONNECT } = require("../dist-electron/composio-connect.js");

const DECOUVERTE = { authorization_endpoint: "https://connect.composio.dev/oauth/authorize", token_endpoint: "https://login.composio.dev/oauth2/token", registration_endpoint: "https://login.composio.dev/oauth2/register" };
const idToken = (email) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
let total = 0;
async function verifier(nom, fn) { await fn(); total++; console.log(`OK ${nom}`); }

/** Un faux Composio : il note les appels et rend les réponses prévues. */
function faux({ refus = false, decouverte = DECOUVERTE } = {}) {
  const appels = [];
  const stockage = { jetons: null, ecritures: 0 };
  let horloge = 1_000_000;
  let defi = null;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const corps = init.body ? (init.headers["Content-Type"].includes("json") ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : null;
    appels.push({ url: u, methode: init.method ?? "GET", corps });
    if (u.pathname.endsWith("/oauth-authorization-server")) return Response.json(decouverte);
    if (u.pathname === "/oauth2/register") return Response.json({ client_id: "client_klyra" }, { status: 201 });
    if (u.pathname === "/oauth2/token") {
      if (refus) return Response.json({ error: "invalid_grant" }, { status: 400 });
      if (corps.grant_type === "authorization_code") {
        assert.equal(createHash("sha256").update(corps.code_verifier).digest("base64url"), defi, "PKCE : le vérificateur correspond au défi");
        assert.equal(corps.code, "code_ok");
        return Response.json({ access_token: "acces_1", refresh_token: "renouv_1", expires_in: 3600, id_token: idToken("corentin@example.test") });
      }
      if (corps.grant_type === "refresh_token") return Response.json({ access_token: "acces_2", expires_in: 3600 });
    }
    throw new Error(`Appel inattendu : ${url}`);
  };
  /** Le « navigateur » : il suit l'adresse de Composio jusqu'au retour local. */
  let reponseNavigateur = { code: "code_ok", etatFaux: false };
  const ouverts = [];
  const ouvrir = async (adresse) => {
    const u = new URL(adresse);
    ouverts.push(u);
    defi = u.searchParams.get("code_challenge");
    const retour = new URL(u.searchParams.get("redirect_uri"));
    if (reponseNavigateur.etatFaux) {
      const r = await globalThis.fetch(`${retour}?code=code_vole&state=autre`);
      reponseNavigateur.pageFaux = await r.text();
    }
    if (reponseNavigateur.code) setTimeout(() => void globalThis.fetch(`${retour}?code=${reponseNavigateur.code}&state=${u.searchParams.get("state")}`), 10);
  };
  const connect = new ComposioConnect({
    fetch, ouvrir,
    lire: async () => stockage.jetons,
    ecrire: async (j) => { stockage.jetons = j; stockage.ecritures++; },
    maintenant: () => horloge,
  });
  return { connect, appels, stockage, ouverts, avancer: (ms) => { horloge += ms; }, navigateur: (r) => { reponseNavigateur = r; } };
}

(async () => {
  await verifier("connexion complète : inscription, PKCE S256, retour local, jetons gardés", async () => {
    const f = faux();
    assert.equal(await f.connect.connecter(), true);
    const inscription = f.appels.find((a) => a.url.pathname === "/oauth2/register");
    assert.equal(inscription.corps.token_endpoint_auth_method, "none");
    assert.match(inscription.corps.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const page = f.ouverts[0];
    assert.equal(page.origin + page.pathname, DECOUVERTE.authorization_endpoint);
    assert.equal(page.searchParams.get("code_challenge_method"), "S256");
    assert.equal(page.searchParams.get("resource"), URL_CONNECT);
    assert.ok(page.searchParams.get("state").length >= 24);
    assert.match(page.searchParams.get("scope"), /offline_access/);
    assert.deepEqual(f.connect.etat(), { connecte: true, compte: "corentin@example.test", enCours: false, erreur: null });
    assert.equal(f.stockage.jetons.acces, "acces_1");
    assert.deepEqual(f.connect.serveur(), { type: "http", url: URL_CONNECT, headers: { Authorization: "Bearer acces_1" } });
  });

  await verifier("retour avec un autre state ignoré : seul le bon code est échangé", async () => {
    const f = faux();
    f.navigateur({ code: "code_ok", etatFaux: true });
    assert.equal(await f.connect.connecter(), true);
    const echanges = f.appels.filter((a) => a.corps?.grant_type === "authorization_code");
    assert.equal(echanges.length, 1);
    assert.equal(echanges[0].corps.code, "code_ok");
  });

  await verifier("annuler pendant l’attente : rien d’échangé ni d’écrit, pas d’erreur affichée", async () => {
    const f = faux();
    f.navigateur({ code: null });
    const attente = f.connect.connecter();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(f.connect.etat().enCours, true);
    f.connect.annuler();
    assert.equal(await attente, false);
    assert.equal(f.stockage.ecritures, 0);
    assert.deepEqual(f.connect.etat(), { connecte: false, compte: null, enCours: false, erreur: null });
    assert.equal(f.connect.serveur(), null);
  });

  await verifier("une seule connexion à la fois", async () => {
    const f = faux();
    f.navigateur({ code: null });
    const attente = f.connect.connecter();
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(f.connect.connecter(), /déjà en cours/);
    f.connect.annuler();
    await attente;
  });

  await verifier("adresse OAuth hors de composio.dev refusée avant d’ouvrir le navigateur", async () => {
    const f = faux({ decouverte: { ...DECOUVERTE, authorization_endpoint: "https://piege.example/oauth" } });
    await assert.rejects(f.connect.connecter(), /adresse inattendue/);
    assert.equal(f.ouverts.length, 0);
    assert.equal(f.connect.etat().erreur, "Composio a renvoyé une adresse inattendue.");
  });

  await verifier("jeton bientôt expiré : renouvelé avec le refresh_token, compte conservé", async () => {
    const f = faux();
    await f.connect.connecter();
    f.avancer(3600_000 - 60_000);
    await f.connect.renouvelerSiBesoin();
    const r = f.appels.find((a) => a.corps?.grant_type === "refresh_token");
    assert.equal(r.corps.refresh_token, "renouv_1");
    assert.equal(r.corps.client_id, "client_klyra");
    assert.equal(f.stockage.jetons.acces, "acces_2");
    assert.equal(f.stockage.jetons.renouvellement, "renouv_1");
    assert.equal(f.connect.etat().compte, "corentin@example.test");
  });

  await verifier("jeton expiré : aucun serveur donné aux agents", async () => {
    const f = faux();
    await f.connect.connecter();
    f.avancer(3600_000);
    assert.equal(f.connect.serveur(), null);
  });

  await verifier("renouvellement refusé : déconnexion et message clair", async () => {
    const refus = faux({ refus: true });
    refus.stockage.jetons = { clientId: "client_klyra", acces: "acces_1", renouvellement: "renouv_1", expireLe: 1_000_000, compte: "corentin@example.test" };
    await refus.connect.charger();
    assert.equal(refus.connect.etat().connecte, false);
    assert.equal(refus.connect.etat().erreur, "La session Composio a expiré. Reconnecte-toi.");
    assert.equal(refus.stockage.jetons, null);
  });

  await verifier("se déconnecter efface les jetons", async () => {
    const f = faux();
    await f.connect.connecter();
    await f.connect.deconnecter();
    assert.equal(f.stockage.jetons, null);
    assert.equal(f.connect.serveur(), null);
    assert.equal(f.connect.etat().connecte, false);
  });

  console.log(`${total} contrôles Composio Connect réussis, faux Composio et vrai retour local.`);
})().catch((e) => { console.error(`ÉCHEC ${e.stack}`); process.exit(1); });
