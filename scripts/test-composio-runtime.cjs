/**
 * Serveur MCP et streamAgent réels, EspaceComposio en mémoire et fournisseur Anthropic simulé.
 * Aucun BrowserWindow, compte réel, clé réelle ou action métier extérieure.
 * Prérequis : pnpm build:electron. Le runtime testé vient de KLYRA_TEST_RUNTIME_ROOT ou de ..
 *
 * MCP seul (portable) : electron scripts/test-composio-runtime.cjs
 * Vrai Claude (Linux, réseau isolé requis, aucune route extérieure) :
 *   xvfb-run -a unshare --user --map-root-user --net sh -c \
 *     'ip link set lo up && env -u ELECTRON_RUN_AS_NODE KLYRA_TEST_VRAI_CLAUDE=1 pnpm exec electron scripts/test-composio-runtime.cjs --no-sandbox'
 * KLYRA_CLAUDE_PATH peut préciser le binaire. Une absence en mode réel fait échouer le test.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Test du build Electron CommonJS. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const childProcess = require("node:child_process");
const { app, session } = require("electron");
const { demarrerFauxAnthropic } = require("./faux-composio-runtime.cjs");

const ROOT = path.resolve(process.env.KLYRA_TEST_RUNTIME_ROOT || path.join(__dirname, ".."));
const REAL = process.env.KLYRA_TEST_VRAI_CLAUDE === "1";
const OLD_HOME = os.homedir();
const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(OLD_HOME, ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find((f) => f && fs.existsSync(f));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-composio-runtime-"));
const TEST_HOME = path.join(TMP, "home");
const DATA = path.join(TMP, "userdata");
const CLE = "cle-composio-sentinelle-uniquement-pour-test";
for (const folder of [TEST_HOME, DATA, path.join(TEST_HOME, ".claude/agents"), path.join(TEST_HOME, ".klyra/planning")]) fs.mkdirSync(folder, { recursive: true });
app.setPath("userData", DATA);
app.setPath("sessionData", path.join(TMP, "session"));
app.setPath("home", TEST_HOME);

// Ne transmettre aucun identifiant ni réglage fournisseur du shell appelant.
const keep = new Set(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "DISPLAY", "XAUTHORITY", "LANG", "LC_ALL", "LD_LIBRARY_PATH"]);
for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key];
Object.assign(process.env, {
  HOME: TEST_HOME, USERPROFILE: TEST_HOME, XDG_CONFIG_HOME: path.join(TMP, "config"), XDG_CACHE_HOME: path.join(TMP, "cache"),
  CLAUDE_CONFIG_DIR: path.join(TEST_HOME, ".claude"), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1",
  COMPOSIO_API_KEY: CLE, KLYRA_COMPOSIO_SENTINEL: CLE,
});
// Découverte seule autorisée dans ce profil synthétique : on isole l'autorisation
// de l'exécution sans appeler le classificateur IA du mode auto. Aucune permission
// d'exécution Composio (allow/ask) n'est ajoutée par le test : elle vient du runtime.
fs.writeFileSync(path.join(TEST_HOME, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Read", "mcp__klyra__composio_rechercher", "mcp__klyra__composio_etat"] } }));

const children = [];
const launches = [];
const originalSpawn = childProcess.spawn;
childProcess.spawn = function spawn(bin, args, options) {
  launches.push({ bin, args: [...args], env: { ...options.env } });
  const child = originalSpawn.call(this, bin, args, options);
  children.push(child);
  return child;
};
let count = 0;
const ok = (message) => { count++; console.log(`OK ${message}`); };
let fournisseur;
const timeLimit = setTimeout(() => { console.error("ÉCHEC délai global runtime (150 s)"); terminer(1); }, 150_000);
function terminer(code) {
  clearTimeout(timeLimit);
  for (const child of children) child.kill("SIGKILL");
  fournisseur?.fermer();
  childProcess.spawn = originalSpawn;
  // Tous les fichiers créés sont dans ce seul répertoire jetable.
  try { fs.rmSync(TMP, { recursive: true, force: true }); }
  catch { console.log("Profil de test temporaire encore verrouillé ; nettoyage différé au système."); }
  app.exit(code);
}

app.whenReady().then(async () => {
  try {
    // Couvre aussi les requêtes Chromium/Electron ; le vrai Claude exige en plus un namespace réseau.
    session.defaultSession.webRequest.onBeforeRequest((details, done) => {
      const url = new URL(details.url);
      done({ cancel: !["127.0.0.1", "::1", "localhost"].includes(url.hostname) });
    });
    if (REAL) {
      assert.equal(process.platform, "linux", "le mode vrai Claude exige ici un namespace Linux isolé");
      assert.ok(CLAUDE, "Claude Code absent : aucune preuve runtime réelle");
      assert.ok(Object.values(os.networkInterfaces()).flat().filter(Boolean).every((i) => i.internal), "refus du vrai Claude hors namespace réseau : interfaces extérieures présentes");
      assert.equal(fs.readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1, "une route extérieure existe");
      process.env.KLYRA_CLAUDE_PATH = CLAUDE;
    }

    const { EspaceComposio } = require(path.join(ROOT, "dist-electron/composio-espace.js"));
    const configModule = require(path.join(ROOT, "dist-electron/composio.js"));
    let configuration = null;
    let identityRevision = "local:1";
    const calls = [];
    const accounts = new Map();
    let failed = false;
    const api = {
      listerServices: async () => [{ slug: "gmail", nom: "Gmail simulé", description: "", configurations: [{ id: "auth_test", nom: "Test", methode: "OAUTH2", active: true }] }],
      listerComptes: async () => [...accounts.values()],
      lireCompte: async (id) => { if (!accounts.has(id)) throw new Error("Compte absent simulé"); return { ...accounts.get(id) }; },
      chercherOutils: async () => [{ slug: "GMAIL_RUNTIME_TEST", service: "gmail", nom: "Opération simulée", description: "Test sans action externe.", version: "20261030_00", parametres: { type: "object", properties: { message: { type: "string" } } } }],
      executerOutil: async (outil, version, compteId, userId, args) => { calls.push({ outil, version, compteId, userId, args }); return { succes: !failed, donnees: { compte: compteId }, ...(failed ? { erreur: "Échec métier simulé" } : {}) }; },
    };
    const espace = new EspaceComposio({
      identite: async () => ({ scope: "local", type: "local", nom: "Profil de test", revision: identityRevision }),
      revisionIdentite: () => identityRevision, coffreDisponible: () => true,
      lire: async () => configuration && structuredClone(configuration),
      ecrire: async (_, v) => { configuration = structuredClone(v); },
      api: (cle) => { assert.equal(cle, CLE); return api; }, ouvrir: async () => { throw new Error("OAuth interdit dans ce test"); },
    });
    configModule.espaceComposio = espace;
    const ia = require(path.join(ROOT, "dist-electron/ia.js"));
    await ia.demarrerServeurMcp();
    const makeMcp = () => JSON.parse(ia.configMcp({ chatId: "test-composio", roleId: "principal" }, espace.creerCapacite())).mcpServers.klyra;
    const call = async (mcp, method, params) => {
      const r = await fetch(mcp.url, { method: "POST", headers: { ...mcp.headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }) });
      assert.equal(r.status, 200); return (await r.json()).result;
    };
    const search = (mcp) => call(mcp, "tools/call", { name: "composio_rechercher", arguments: { service: "gmail", recherche: "test" } });
    const execute = (mcp) => call(mcp, "tools/call", { name: "composio_executer", arguments: { outil: "GMAIL_RUNTIME_TEST", arguments: { message: "synthétique" } } });
    const choose = async (id) => espace.selectionner((await espace.etat()).contexte, "gmail", id);

    const initial = await espace.etat();
    assert.equal(initial.configure, false);
    assert.deepEqual(initial.comptes, []);
    assert.equal((await search(makeMcp())).isError, true);
    assert.equal(calls.length, 0); ok("profil vierge : aucun compte annoncé connecté ni exécution");
    await espace.configurer((await espace.etat()).contexte, CLE);
    for (const id of ["ca_A", "ca_B"]) accounts.set(id, { id, userId: configuration.userId, service: "gmail", authConfigId: "auth_test", nom: `${id}@example.test`, alias: id, statut: "ACTIVE", desactive: false });
    await espace.etat();
    assert.equal(calls.length, 0); ok("configuration et actualisation : aucun outil métier");
    await choose("ca_A");
    const mcpA = makeMcp();
    assert.ok(!(await search(mcpA)).isError);
    assert.ok(!(await execute(mcpA)).isError);
    assert.equal(calls.at(-1).compteId, "ca_A"); ok("MCP réel : le compte sélectionné A atteint le fournisseur simulé");
    await choose("ca_B");
    const beforeOld = calls.length;
    assert.equal((await execute(mcpA)).isError, true);
    assert.equal(calls.length, beforeOld); ok("ancienne capacité A invalidée dès sélection de B");
    const mcpB = makeMcp();
    await search(mcpB); await execute(mcpB);
    assert.equal(calls.at(-1).compteId, "ca_B"); ok("MCP réel : nouvelle capacité utilise B");
    const beforeInvalid = calls.length;
    accounts.get("ca_B").statut = "EXPIRED";
    assert.equal((await execute(mcpB)).isError, true);
    accounts.get("ca_B").statut = "ACTIVE";
    const savedB = accounts.get("ca_B"); accounts.delete("ca_B");
    assert.equal((await execute(mcpB)).isError, true);
    accounts.set("ca_B", savedB);
    assert.equal(calls.length, beforeInvalid); ok("absent et expiré : refus, aucun repli sur A");
    failed = true;
    assert.equal((await execute(mcpB)).isError, true); failed = false;
    ok("échec métier du fournisseur transmis en MCP isError=true");
    identityRevision = "local:2";
    assert.equal((await execute(mcpB)).isError, true); ok("changement d'identité : capacité du processus refusée");
    assert.ok(!JSON.stringify(makeMcp()).includes(CLE));
    assert.ok(!ia.OUTILS_APP().includes("mcp__klyra__composio_executer"));
    ok("clé fournisseur absente du mcp-config et exécution absente des outils auto-autorisés");

    if (REAL) {
      fournisseur = await demarrerFauxAnthropic();
      Object.assign(process.env, { ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-factice-local-sans-valeur" });
      const agents = require(path.join(ROOT, "dist-electron/mes-agents.js"));
      await agents.chargerMesAgents([]);
      const runtime = require(path.join(ROOT, "dist-electron/claude.js"));
      const tour = (label, acces = "tout", sessionId = null) => new Promise((resolve, reject) => {
        const requestId = randomUUID();
        const events = [];
        const timer = setTimeout(() => { runtime.cancelAgent(requestId); reject(new Error(`délai tour ${label}`)); }, 35_000);
        runtime.streamAgent(requestId, { agent: null, prompt: `COMPOSIO_RUNTIME ${label}`, dossier: null, sessionId, chatId: "test-runtime", acces }, (event) => {
          events.push(event);
          if (event.type === "autorisation") runtime.autoriser(requestId, event.id, event.outil === "mcp__klyra__composio_executer" ? "non" : "oui");
          if (event.type === "fin") { clearTimeout(timer); resolve({ events, fin: event }); }
        }, () => null);
      });
      await choose("ca_A");
      const beforeA = calls.length;
      const a = await tour("compte-A");
      assert.equal(a.fin.ok, true, a.fin.erreur);
      assert.equal(calls.length, beforeA + 1, `le vrai Claude doit exécuter A, réponse : ${a.fin.texte}`);
      assert.equal(calls.at(-1).compteId, "ca_A");
      assert.ok(!a.events.some((e) => e.type === "autorisation"), "accès tout : le comportement existant ne présente pas de carte");
      const sid = a.events.find((e) => e.type === "session")?.sessionId;
      assert.ok(sid); ok("vrai Claude + streamAgent + MCP : A exécuté en accès tout");
      const oldRuntime = JSON.parse(launches.at(-1).args[launches.at(-1).args.indexOf("--mcp-config") + 1]).mcpServers.klyra;
      await choose("ca_B");
      assert.equal((await execute(oldRuntime)).isError, true);
      const b = await tour("compte-B", "tout", sid);
      assert.equal(b.fin.ok, true, b.fin.erreur);
      assert.equal(calls.at(-1).compteId, "ca_B");
      assert.equal(calls.length, beforeA + 2); ok("session Claude reprise après sélection : B, ancienne capacité A refusée");
      const beforePermission = calls.length;
      const manual = await tour("refus-manuel", "demander");
      assert.ok(manual.events.some((e) => e.type === "autorisation" && e.outil === "mcp__klyra__composio_executer"), "mode demander : carte d'autorisation d'exécution absente");
      assert.equal(calls.length, beforePermission); ok("mode demander : carte d'autorisation et refus sans exécution");
      const p = await tour("refus-permission", "projet");
      assert.ok(p.events.some((e) => e.type === "autorisation" && e.outil === "mcp__klyra__composio_executer"), `carte d'autorisation d'exécution absente : ${p.fin.texte} ; ${JSON.stringify(p.events.filter((e) => ["autorisation", "etape", "etape-fin"].includes(e.type)))}`);
      assert.equal(calls.length, beforePermission); ok("mode projet : carte d'autorisation, refus = zéro exécution fournisseur");
      assert.ok(launches.every((l) => !JSON.stringify(l.args).includes(CLE) && !Object.values(l.env).includes(CLE)));
      assert.ok(!JSON.stringify(fournisseur.requetes).includes(CLE)); ok("vrai Claude : aucune clé fournisseur dans args, environnement ou prompts");
    } else console.log("LIMITE vrai Claude non demandé ; exécuter KLYRA_TEST_VRAI_CLAUDE=1 dans le namespace réseau pour cette preuve.");
    console.log(`${count} vérifications Composio runtime réussies ; OAuth, coffre natif et interface hors de ce test.`);
    terminer(0);
  } catch (error) {
    console.error(`ÉCHEC ${error.message}`);
    terminer(1);
  }
});
