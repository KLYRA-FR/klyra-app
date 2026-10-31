/* eslint-disable @typescript-eslint/no-require-imports -- Banc local CommonJS, sans fournisseur réel. */
/**
 * Profil fictif pour vérifier l'export statique dans OpenBot Browser.
 * node scripts/routines-browser-fixture.cjs --app=/chemin/klyra-routines-schedule
 * node scripts/routines-browser-fixture.cjs --app=/chemin/klyra-routines-schedule --self-test
 * node scripts/routines-browser-fixture.cjs --cas=canevas --port=3180
 * node scripts/routines-browser-fixture.cjs --cas=canevas --moteur-arrete --port=3181
 *
 * Le preload compilé, le moteur, l'adaptateur routines/index et conversations.js sont réels.
 * Electron, les comptes et l'agent sont simulés. Aucun shell, SDK IA, clé, compte ni HOME réel.
 * Consignes : [permission], [long] (60 s), [erreur], [echec-declare], [rien].
 * Les fichiers restent dans le dossier temporaire affiché, sauf --self-test qui nettoie les siens.
 * Un onglet = une fenêtre Electron. Recharger/fermer l'onglet interrompt les runs réclamés.
 * Aucun test de veille native, de vraie permission OS ou de fournisseur n'est couvert ici.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const Module = require("node:module");
const { randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");

const argument = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const appDir = path.resolve(argument("app", path.join(__dirname, "..")));
const outDir = path.join(appDir, "out");
const selfTest = process.argv.includes("--self-test");
const cas = argument("cas", "");
const moteurArrete = process.argv.includes("--moteur-arrete");
if (cas && cas !== "canevas") throw new Error("Cas inconnu. Le seul cas préparé est --cas=canevas.");
const port = Number(argument("port", selfTest ? "0" : "3179"));
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port invalide.");
for (const file of ["out/routines.html", "dist-electron/preload.js", "dist-electron/routines/index.js", "dist-electron/conversations.js"]) {
  if (!fs.existsSync(path.join(appDir, file))) throw new Error(`Build manquant : ${file}. Compiler le web et Electron dans --app.`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-routines-browser-"));
const agentsDir = path.join(root, "agents");
const projectDir = path.join(root, "projet-fictif");
fs.mkdirSync(agentsDir);
fs.mkdirSync(projectDir);
const fichiersAgents = {
  dev: "---\nname: dev\ndisplayName: Camille fictif\ndescription: Développeur de test local\nmodel: sonnet\n---\n# Camille fictif — Dev\nSimulation locale, aucune tâche métier.\n",
  designer: "---\nname: designer\ndisplayName: Robin fictif\ndescription: Designer de test local\nmodel: sonnet\n---\n# Robin fictif — Design\nSimulation locale, aucune tâche métier.\n",
};
for (const [id, content] of Object.entries(fichiersAgents)) fs.writeFileSync(path.join(agentsDir, `${id}.md`), content);
const mes = {
  version: 1, depart: "nouveau", assistant: { nom: "Assistant fictif", teinte: "bleu-k1" },
  agents: Object.fromEntries(Object.keys(fichiersAgents).map((id) => [id, { actif: true, ajouteLe: Date.now(), origine: { type: "local" }, empreinte: null }])),
};
let meta = {};
let reglages = {
  notifications: { actives: false, pastille: true, son: false, agentFini: false, agentErreur: false, workflow: false, majPrete: false },
  computerUse: { actif: false }, sons: { finDeTache: false, theme: "silence", volume: 0 },
};
fs.writeFileSync(path.join(root, "conversations.json"), JSON.stringify({
  version: 1, chats: [], messages: [], routines: [], artefacts: [], taches: [], evenements: [], categories: [], workflows: [], executions: [],
  currentUser: { id: "moi", name: "Profil fictif", title: "Vérification locale", initial: "F" }, acces: "demander",
  projects: [{ id: "projet-fictif", name: "Projet fictif", subtitle: "Aucune donnée réelle", status: "en-cours", pinned: true,
    roleIds: ["principal", "dev", "designer"], brief: "Essais de routines avec un faux agent.", previewUrl: "", folder: projectDir, files: [], updatedAt: new Date().toISOString() }],
}));

const handlers = new Map();
const clients = new Map();
const streams = new Map();
const journal = [];
const powerMonitor = new EventEmitter();
let signals;
let api;
let conversations;
let closing = false;
const ok = (data = null) => ({ ok: true, data });
const fail = (message, code = "fixture") => ({ ok: false, code, message });
const trace = (type, detail) => {
  const row = { at: new Date().toISOString(), type, ...detail };
  journal.push(row);
  fs.appendFileSync(path.join(root, "fixture-events.jsonl"), `${JSON.stringify(row)}\n`);
};
const broadcast = (name, ...args) => { for (const client of clients.values()) client.send(name, ...args); };

function terminer(requestId, event) {
  const stream = streams.get(requestId);
  if (!stream) return;
  for (const timer of stream.timers) clearTimeout(timer);
  streams.delete(requestId);
  stream.emit(event);
  trace("agent-fin", { requestId, runId: stream.options.routineRun ?? null, ok: event.ok });
}

function cancelAgent(requestId) {
  if (!streams.has(requestId)) return;
  terminer(requestId, { type: "fin", ok: false, texte: "", erreur: "Simulation interrompue." });
}

function chargerAdaptateur() {
  const modulePath = path.join(appDir, "dist-electron/routines/index.js");
  const conversationsPath = path.join(appDir, "dist-electron/conversations.js");
  const electron = {
    app: { getPath: () => root }, powerMonitor,
    BrowserWindow: { getAllWindows: () => [...clients.values()].map((webContents) => ({ webContents })) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  };
  const original = Module._load;
  Module._load = function (name, parent, ...args) {
    if (name === "electron") return electron;
    if (parent?.filename === modulePath) {
      if (name === "../claude") return { cancelAgent };
      if (name === "../mes-agents") return { dossierAgents: () => agentsDir, estActif: (id) => mes.agents[id]?.actif === true };
      if (name === "../ia") return { brancherOutilsRoutines: (value) => { signals = value; } };
    }
    return original.call(this, name, parent, ...args);
  };
  try {
    api = require(modulePath);
    conversations = require(conversationsPath);
  } finally { Module._load = original; }
  api.brancherRoutines();
}

function lireStore() {
  const file = path.join(root, "routines/routines.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

/** Données d'écran fictives, validées par le store AVANT tout chargement du moteur. */
function preparerCanevas() {
  const { RoutineStore } = require(path.join(appDir, "dist-electron/routines/store.js"));
  const { nextOccurrence } = require(path.join(appDir, "dist-electron/routines/schedule.js"));
  const now = Date.now();
  const jour = 86_400_000;
  const iso = (offset = 0) => new Date(now + offset).toISOString();
  const timezone = "UTC";
  const routine = (id, agentId, name, instruction, schedule, rang, extras = {}) => ({
    id, agentId, name, instruction, schedule, timezone, active: true,
    nextRunAt: nextOccurrence(schedule, timezone, new Date(now)), missedPolicy: "skip", projectId: null,
    createdAt: iso(-60 * jour + rang * 60_000), updatedAt: iso(-jour), ...extras,
  });
  const routines = [
    routine("canevas-point", "principal", "Point quotidien fictif", "Fais le point sur les tâches fictives.\nSignale les échéances proches.\nSignale les blocages.\nIndique les décisions qui attendent.\nAucune donnée métier n’est consultée.\nCette longue consigne sert à vérifier son affichage complet.", { kind: "daily", time: "23:59" }, 0),
    routine("canevas-attente", "principal", "Accord fictif", "[permission] Demande une autorisation fictive. Aucune commande ne sera exécutée.", { kind: "manual" }, 1),
    routine("canevas-dev", "dev", "Travail long fictif", "[long] Attends dans le faux agent afin de vérifier l’interruption. Aucun programme n’est lancé.", { kind: "manual" }, 2),
    routine("canevas-design", "designer", "Revue fictive", "Vérifie seulement la réponse du faux agent, sans page ni fichier réel.", { kind: "weekly", weekday: 1, time: "09:00" }, 3),
    routine("canevas-relais", "principal", "Ancienne chaîne fictive", "Consigne conservée du premier agent fictif.", { kind: "daily", time: "23:59" }, 4, {
      active: false, nextRunAt: null,
      relais: [
        { id: "relais-fictif-1", de: "principal", vers: "dev", consigne: "Relais fictif conservé vers le développeur." },
        { id: "relais-fictif-2", de: "dev", vers: "designer", consigne: "Relais fictif conservé vers le designer." },
      ],
      blockedReason: "Cette ancienne routine contient des relais entre agents. Ses données sont conservées, mais elle ne peut pas être exécutée comme une routine à un seul agent.",
    }),
    routine("canevas-absent", "absent-fictif", "Agent absent fictif", "Aucune fiche de cet agent fictif n’existe dans ce profil temporaire.", { kind: "daily", time: "23:59" }, 5),
    routine("canevas-desactive", "archive-fictif", "Agent désactivé fictif", "L’agent de test reste désactivé ; aucune action métier.", { kind: "daily", time: "23:59" }, 6),
  ];
  // Deux fiches propres au cas canevas : un agent désactivé et un agent actif sans routine.
  for (const [id, name, actif] of [["archive-fictif", "Agent désactivé fictif", false], ["sans-routine", "Agent sans routine fictif", true]]) {
    fichiersAgents[id] = `---\nname: ${id}\ndisplayName: ${name}\ndescription: Profil de test du canevas\nmodel: sonnet\n---\n# ${name}\nAucune donnée réelle.\n`;
    fs.writeFileSync(path.join(agentsDir, `${id}.md`), fichiersAgents[id]);
    mes.agents[id] = { actif, ajouteLe: now, origine: { type: "local" }, empreinte: null };
  }
  const runs = Array.from({ length: 55 }, (_, i) => {
    const at = iso(-(55 - i) * jour);
    const status = i === 54 ? "succeeded" : ["succeeded", "failed", "interrupted", "cancelled"][i % 4];
    return {
      id: `canevas-historique-${String(i + 1).padStart(2, "0")}`, routineId: "canevas-point", agentId: "principal",
      kind: "scheduled", scheduledFor: at, routineName: "Point quotidien fictif — version précédente",
      instruction: "Ancienne consigne fictive figée au lancement.", projectId: null, status,
      error: status === "failed" ? "Échec fictif : la source de test est indisponible." : status === "interrupted" ? "Exécution fictive interrompue." : status === "cancelled" ? "Annulée avant son lancement." : null,
      dispatchedAt: at, delivery: { chatId: "dm-principal", messageId: `canevas-message-${i + 1}` },
      result: status === "succeeded" ? `Résultat fictif ${i + 1} : aucun service externe ni donnée réelle n’a été consulté.` : null,
      createdAt: at, startedAt: status === "cancelled" ? null : new Date(Date.parse(at) + 1000).toISOString(),
      finishedAt: new Date(Date.parse(at) + 4000).toISOString(), updatedAt: new Date(Date.parse(at) + 4000).toISOString(),
    };
  });
  const store = new RoutineStore(path.join(root, "routines"));
  store.load();
  store.transaction((data) => { data.routines.push(...routines); data.runs.push(...runs); });
  // Les liens historiques mènent à de vrais messages de ce profil fictif.
  const conversationFile = path.join(root, "conversations.json");
  const data = JSON.parse(fs.readFileSync(conversationFile, "utf8"));
  data.chats = ["principal", ...Object.keys(fichiersAgents), "absent-fictif"].map((id) => ({
    id: `dm-${id}`, kind: "direct", projectId: null, title: "", roleIds: [id], updatedAt: iso(), sessions: {}, luJusqua: null,
  }));
  data.messages = runs.map((run) => ({
    id: run.delivery.messageId, chatId: run.delivery.chatId, author: { kind: "role", roleId: "principal" },
    createdAt: run.finishedAt, parts: [{ type: "text", text: run.result ?? run.error }],
    statut: run.status === "succeeded" ? "fait" : "erreur", routineRun: run.id,
  }));
  fs.writeFileSync(conversationFile, JSON.stringify(data));
  assert.equal(store.history("canevas-point", 100).length, 55);
  assert.equal(store.routines.length, 7);
  console.log(`Cas canevas préparé avant le moteur : ${routines.map((r) => r.id).join(", ")}.`);
  console.log("Agent actif sans routine : sans-routine. Historique canevas-point : 55 lignes et messages fictifs liés.");
}

function streamAgent(client, requestId, options) {
  if (typeof requestId !== "string" || !options || typeof options.prompt !== "string") throw new Error("Demande fictive invalide.");
  const observer = options.routineRun
    ? api.commencerRoutine(options.routineRun, options.chatId ?? "", requestId, options.agent ?? "principal")
    : (event) => event;
  if (streams.has(requestId)) throw new Error("Cette réponse fictive a déjà commencé.");
  const run = options.routineRun ? lireStore()?.runs.find((r) => r.id === options.routineRun) : null;
  const instruction = run?.instruction ?? options.prompt;
  const permission = /\[permission\]/i.test(instruction);
  const long = /\[long\]/i.test(instruction);
  const error = /\[erreur\]/i.test(instruction);
  const declared = /\[echec-declare\]/i.test(instruction);
  const quiet = /\[rien\]/i.test(instruction);
  const caller = { routineRun: options.routineRun, chatId: options.chatId, roleId: options.agent ?? "principal" };
  const emit = (event) => client.send("claude:event", requestId, observer(event));
  const stream = { options, emit, timers: [], permission: null, finish: null };
  stream.finish = () => {
    if (declared && options.routineRun) signals.signaler(caller, "failed", "Échec déclaré par le faux agent : source fictive indisponible.");
    if (quiet && options.routineRun) signals.signaler(caller, "no-update");
    const texte = quiet ? "" : `Résultat fictif : ${run?.routineName ?? "conversation de test"}. Le faux agent a terminé ; aucun compte ni service externe n’a été appelé.`;
    if (texte) emit({ type: "texte", delta: texte, nouveauBloc: false });
    terminer(requestId, { type: "fin", ok: !error, texte: error ? "" : texte, ...(error ? { erreur: "Erreur simulée : source fictive indisponible." } : {}) });
  };
  streams.set(requestId, stream);
  trace("agent-start", { requestId, runId: options.routineRun ?? null, agentId: options.agent ?? "principal", mode: permission ? "permission" : long ? "long" : error ? "erreur" : declared ? "echec-declare" : quiet ? "rien" : "normal" });
  stream.timers.push(setTimeout(() => {
    emit({ type: "session", sessionId: `session-fictive-${requestId}` });
    if (permission) {
      stream.permission = `permission-${requestId}`;
      emit({ type: "autorisation", id: stream.permission, outil: "Bash", entree: { command: "commande fictive — aucune exécution système" }, description: "Autorisation fictive : aucun programme ne sera exécuté." });
    } else {
      stream.timers.push(setTimeout(stream.finish, long ? 60000 : 1000));
    }
  }, 120));
  return null;
}

function listing() {
  return { dir: agentsDir, exists: true, agents: Object.entries(fichiersAgents).filter(([id]) => fs.existsSync(path.join(agentsDir, `${id}.md`))).map(([id, content]) => ({
    name: id, path: path.join(agentsDir, `${id}.md`), content, empreinte: `fictif-${id}`, modifiedAt: 1,
  })) };
}

async function invoke(client, name, args) {
  if (moteurArrete && name.startsWith("routines:")) {
    if (name === "routines:etat") return ok({ actif: false, erreur: "Moteur arrêté dans le profil fictif. Aucun départ n’est possible." });
    return fail("Le moteur du profil fictif est arrêté.", "indisponible");
  }
  if (handlers.has(name)) return handlers.get(name)({ sender: client }, ...args);
  try {
    switch (name) {
      case "conversations:read": return ok(await conversations.readConversations());
      case "conversations:write": await conversations.writeConversations(args[0]); return ok();
      case "claude:stream": return ok(streamAgent(client, ...args));
      case "claude:cancel": cancelAgent(args[0]); return ok();
      case "claude:autoriser": {
        const stream = streams.get(args[0]);
        if (!stream || stream.permission !== args[1]) return fail("Permission fictive introuvable.");
        if (!["oui", "toujours", "non"].includes(args[2])) return fail("Décision invalide.");
        const accepte = args[2] !== "non";
        stream.emit({ type: "autorisation-fin", id: args[1], accepte });
        stream.permission = null;
        if (accepte) stream.timers.push(setTimeout(stream.finish, 500));
        else terminer(args[0], { type: "fin", ok: false, texte: "", erreur: "Autorisation fictive refusée." });
        return ok();
      }
      case "claude:status": return ok({ path: "faux-agent-sans-processus" });
      case "claude:compte": return ok({ installe: true, chemin: "faux-agent-sans-processus", version: "simulation", connecte: true, methode: "fixture", email: "fictif@example.invalid", organisation: null, abonnement: null, verifieLe: Date.now() });
      case "claude:utilisation": case "claude:utilisation:actualiser": return ok({ session: null, semaine: null, statut: "Simulation locale sans coût", misAJour: Date.now() });
      case "agents:list": return ok(listing());
      case "agents:mes": return ok(mes);
      case "agents:meta:read": return ok(meta);
      case "agents:meta:write": meta = args[0]; broadcast("agents:changed"); return ok();
      case "agents:mes:assistant": mes.assistant = { nom: args[0], teinte: args[1] ?? null }; broadcast("agents:changed"); return ok(mes);
      case "agents:mes:activer":
        if (!mes.agents[args[0]]) return fail("Agent fictif inconnu.");
        mes.agents[args[0]].actif = args[1] === true; broadcast("agents:changed"); return ok(mes);
      case "agents:history": return ok([]);
      case "agents:recue": return ok(null);
      case "systeme:utilisateur": return ok({ nom: "Profil fictif", identifiant: "fictif" });
      case "systeme:sons-coupes": return ok(true);
      case "systeme:micro": return ok(false);
      case "reglages:lire": return ok(reglages);
      case "reglages:ecrire": reglages = args[0]; return ok(reglages);
      case "reglages:lancement": return ok({ actif: false, disponible: false });
      case "reglages:infos": return ok({ version: "profil-fictif", installee: false, plateforme: "linux", electron: "simulé", dossiers: { donnees: root, klyra: root, agents: agentsDir } });
      case "reglages:computer-use:autorisations": return ok({ plateforme: "linux", accessibilite: "sans-objet", ecran: "sans-objet" });
      case "ia:lister": case "ia:fournisseurs": case "artefacts:lister": case "projets:arbre": case "projets:pages": return ok([]);
      case "projets:dossier-existe": return ok(args[0] === projectDir);
      case "git:etat": return ok({ depot: false, branche: null, suivie: false, enAvance: 0, fichiers: [], distant: null });
      case "consommation:lire": return ok({ entrees: [], depuis: null, historique: null });
      case "anthropic-admin:etat": return ok({ configuree: false });
      case "maj:etat": return ok({ version: "profil-fictif", statut: "dev", nouvelle: null, disponible: null, progression: null, verifieeLe: null, erreur: null, depot: "simulation" });
      case "compte:jeton:lire": case "compte:code": return ok(null);
      case "dictee:etat": return ok({ moteur: "local", cleElevenLabs: false, modele: "rapide", modeles: [], pret: false });
      case "planning:ecrire": case "systeme:notifier": case "outils:reponse": return ok();
      default: trace("ipc-non-simule", { name }); return fail(`« ${name} » n’est pas disponible dans le profil fictif.`);
    }
  } catch (error) { return fail(error.message, error.code ?? "fixture"); }
}

/** Cette fonction seule s'exécute dans le navigateur, avant les scripts Next. */
function navigateur() {
  const listeners = new Map();
  const clientId = crypto.randomUUID();
  const events = new EventSource(`/__fixture/events?client=${clientId}`);
  const ready = new Promise((resolve) => events.addEventListener("open", resolve, { once: true }));
  events.onmessage = ({ data }) => {
    const { name, args } = JSON.parse(data);
    for (const listener of listeners.get(name) ?? []) listener({}, ...args);
  };
  const ipcRenderer = {
    invoke: async (name, ...args) => {
      await ready;
      const response = await fetch("/__fixture/invoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, name, args }) });
      return response.json();
    },
    send: (name, ...args) => { void ipcRenderer.invoke(name, ...args); },
    on: (name, listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeListener: (name, listener) => listeners.get(name)?.delete(listener),
  };
  window.addEventListener("pagehide", () => events.close(), { once: true });
  window.__fixtureElectron = {
    ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => Object.defineProperty(window, name, { value, configurable: false }) },
    webUtils: { getPathForFile: () => "" },
  };
}

function injection() {
  const preload = fs.readFileSync(path.join(appDir, "dist-electron/preload.js"), "utf8");
  return `(${navigateur.toString()})();\n(function(require,exports,process){\n${preload}\n})(name=>{if(name!=="electron")throw new Error("Module refusé dans la fixture");return window.__fixtureElectron;},{},{argv:[]});\ndelete window.__fixtureElectron;`;
}

const mimes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon", ".wav": "audio/wav", ".mp3": "audio/mpeg" };
const CSP = "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
function json(res, value, status = 200) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); }
async function body(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8 * 1024 * 1024) throw new Error("Requête trop grande.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? "";
    if (!/^(?:localhost|127\.0\.0\.1):\d+$/.test(host)) return json(res, fail("Hôte refusé."), 403);
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, fail("Origine refusée."), 403);
    const url = new URL(req.url, `http://${host}`);
    res.setHeader("content-security-policy", CSP);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "no-store");
    if (url.pathname === "/__fixture/bridge.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }); return res.end(injection());
    }
    if (url.pathname === "/__fixture/state") return json(res, { simulated: true, store: lireStore(), conversations: await conversations.readConversations(), journal });
    if (url.pathname === "/__fixture/events" && req.method === "GET") {
      const id = url.searchParams.get("client");
      if (!id || !/^[\w-]{1,80}$/.test(id) || clients.has(id)) return json(res, fail("Fenêtre fictive invalide."), 400);
      const client = new EventEmitter();
      client.destroyed = false;
      client.isDestroyed = () => client.destroyed;
      client.send = (name, ...args) => { if (!client.destroyed) res.write(`data: ${JSON.stringify({ name, args })}\n\n`); };
      clients.set(id, client);
      res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(": profil fictif connecté\n\n");
      const heartbeat = setInterval(() => res.write(": battement\n\n"), 15000);
      res.on("close", () => {
        clearInterval(heartbeat);
        client.emit("did-navigate");
        client.destroyed = true;
        clients.delete(id);
        trace("fenetre-fermee", { clientId: id });
      });
      return;
    }
    if (url.pathname === "/__fixture/invoke" && req.method === "POST") {
      const { clientId, name, args } = await body(req);
      const client = clients.get(clientId);
      if (!client || typeof name !== "string" || !Array.isArray(args)) return json(res, fail("Fenêtre fictive non connectée."), 400);
      return json(res, await invoke(client, name, args));
    }
    if (url.pathname === "/__fixture/control" && req.method === "POST") {
      const { action, agentId } = await body(req);
      if (action === "suspend" || action === "resume") powerMonitor.emit(action);
      else if (["desactiver", "activer", "retirer", "restaurer"].includes(action) && Object.hasOwn(fichiersAgents, agentId)) {
        if (action === "activer" || action === "desactiver") mes.agents[agentId].actif = action === "activer";
        if (action === "retirer") fs.rmSync(path.join(agentsDir, `${agentId}.md`), { force: true });
        if (action === "restaurer") fs.writeFileSync(path.join(agentsDir, `${agentId}.md`), fichiersAgents[agentId]);
        broadcast("agents:changed");
      } else return json(res, fail("Action fictive inconnue."), 400);
      trace("controle", { action, agentId });
      return json(res, ok());
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, fail("Méthode refusée."), 405);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const candidates = [relative || "index.html", `${relative}.html`, path.join(relative, "index.html")];
    const file = candidates.map((entry) => path.resolve(outDir, entry)).find((entry) => {
      if (!entry.startsWith(`${outDir}${path.sep}`)) return false;
      try { return fs.statSync(entry).isFile() && fs.realpathSync(entry).startsWith(`${fs.realpathSync(outDir)}${path.sep}`); } catch { return false; }
    });
    if (!file) return json(res, fail("Fichier exporté introuvable."), 404);
    const ext = path.extname(file);
    let content = fs.readFileSync(file);
    if (ext === ".html") content = Buffer.from(content.toString("utf8").replace("<head>", `<head><script src="/__fixture/bridge.js"></script><style>html::after{content:"Profil fictif · aucun appel IA";position:fixed;right:12px;bottom:4px;z-index:2147483647;padding:3px 8px;background:#111;color:#fff;font:11px system-ui;pointer-events:none;border-radius:4px}</style>`));
    res.writeHead(200, { "content-type": mimes[ext] ?? "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) { if (!res.headersSent) json(res, fail(error.message), 500); else res.end(); }
});

async function shutdown() {
  if (closing) return;
  closing = true;
  for (const client of clients.values()) client.emit("did-navigate");
  for (const id of streams.keys()) cancelAgent(id);
  api.arreterRoutines();
  await conversations.ecrituresTerminees();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function verifier(base) {
  const clientId = randomUUID();
  const abort = new AbortController();
  const response = await fetch(`${base}/__fixture/events?client=${clientId}`, { signal: abort.signal });
  const reader = response.body.getReader();
  await reader.read();
  const call = async (name, ...args) => {
    const res = await fetch(`${base}/__fixture/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, name, args }) });
    return res.json();
  };
  const wait = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("État fictif attendu non observé.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  assert.equal((await call("routines:etat")).data.actif, true);
  assert.equal((await call("routines:pret")).ok, true);
  const html = await (await fetch(`${base}/routines`)).text();
  assert.ok(html.indexOf("/__fixture/bridge.js") < html.indexOf("/_next/"));
  const routine = (await call("routines:creer", { agentId: "principal", name: "Vérification fictive", instruction: "Sans action métier", schedule: { kind: "manual" }, timezone: "Europe/Paris" })).data;
  const run = (await call("routines:executer", routine.id)).data;
  const data = (await call("conversations:read")).data;
  data.messages.push({ id: "question", chatId: "dm-principal", author: { kind: "user" }, routineRun: run.id, parts: [{ type: "texte", texte: "Consigne fictive" }] });
  assert.equal((await call("conversations:write", data)).ok, true);
  const options = { agent: null, prompt: "Fictif", chatId: "dm-principal", routineRun: run.id };
  assert.equal((await call("claude:stream", "answer", options)).ok, true);
  assert.equal((await call("claude:stream", "answer", options)).ok, false);
  assert.equal(lireStore().runs[0].status, "running");
  await wait(() => lireStore().runs[0].status === "succeeded");
  assert.equal(journal.filter((row) => row.type === "agent-start").length, 1);
  assert.equal((await call("conversations:read")).data.messages[0].routineRun, run.id);
  assert.match(lireStore().runs[0].result, /Résultat fictif/);
  await call("routines:modifier", routine.id, { instruction: "[permission]" });
  const permission = (await call("routines:executer", routine.id)).data;
  await call("claude:stream", "permission-answer", { ...options, routineRun: permission.id });
  await wait(() => lireStore().runs.at(-1).status === "needs-attention");
  assert.equal((await call("claude:autoriser", "permission-answer", "permission-permission-answer", "non")).ok, true);
  assert.equal(lireStore().runs.at(-1).status, "failed");
  await call("routines:modifier", routine.id, { instruction: "[long]" });
  const long = (await call("routines:executer", routine.id)).data;
  await call("claude:stream", "long-answer", { ...options, routineRun: long.id });
  abort.abort();
  await wait(() => lireStore().runs.at(-1).status === "interrupted");
  assert.equal(streams.size, 0);
  assert.equal((await fetch(`${base}/__fixture/invoke`, { method: "POST", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  console.log("SELF-TEST OK : injection préalable, CRUD moteur, conversation durable, claim unique, résultat, permission refusée, rechargement/interruption, origine et accès fichiers.");
}

async function main() {
  if (cas === "canevas") preparerCanevas();
  chargerAdaptateur();
  if (!moteurArrete) await api.demarrerRoutines();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`PROFIL FICTIF : ${base}/routines?vue=routines`);
  console.log(`Données temporaires : ${root}`);
  console.log(`Export servi : ${outDir}`);
  if (moteurArrete) console.log("Moteur arrêté simulé : etat.actif=false ; les autres IPC routines refusent les gestes.");
  console.log("Aucun fournisseur réel. Modes dans la consigne : [permission], [long], [erreur], [echec-declare], [rien].");
  if (selfTest) {
    try {
      if (cas || moteurArrete) {
        const client = new EventEmitter();
        const etat = await invoke(client, "routines:etat", []);
        assert.equal(etat.ok, true);
        assert.equal(etat.data.actif, !moteurArrete);
        if (moteurArrete) {
          assert.match(etat.data.erreur, /Moteur arrêté/);
          assert.equal((await invoke(client, "routines:creer", [{}])).code, "indisponible");
        }
        if (cas === "canevas") {
          const store = lireStore();
          assert.equal(store.routines.length, 7);
          assert.equal(store.runs.length, 55);
          assert.equal(store.routines.find((r) => r.id === "canevas-relais").active, false);
          assert.equal((await conversations.readConversations()).messages.length, 55);
          if (!moteurArrete) {
            assert.equal((await invoke(client, "routines:historique", ["canevas-point", 51])).data.length, 51);
            assert.equal((await invoke(client, "routines:executer", ["canevas-relais"])).code, "relais-incompatibles");
          }
        }
        console.log("SELF-TEST CAS OK : seed validé avant moteur, historique et conversations fictifs, relais bloqués, état du moteur conforme.");
      } else await verifier(base);
    } finally { await shutdown(); fs.rmSync(root, { recursive: true, force: true }); }
  }
  else for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void shutdown().then(() => process.exit(0)); });
}

main().catch(async (error) => { console.error(error); process.exitCode = 1; if (api) await shutdown(); });
