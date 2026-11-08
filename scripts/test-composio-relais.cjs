/** Même client MCP pendant une reconnexion et une expiration ; vrais échanges HTTP locaux,
 * faux Composio, aucun compte réel. pnpm build:electron puis node scripts/test-composio-relais.cjs. */
/* eslint-disable @typescript-eslint/no-require-imports -- Harnais Node CommonJS. */
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { ComposioConnect, URL_CONNECT } = require("../dist-electron/composio-connect.js");
const { relayerComposio, serveurRelaisComposio } = require("../dist-electron/composio-relais.js");
const LOCAL = "secret-local-fictif";
let total = 0;
const verifier = async (nom, fn) => { await fn(); total++; console.log(`OK ${nom}`); };
function differe() { let resoudre; const promesse = new Promise(r => { resoudre = r; }); return { promesse, resoudre }; }
function fixture() {
  let temps = 1_000_000;
  let stockage = null;
  let renouvellements = 0;
  let retour = async () => Response.json({ access_token: "acces-renouvele-fictif", expires_in: 3600 });
  const observe = differe();
  const connect = new ComposioConnect({
    maintenant: () => temps, lire: async () => stockage, ecrire: async v => { stockage = v; }, ouvrir: async () => {},
    fetch: async url => {
      if (String(url).includes(".well-known")) return Response.json({ authorization_endpoint: "https://connect.composio.dev/oauth/authorize", token_endpoint: "https://login.composio.dev/oauth2/token", registration_endpoint: "https://login.composio.dev/oauth2/register" });
      renouvellements++; observe.resoudre(); return retour();
    },
  });
  const jetons = acces => ({ clientId: "client-fictif", acces, renouvellement: "refresh-fictif", expireLe: temps + 3600_000, compte: "fixture@example.test" });
  return { connect, jetons, observe, avancer: ms => { temps += ms; }, retour: fn => { retour = fn; }, renouvellements: () => renouvellements };
}
async function avecRelais(prepare, fn) {
  const appels = [];
  let reponse = () => Response.json({ ok: true });
  const http = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${LOCAL}`) { res.writeHead(401).end(); return; }
    void relayerComposio(req, res, prepare, async (url, init) => {
      appels.push({ url, headers: init.headers, body: init.body, method: init.method, redirect: init.redirect });
      return reponse();
    });
  });
  await new Promise(r => http.listen(0, "127.0.0.1", r));
  const configuration = serveurRelaisComposio(`http://127.0.0.1:${http.address().port}/mcp`, LOCAL);
  const appel = (headers = {}, method = "POST") => fetch(configuration.url, { method, headers: { ...configuration.headers, ...headers }, ...(method === "POST" ? { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) } : {}) });
  try { await fn({ configuration, appel, appels, reponse: fn => { reponse = fn; } }); }
  finally { http.closeAllConnections(); await new Promise(r => http.close(r)); }
}

(async () => {
  await verifier("un même client utilise la nouvelle connexion après reconnexion, sans jeton OAuth dans sa configuration", async () => {
    const f = fixture();
    await f.connect.adopter(f.jetons("ancien-acces-fictif"));
    const revision = f.connect.signature();
    await avecRelais(() => f.connect.preparerMcp(), async ({ configuration, appel, appels }) => {
      const configInitiale = JSON.stringify(configuration);
      assert.equal((await appel()).status, 200);
      await f.connect.deconnecter();
      assert.equal((await appel()).status, 401);
      await f.connect.adopter(f.jetons("nouvel-acces-fictif"));
      assert.equal((await appel()).status, 200);
      assert.deepEqual(appels.map(a => a.headers.Authorization), ["Bearer ancien-acces-fictif", "Bearer nouvel-acces-fictif"]);
      assert.equal(JSON.stringify(configuration), configInitiale);
      assert.ok(!configInitiale.includes("ancien-acces-fictif") && !configInitiale.includes("nouvel-acces-fictif"));
      assert.ok(f.connect.signature() > revision);
    });
  });
  await verifier("un long échange renouvelle l'accès à la prochaine requête, une seule fois pour deux appels concurrents", async () => {
    const f = fixture(); await f.connect.adopter(f.jetons("acces-initial-fictif"));
    await avecRelais(() => f.connect.preparerMcp(), async ({ appel, appels }) => {
      assert.equal((await appel()).status, 200);
      f.avancer(3600_000);
      const resultats = await Promise.all([appel(), appel()]);
      assert.ok(resultats.every(r => r.status === 200));
      assert.equal(f.renouvellements(), 1);
      assert.deepEqual(appels.slice(1).map(a => a.headers.Authorization), ["Bearer acces-renouvele-fictif", "Bearer acces-renouvele-fictif"]);
    });
  });
  await verifier("un ancien renouvellement réussi ou refusé ne remplace ni n'efface une reconnexion récente", async () => {
    for (const statut of [200, 400]) {
      const f = fixture(); await f.connect.adopter(f.jetons("ancien-fictif")); f.avancer(3600_000);
      const fin = differe(); f.retour(() => fin.promesse);
      const attente = f.connect.renouvelerSiBesoin(); await f.observe.promesse;
      await f.connect.adopter(f.jetons("reconnexion-fictive"));
      fin.resoudre(statut === 200 ? Response.json({ access_token: "trop-tard-fictif", expires_in: 3600 }) : Response.json({ error: "invalid_grant" }, { status: 400 }));
      await attente;
      assert.equal(f.connect.serveur().headers.Authorization, "Bearer reconnexion-fictive");
      assert.equal(f.connect.etat().erreur, null);
    }
  });
  await verifier("un renouvellement retardé ne reconnecte pas un compte après déconnexion", async () => {
    for (const statut of [200, 400]) {
      const f = fixture(); await f.connect.adopter(f.jetons("ancien-fictif")); f.avancer(3600_000);
      const fin = differe(); f.retour(() => fin.promesse);
      const attente = f.connect.renouvelerSiBesoin(); await f.observe.promesse;
      await f.connect.deconnecter();
      fin.resoudre(statut === 200 ? Response.json({ access_token: "trop-tard-fictif", expires_in: 3600 }) : Response.json({ error: "invalid_grant" }, { status: 400 }));
      await attente;
      assert.equal(f.connect.serveur(), null);
      assert.equal(f.connect.etat().erreur, null);
    }
  });
  await verifier("le relais garde les flux SSE et la session MCP, mais ne transmet pas ses identifiants locaux", async () => {
    const f = fixture(); await f.connect.adopter(f.jetons("oauth-fictif"));
    await avecRelais(() => f.connect.preparerMcp(), async ({ appel, appels, reponse }) => {
      reponse(() => new Response('event: message\ndata: {"ok":true}\n\n', { headers: { "Content-Type": "text/event-stream", "Mcp-Session-Id": "session-fictive" } }));
      const r = await appel({ "Mcp-Session-Id": "session-fictive", "Mcp-Protocol-Version": "2025-06-18", "X-Klyra-Agent": "ne-passe-pas" });
      assert.equal(r.headers.get("mcp-session-id"), "session-fictive");
      assert.equal(await r.text(), 'event: message\ndata: {"ok":true}\n\n');
      assert.equal(appels[0].url, URL_CONNECT);
      assert.equal(appels[0].headers["mcp-session-id"], "session-fictive");
      assert.equal(appels[0].headers["X-Klyra-Agent"], undefined);
      assert.equal(appels[0].redirect, "error");
    });
  });
  await verifier("authentification locale obligatoire, déconnexion explicite, erreur réseau sans secret et aucun rejeu", async () => {
    const f = fixture(); await f.connect.adopter(f.jetons("oauth-fictif"));
    await avecRelais(() => f.connect.preparerMcp(), async ({ appel, appels, reponse }) => {
      assert.equal((await appel({ Authorization: "Bearer autre-fictif" })).status, 401); assert.equal(appels.length, 0);
      assert.equal((await appel({}, "PUT")).status, 405); assert.equal(appels.length, 0);
      reponse(() => { throw new Error("oauth-fictif ne doit pas sortir"); });
      const r = await appel(); assert.equal(r.status, 502); assert.ok(!(await r.text()).includes("oauth-fictif")); assert.equal(appels.length, 1);
      await f.connect.deconnecter(); assert.equal((await appel()).status, 401); assert.equal(appels.length, 1);
    });
  });
  await verifier("la lecture initiale retardée ne remplace pas une connexion déjà adoptée", async () => {
    const lecture = differe();
    const connect = new ComposioConnect({ lire: () => lecture.promesse, ecrire: async () => {}, ouvrir: async () => {}, fetch: async () => { throw new Error("aucun réseau attendu"); }, maintenant: () => 1000 });
    const chargement = connect.charger();
    await connect.adopter({ clientId: "fixture", acces: "nouveau-fictif", renouvellement: null, expireLe: 3600_000, compte: "fixture@example.test" });
    lecture.resoudre(null); await chargement;
    assert.equal((await connect.preparerMcp()).headers.Authorization, "Bearer nouveau-fictif");
  });
  await verifier("les écritures de connexion sont sérialisées : la dernière connexion reste sur disque", async () => {
    let stockage = null; const debut = differe(); const fin = differe(); let nombre = 0;
    const connect = new ComposioConnect({ lire: async () => null, ouvrir: async () => {}, fetch: async () => { throw new Error("aucun réseau attendu"); }, maintenant: () => 1000,
      ecrire: async v => { if (++nombre === 1) { debut.resoudre(); await fin.promesse; } stockage = v; },
    });
    const jetons = acces => ({ clientId: "fixture", acces, renouvellement: null, expireLe: 3600_000, compte: "fixture@example.test" });
    const premier = connect.adopter(jetons("ancien-fictif")); await debut.promesse;
    const second = connect.adopter(jetons("nouveau-fictif"));
    fin.resoudre(); await Promise.all([premier, second]);
    assert.equal(stockage.acces, "nouveau-fictif");
  });
  await verifier("le vrai serveur MCP du VPS garde un relais stable après reconnexion et protège sa route", async () => {
    const { creerIa } = await import("../serveur/ia.mjs");
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-composio-relais-"));
    const f = fixture(); await f.connect.adopter(f.jetons("premier-fictif"));
    const recus = [];
    const ia = creerIa({ donnees: d, version: "test", fetch: async (url, init) => { recus.push(init.headers.Authorization); return Response.json({ ok: true }); } });
    ia.surComposio(() => f.connect.serveur(), () => f.connect.preparerMcp(), () => f.connect.etat().connecte);
    try {
      await ia.demarrer();
      const config = JSON.parse(ia.configMcp({ agent: "principal" })).mcpServers.composio;
      assert.match(config.url, /^http:\/\/127\.0\.0\.1:\d+\/composio$/);
      assert.ok(!JSON.stringify(config).includes("premier-fictif"));
      assert.equal((await fetch(config.url, { method: "POST", body: "{}" })).status, 401);
      const appel = () => fetch(config.url, { method: "POST", headers: config.headers, body: "{}" });
      assert.equal((await appel()).status, 200);
      await f.connect.adopter(f.jetons("second-fictif"));
      assert.equal((await appel()).status, 200);
      assert.deepEqual(recus, ["Bearer premier-fictif", "Bearer second-fictif"]);
      await f.connect.deconnecter();
      assert.equal((await appel()).status, 401);
      assert.equal(Boolean(JSON.parse(ia.configMcp({ agent: "principal" }) ?? "{}").mcpServers?.composio), false);
    } finally { ia.fermer(); fs.rmSync(d, { recursive: true, force: true }); }
  });
  console.log(`${total} contrôles du relais Composio réussis.`);
})().catch(e => { console.error(`ÉCHEC ${e.stack}`); process.exitCode = 1; });
