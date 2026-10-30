/* Après pnpm build:electron. Aucune requête réseau, compte ou clé réelle. */
/* eslint-disable @typescript-eslint/no-require-imports -- Tests Node du build Electron CommonJS. */
const assert = require("node:assert/strict");
const { ComposioApi, ErreurComposio } = require("../dist-electron/composio-api.js");

const CLE = "cle-factice-test-ne-pas-exposer";
const compte = (id = "ca_travail", extra = {}) => ({
  id, user_id: "user_alice", toolkit: { slug: "gmail" },
  auth_config: { id: "ac_gmail", is_disabled: false }, status: "ACTIVE", is_disabled: false,
  alias: "Travail", state: { val: { displayName: "alice@example.test", access_token: "jeton-factice-interdit" } },
  data: { refresh_token: "rafraichissement-factice-interdit" }, ...extra,
});
const outil = (slug = "GMAIL_FETCH_EMAILS", extra = {}) => ({
  slug, toolkit: { slug: "gmail" }, name: "Lire les e-mails", description: "Définition simulée",
  version: "20261030_00", input_parameters: { type: "object", properties: { query: { type: "string" } } }, ...extra,
});
function faux(responses) {
  const appels = [];
  const api = new ComposioApi(CLE, async (url, init) => {
    assert.equal(new URL(url).origin, "https://backend.composio.dev");
    assert.ok(new URL(url).pathname.startsWith("/api/v3.1/"));
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers["x-api-key"], CLE);
    assert.ok(init.signal instanceof AbortSignal);
    appels.push({ url: new URL(url), ...init });
    const r = responses.shift();
    assert.notEqual(r, undefined, "requête non attendue");
    if (r instanceof Error) throw r;
    if (r instanceof Response) return r;
    return Response.json(r);
  });
  return { api, appels, responses };
}
let nombre = 0;
async function verifier(nom, test) {
  await test(); nombre++;
  console.log(`OK ${nom}`);
}

(async () => {
  await verifier("projette les comptes sans état d'auth ni jetons", async () => {
    const { api, appels } = faux([{ items: [compte()], next_cursor: null }]);
    const comptes = await api.listerComptes("user_alice");
    assert.deepEqual(comptes, [{ id: "ca_travail", service: "gmail", userId: "user_alice", authConfigId: "ac_gmail", nom: "alice@example.test", alias: "Travail", statut: "ACTIVE", desactive: false }]);
    assert.equal(appels[0].url.searchParams.get("user_ids"), "user_alice");
    assert.equal(appels[0].url.searchParams.get("account_type"), "PRIVATE");
    assert.doesNotMatch(JSON.stringify(comptes), /jeton|refresh|access_token|state|credentials/);
  });
  await verifier("état inconnu et désactivation ne deviennent pas actifs", async () => {
    const { api } = faux([{ items: [compte("ca_a", { status: "NOUVEL_ETAT" }), compte("ca_b", { status: "EXPIRED" }), compte("ca_c", { auth_config: { id: "ac_gmail", is_disabled: true } })] }]);
    const comptes = await api.listerComptes("user_alice");
    assert.equal(comptes[0].statut, "INCONNU");
    assert.equal(comptes[1].statut, "EXPIRED");
    assert.equal(comptes[2].desactive, true);
  });
  await verifier("refuse un compte d'une autre identité ou un autre id", async () => {
    await assert.rejects(faux([{ items: [compte("ca_bob", { user_id: "user_bob" })] }]).api.listerComptes("user_alice"), /autre identité/);
    await assert.rejects(faux([compte("ca_autre")]).api.lireCompte("ca_travail"), /autre compte/);
    await assert.rejects(faux([{ items: [compte("ca_partage", { experimental: { account_type: "SHARED" } })] }]).api.listerComptes("user_alice"), /pas privée/);
  });
  await verifier("pagination complète et absence honnête", async () => {
    const { api, appels } = faux([{ items: [compte("ca_a")], next_cursor: "page2" }, { items: [compte("ca_b")], next_cursor: null }]);
    assert.equal((await api.listerComptes("user_alice")).length, 2);
    assert.equal(appels[1].url.searchParams.get("cursor"), "page2");
    assert.deepEqual(await faux([{ items: [] }]).api.listerComptes("user_alice"), []);
  });
  await verifier("pagination cassée ou trop longue = erreur, aucun résultat partiel", async () => {
    await assert.rejects(faux([{ items: [], next_cursor: "boucle" }, { items: [], next_cursor: "boucle" }]).api.listerComptes("user_alice"), /pagination/);
    await assert.rejects(faux(Array.from({ length: 50 }, (_, i) => ({ items: [], next_cursor: `suite${i}` }))).api.listerComptes("user_alice"), /Aucun résultat partiel/);
  });
  await verifier("services issus uniquement des configurations réelles", async () => {
    const { api } = faux([
      { items: [{ id: "ac_gmail", name: "Gmail de l’app", toolkit: { slug: "gmail" }, auth_scheme: "OAUTH2", status: "ENABLED", credentials: { api_key: "interdit" } }, { id: "ac_gmail_old", name: "Ancienne", toolkit: { slug: "gmail" }, auth_scheme: "OAUTH2", status: "DISABLED" }] },
      { items: [{ slug: "gmail", name: "Gmail", meta: { description: "Courriel" } }, { slug: "slack", name: "Slack" }] },
    ]);
    const services = await api.listerServices();
    assert.equal(services.length, 1);
    assert.equal(services[0].slug, "gmail");
    assert.equal(services[0].configurations[0].active, true);
    assert.equal(services[0].configurations[1].active, false);
    assert.doesNotMatch(JSON.stringify(services), /credentials|api_key|interdit/);
    const vide = faux([{ items: [] }]);
    assert.deepEqual(await vide.api.listerServices(), []);
    assert.equal(vide.appels.length, 1);
  });
  await verifier("link privé ne vaut jamais une confirmation OAuth", async () => {
    const { api, appels } = faux([{ connected_account_id: "ca_nouveau", redirect_url: "https://connect.composio.dev/link/ln_factice", link_token: "interdit", expires_at: "2026-10-30T20:00:00Z" }]);
    assert.deepEqual(await api.connecter("user_alice", "ac_gmail"), { compteId: "ca_nouveau", lien: "https://connect.composio.dev/link/ln_factice", expireLe: "2026-10-30T20:00:00Z" });
    assert.equal(appels[0].method, "POST");
    assert.equal(appels[0].url.pathname, "/api/v3.1/connected_accounts/link");
    assert.deepEqual(JSON.parse(appels[0].body), { user_id: "user_alice", auth_config_id: "ac_gmail" });
    assert.equal(appels.length, 1, "aucun outil métier ni suppression pendant la connexion");
  });
  await verifier("refuse redirection externe ou non HTTPS", async () => {
    for (const lien of ["https://evil.example/link/ln_x", "http://connect.composio.dev/link/ln_x", "https://a:b@connect.composio.dev/link/ln_x", "https://connect.composio.dev.evil.example/link/ln_x"]) {
      await assert.rejects(faux([{ connected_account_id: "ca_x", redirect_url: lien }]).api.connecter("user_alice", "ac_gmail"), /non autorisé/);
    }
  });
  await verifier("déconnexion confirmée par la source, sans révocation implicite", async () => {
    const { api, appels } = faux([{ success: true }]);
    await api.deconnecter("ca_travail");
    assert.equal(appels[0].method, "DELETE");
    assert.equal(appels[0].url.pathname, "/api/v3.1/connected_accounts/ca_travail");
    assert.equal(appels[0].url.search, "");
    await assert.rejects(faux([{ success: false }]).api.deconnecter("ca_travail"), /pas confirmé/);
  });
  await verifier("recherche de schémas sans exécution et sans confusion de service", async () => {
    const { api, appels } = faux([{ items: [outil()] }, outil()]);
    assert.equal((await api.chercherOutils("gmail", "fetch emails"))[0].version, "20261030_00");
    assert.equal((await api.lireOutil("GMAIL_FETCH_EMAILS")).slug, "GMAIL_FETCH_EMAILS");
    assert.equal(appels[0].url.searchParams.get("query"), "fetch emails");
    assert.equal(appels[0].url.searchParams.get("include_deprecated"), "false");
    assert.equal(appels[1].url.searchParams.get("toolkit_versions"), "latest");
    assert.ok(appels.every((a) => a.method === "GET"));
    await assert.rejects(faux([{ items: [outil("SLACK_READ", { toolkit: { slug: "slack" } })] }]).api.chercherOutils("gmail", "read"), /autre service/);
  });
  await verifier("exécution liée au compte et à la version, réponse nettoyée", async () => {
    const { api, appels } = faux([{ successful: true, data: { messages: ["contenu métier"], nested: { access_token: "interdit", config: { x: "interdit" }, nom: "ok" }, diagnostic: CLE, url: "https://example.test/?access_token=factice&fichier=1" }, config: CLE, error: CLE, session_info: { token: CLE } }]);
    const r = await api.executerOutil("GMAIL_FETCH_EMAILS", "20261030_00", "ca_travail", "user_alice", { query: "in:inbox" });
    assert.equal(r.succes, true);
    assert.deepEqual(JSON.parse(appels[0].body), { connected_account_id: "ca_travail", user_id: "user_alice", version: "20261030_00", arguments: { query: "in:inbox" } });
    assert.deepEqual(r.donnees.nested, { nom: "ok" });
    assert.doesNotMatch(JSON.stringify(r), /interdit|cle-factice-test-ne-pas-exposer|session_info|config/);
    assert.match(r.donnees.url, /secret masqué/);
    assert.deepEqual(r.donnees.messages, ["contenu métier"]);
  });
  await verifier("erreurs fournisseur sans contenu sensible et aucune reprise automatique", async () => {
    const { api, appels } = faux([Response.json({ error: { message: CLE } }, { status: 401 })]);
    await assert.rejects(api.listerComptes("user_alice"), (e) => e instanceof ErreurComposio && e.code === "acces" && e.statutHttp === 401 && !e.message.includes(CLE));
    assert.equal(appels.length, 1);
    await assert.rejects(faux([new Error(CLE)]).api.lireCompte("ca_travail"), (e) => e.code === "reseau" && !e.message.includes(CLE));
    await assert.rejects(faux([Response.json({ message: CLE }, { status: 404 })]).api.lireCompte("ca_travail"), (e) => e.code === "absent" && !e.message.includes(CLE));
    const r = await faux([{ successful: false, error: CLE }]).api.executerOutil("GMAIL_FETCH_EMAILS", "20261030_00", "ca_travail", "user_alice", {});
    assert.equal(r.succes, false);
    assert.ok(!JSON.stringify(r).includes(CLE));
  });
  await verifier("entrée dangereuse ou version flottante refusée avant tout appel", async () => {
    const { api, appels } = faux([]);
    await assert.rejects(api.lireCompte("../evil"), (e) => e.code === "entree");
    await assert.rejects(api.executerOutil("GMAIL_FETCH_EMAILS", "latest", "ca_a", "user_alice", {}), (e) => e.code === "entree");
    await assert.rejects(api.executerOutil("GMAIL_FETCH_EMAILS", "20261030_00", "instant_account", "user_alice", {}), (e) => e.code === "entree");
    assert.equal(appels.length, 0);
  });
  await verifier("délai réseau borné sans exposer la cause ni reprendre l'appel", async () => {
    const setTimeoutInitial = global.setTimeout;
    let nombreAppels = 0;
    global.setTimeout = (callback, delai, ...args) => {
      assert.equal(delai, 15_000);
      return setTimeoutInitial(callback, 0, ...args);
    };
    try {
      const api = new ComposioApi(CLE, async (_url, init) => {
        nombreAppels++;
        return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error(CLE)), { once: true }));
      });
      await assert.rejects(api.lireCompte("ca_travail"), (e) => e.code === "reseau" && !e.message.includes(CLE));
      assert.equal(nombreAppels, 1);
    } finally { global.setTimeout = setTimeoutInitial; }
  });
  await verifier("réponse non JSON ou trop volumineuse refusée", async () => {
    await assert.rejects(faux([new Response("<html>indisponible</html>")]).api.lireCompte("ca_travail"), (e) => e.code === "reponse");
    await assert.rejects(faux([new Response("x".repeat(4 * 1024 * 1024 + 1))]).api.lireCompte("ca_travail"), (e) => e.code === "limite");
  });
  console.log(`${nombre} contrôles API Composio réussis, aucune requête réelle.`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
