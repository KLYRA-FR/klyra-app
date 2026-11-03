/* eslint-disable @typescript-eslint/no-require-imports -- module Electron compilé dans une VM isolée. */
/** Vrais streamAgent/autoriser, faux processus et protocole stream-json.
 * Seul claude.js compilé est lu : aucun profil, secret, réseau ou processus réel.
 * Après build:electron : node scripts/test-routine-claude.cjs [dossier-dist-electron]
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const filename = path.join(process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "../dist-electron"), "claude.js");
const code = readFileSync(filename, "utf8");
const PROFILE = "/profil-fictif";
const BIN = "/faux/claude";
const SESSION = "10000000-0000-4000-8000-000000000001";
const AUTRE_SESSION = "10000000-0000-4000-8000-000000000002";

class FauxProcessus extends EventEmitter {
  constructor(args, options) {
    super();
    this.args = [...args];
    this.options = options;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
    this.ecrits = [];
    this.stdin = {
      writableEnded: false,
      write: (texte) => { this.ecrits.push(JSON.parse(texte)); return true; },
      end: () => { this.stdin.writableEnded = true; },
    };
  }

  recevoir(message) {
    // Passe par le vrai découpage de stdout et lireLigne, sans appeler ses fonctions privées.
    this.stdout.emit("data", `${JSON.stringify(message)}\n`);
  }

  kill(signal) {
    this.signalCode = signal;
    this.emit("close", null, signal);
    return true;
  }

  contexte() {
    return JSON.parse(this.args[this.args.indexOf("--mcp-config") + 1]).contexte;
  }
}

/** Un module compilé pur, avec les chemins simulés du test (posix), même sous Windows. */
function chargerAvecCheminsPosix(fichier) {
  const charge = { exports: {} };
  vm.runInNewContext(readFileSync(fichier, "utf8"), {
    exports: charge.exports,
    module: charge,
    require: (nom) => {
      assert.ok(nom === "node:path", `Dépendance non simulée interdite : ${nom}`);
      return path.posix;
    },
  }, { filename: fichier });
  return charge.exports;
}

function fixture() {
  const processus = [];
  const minuteurs = new Map();
  let sequence = 0;
  let compteComposio = "compte-fictif-a";
  let connectActif = false;
  const modules = {
    "node:child_process": {
      spawn: (bin, args, options) => {
        assert.equal(bin, BIN);
        assert.equal(args[args.indexOf("--input-format") + 1], "stream-json");
        // Hors projet, l'assistant travaille dans son dossier de l'atelier (electron/atelier.ts).
        assert.equal(options.cwd, `${PROFILE}/.klyra/atelier/principal`);
        // Les skills livrées avec Claude Code sont coupées pour toutes les sessions de l'app (electron/claude.ts).
        assert.deepEqual(Object.keys(options.env).sort(), ["CLAUDE_CODE_DISABLE_BUNDLED_SKILLS", "ELECTRON_RUN_AS_NODE", "KLYRA_CLAUDE_PATH", "PATH"]);
        assert.equal(options.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS, "1");
        const child = new FauxProcessus(args, options);
        processus.push(child);
        return child;
      },
    },
    "node:crypto": { randomUUID: () => `20000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` },
    "node:path": path.posix,
    "node:os": { homedir: () => PROFILE },
    "node:fs": {
      existsSync: (nom) => nom === BIN,
      mkdirSync: (nom) => assert.equal(nom, `${PROFILE}/.klyra/atelier/principal`),
      readdirSync: () => assert.fail("Aucun répertoire réel ne doit être consulté."),
      readFileSync: () => assert.fail("Aucun profil ni fichier utilisateur ne doit être lu."),
    },
    // Fonctions pures (tri des binaires, message de lancement) : le vrai module compilé.
    "./claude-binaire": require(path.join(path.dirname(filename), "claude-binaire.js")),
    "./titre": require(path.join(path.dirname(filename), "titre.js")),
    "./epreuve": require(path.join(path.dirname(filename), "epreuve.js")),
    "./json-partiel": require(path.join(path.dirname(filename), "json-partiel.js")),
    "./atelier-agent": require(path.join(path.dirname(filename), "atelier-agent.js")),
    // Module pur : la configuration KLYRA réelle ; ses réglages, ceux par défaut (rien d'adopté).
    "./configuration-klyra": require(path.join(path.dirname(filename), "configuration-klyra.js")),
    "./reglages": { lireReglages: () => ({ configuration: require(path.join(path.dirname(filename), "configuration-klyra.js")).CONFIGURATION_PAR_DEFAUT }) },
    "./atelier": chargerAvecCheminsPosix(path.join(path.dirname(filename), "atelier.js")),
    "./consommation": { enregistrerTourClaude: () => ({}) },
    // Les skills de la session (cf. electron/connaissances-agent.ts) : aucune sur ce profil fictif, le message passe tel quel.
    "./connaissances-agent": {
      competencesPrechargees: () => ({ noms: [], texte: null }),
      promptAvecSkill: (prompt) => prompt,
      skillsConnues: () => new Set(),
    },
    // Computer Use coupé, comme sur un profil qui ne l'a jamais allumé : pas d'outils « ordinateur ».
    "./ordinateur/pilote": {
      consigneOrdinateur: () => "Computer Use est coupé.",
      OUTILS_ORDINATEUR_INTERDITS: [],
      OUTILS_ORDINATEUR_LECTURE: [],
      serveurOrdinateur: () => null,
      signatureOrdinateur: () => "",
    },
    "./ia": {
      configMcp: (contexte, composio) => JSON.stringify({ contexte, composio }),
      OUTILS_APP: () => [],
    },
    "./composio": {
      espaceComposio: {
        signature: () => compteComposio,
        creerCapacite: () => `capacite-${compteComposio}`,
      },
      composioConnect: { serveur: () => connectActif ? { type: "http", url: "https://connect.composio.dev/mcp", headers: {} } : null },
    },
    "./mes-agents": {
      agentsARefuser: () => [],
      agentAutorise: () => false,
      dossierAgents: () => `${PROFILE}/.claude/agents`,
      estActif: () => false,
      generation: () => "profil-fictif-v1",
      mesAgents: () => ({ assistant: { nom: "Assistant fictif" }, agents: {} }),
      presentationActifs: () => [],
    },
    "./planning": { DOSSIER_PLANNING: "/planning-fictif", FICHIER_PLANNING: "/planning-fictif/planning.md" },
  };
  const api = {};
  vm.runInNewContext(code, {
    exports: api,
    require: (nom) => {
      assert.ok(Object.hasOwn(modules, nom), `Dépendance non simulée interdite : ${nom}`);
      return modules[nom];
    },
    // Le module ne reçoit jamais process.env du poste, même pour son faux spawn.
    process: { platform: "linux", env: { KLYRA_CLAUDE_PATH: BIN, PATH: "", COMPOSIO_API_KEY: "sentinelle-fictive", KLYRA_COMPOSIO_SENTINEL: "sentinelle-fictive" } },
    setTimeout: (fn) => { const id = ++sequence; minuteurs.set(id, fn); return id; },
    clearTimeout: (id) => minuteurs.delete(id),
  }, { filename });

  const lancer = (requestId, options = {}) => {
    const events = [];
    api.streamAgent(requestId, {
      agent: null, prompt: "Test fictif sans action", dossier: null, sessionId: null,
      modele: null, effort: null, acces: "demander", chatId: "dm-principal", ...options,
    }, (event) => events.push(event), () => null);
    return { events, child: processus.at(-1) };
  };
  return { api, lancer, processus, changerCompte: () => { compteComposio = "compte-fictif-b"; }, activerConnect: () => { connectActif = true; } };
}

function permission(child, id) {
  child.recevoir({ type: "control_request", request_id: id, request: {
    subtype: "can_use_tool", tool_name: "Bash", input: { command: "commande-fictive" }, description: "Test sans exécution",
  } });
}

let passed = 0;
function test(nom, verifier) {
  verifier(fixture());
  passed++;
  console.log(`OK ${nom}`);
}

for (const decision of ["oui", "non"]) {
  test(`vraie permission : ${decision} émet autorisation-fin une seule fois`, ({ api, lancer }) => {
    const { events, child } = lancer("reponse-routine", { routineRun: "run-a" });
    permission(child, "permission-a");
    assert.equal(events.at(-1).type, "autorisation");
    assert.equal(events.at(-1).id, "permission-a");
    assert.equal(api.autoriser("reponse-routine", "permission-a", decision), true);
    const fin = events.at(-1);
    assert.equal(fin.type, "autorisation-fin");
    assert.equal(fin.id, "permission-a");
    assert.equal(fin.accepte, decision === "oui");
    const reponse = child.ecrits.at(-1).response;
    assert.equal(reponse.request_id, "permission-a");
    assert.equal(reponse.response.behavior, decision === "oui" ? "allow" : "deny");
    assert.equal(api.autoriser("reponse-routine", "permission-a", decision), false);
    assert.equal(events.filter((e) => e.type === "autorisation-fin").length, 1);
  });
}

test("deux processus : une permission ne peut pas être résolue dans l’autre run", ({ api, lancer }) => {
  const a = lancer("reponse-a", { routineRun: "run-a", sessionId: SESSION });
  const b = lancer("reponse-b", { routineRun: "run-b", sessionId: AUTRE_SESSION, chatId: "routine-b" });
  permission(a.child, "permission-a");
  permission(b.child, "permission-b");
  assert.equal(api.autoriser("reponse-b", "permission-a", "oui"), false);
  assert.equal(api.autoriser("reponse-a", "permission-a", "oui"), true);
  assert.equal(b.events.filter((e) => e.type === "autorisation-fin").length, 0);
  assert.equal(api.autoriser("reponse-b", "permission-b", "non"), true);
  assert.equal(a.events.filter((e) => e.type === "autorisation-fin").length, 1);
  assert.equal(b.events.filter((e) => e.type === "autorisation-fin").length, 1);
});

for (const [avant, apres, libelle] of [
  [undefined, "run-a", "conversation normale → routine"],
  ["run-a", "run-b", "routine → autre run"],
  ["run-a", undefined, "routine → conversation normale"],
]) {
  test(`${libelle} : nouveau processus et contexte MCP exact, même si un tour reste actif`, ({ lancer, processus }) => {
    const a = lancer("reponse-a", { routineRun: avant, sessionId: SESSION });
    const b = lancer("reponse-b", { routineRun: apres, sessionId: SESSION });
    assert.equal(processus.length, 2);
    assert.notEqual(a.child, b.child);
    assert.equal(a.child.stdin.writableEnded, true);
    assert.equal(a.child.contexte().routineRun, avant);
    assert.equal(b.child.contexte().routineRun, apres);
    assert.equal(b.child.contexte().chatId, "dm-principal");
    assert.equal(b.child.contexte().roleId, "principal");
    const consigne = b.child.args[b.child.args.indexOf("--append-system-prompt") + 1];
    assert.equal(consigne.includes("Ce tour est une exécution de routine."), !!apres);
    assert.equal(a.child.ecrits.filter((e) => e.type === "user").length, 1);
    assert.equal(b.child.ecrits.filter((e) => e.type === "user").length, 1);
  });
}

test("conversation normale : réutilisation du processus conservée", ({ lancer, processus }) => {
  const a = lancer("reponse-a", { sessionId: SESSION });
  const b = lancer("reponse-b", { sessionId: SESSION });
  assert.equal(processus.length, 1);
  assert.equal(a.child, b.child);
  assert.equal(a.child.stdin.writableEnded, false);
  assert.equal(a.child.ecrits.filter((e) => e.type === "user").length, 2);
  assert.equal(a.child.contexte().routineRun, undefined);
});

test("routine et Composio : les deux contextes et règles coexistent sans clé dans le processus", ({ lancer }) => {
  const { child } = lancer("reponse-a", { routineRun: "run-a" });
  const configuration = JSON.parse(child.args[child.args.indexOf("--mcp-config") + 1]);
  assert.equal(configuration.contexte.routineRun, "run-a");
  assert.equal(configuration.composio, "capacite-compte-fictif-a");
  const consigne = child.args[child.args.indexOf("--append-system-prompt") + 1];
  assert.ok(consigne.includes("Ce tour est une exécution de routine."));
  assert.ok(consigne.includes("Pour Composio, commence par composio_etat"));
  assert.equal(JSON.stringify(child.options.env).includes("sentinelle-fictive"), false);
});

test("Composio Connect actif : consigne Connect, plus celle de la clé de projet", ({ lancer, activerConnect }) => {
  activerConnect();
  const { child } = lancer("reponse-a", { routineRun: "run-a" });
  const consigne = child.args[child.args.indexOf("--append-system-prompt") + 1];
  assert.ok(consigne.includes("utilise le serveur MCP composio (Composio Connect)"));
  assert.ok(!consigne.includes("Pour Composio, commence par composio_etat"));
});

test("changement Composio : renouvellement du processus même dans le contexte routine", ({ lancer, processus, changerCompte }) => {
  const a = lancer("reponse-a", { routineRun: "run-a", sessionId: SESSION });
  changerCompte();
  const b = lancer("reponse-b", { routineRun: "run-a", sessionId: SESSION });
  assert.equal(processus.length, 2);
  assert.notEqual(a.child, b.child);
  assert.equal(a.child.stdin.writableEnded, true);
  const configuration = JSON.parse(b.child.args[b.child.args.indexOf("--mcp-config") + 1]);
  assert.equal(configuration.composio, "capacite-compte-fictif-b");
  assert.equal(configuration.contexte.routineRun, "run-a");
});

console.log(`${passed} scénarios Claude/routines vérifiés : vrai module, faux processus, aucun accès utilisateur ou fournisseur.`);
