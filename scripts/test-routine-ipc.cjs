/* eslint-disable @typescript-eslint/no-require-imports -- modules Electron CommonJS compilés, chargés avec un hôte de test. */
/** Adaptateur Electron réel, avec IPC/fenêtre/agents simulés et fichiers temporaires.
 * Aucun navigateur, compte, fournisseur ou agent réel n'est lancé. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const modulePath = path.resolve(__dirname, "../dist-electron/routines/index.js");
const conversationsPath = path.resolve(__dirname, "../dist-electron/conversations.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-routine-ipc-"));
let index = 0;
let passed = 0;

async function fixture(initial, dossierExistant) {
  const dir = dossierExistant ?? path.join(root, String(++index));
  fs.mkdirSync(dir, { recursive: true });
  const fiches = path.join(dir, "agents");
  fs.mkdirSync(fiches, { recursive: true });
  fs.writeFileSync(path.join(fiches, "dev.md"), "Agent fictif");
  if (initial !== undefined) fs.writeFileSync(path.join(dir, "conversations.json"), typeof initial === "string" ? initial : JSON.stringify(initial));
  const active = new Set(["dev"]);
  const handlers = new Map();
  const events = [];
  const cancels = [];
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.send = (name, ...args) => events.push([name, ...args]);
  let signals;
  const electron = {
    app: { getPath: () => dir },
    BrowserWindow: { getAllWindows: () => [{ webContents: window }] },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    powerMonitor: new EventEmitter(),
  };
  const load = Module._load;
  Module._load = function (name, parent, ...rest) {
    if (name === "electron") return electron;
    if (parent?.filename === modulePath) {
      if (name === "../claude") return { cancelAgent: (id) => cancels.push(id) };
      if (name === "../mes-agents") return { dossierAgents: () => fiches, estActif: (id) => active.has(id) };
      if (name === "../ia") return { brancherOutilsRoutines: (value) => { signals = value; } };
    }
    return load.call(this, name, parent, ...rest);
  };
  delete require.cache[modulePath];
  delete require.cache[conversationsPath];
  let api;
  try { api = require(modulePath); } finally { Module._load = load; }
  api.brancherRoutines();
  await api.demarrerRoutines();
  const call = (name, ...args) => handlers.get(`routines:${name}`)({ sender: window }, ...args);
  const data = () => JSON.parse(fs.readFileSync(path.join(dir, "routines/routines.json"), "utf8"));
  const create = async (agentId = "principal") => {
    const response = await call("creer", { agentId, name: "Routine fictive", instruction: "Test local sans action", schedule: { kind: "manual" }, timezone: "Europe/Paris" });
    assert.equal(response.ok, true, response.message);
    return response.data;
  };
  const run = async (routine) => {
    const response = await call("executer", routine.id);
    assert.equal(response.ok, true, response.message);
    return response.data;
  };
  return { api, call, create, run, data, dir, fiches, active, events, cancels, window, signals, close: () => api.arreterRoutines() };
}

async function test(name, initial, body) {
  const f = await fixture(initial);
  try { await body(f); passed++; console.log(`OK ${name}`); } finally { f.close(); }
}

async function main() {
  await test("claim durable avant envoi, doublon et rechargement <400 ms", undefined, async (f) => {
    await f.call("pret");
    const r = await f.create();
    const run = await f.run(r);
    let sends = 0;
    const send = () => { const observer = f.api.commencerRoutine(run.id, "dm-principal", `routine-answer-${run.id}`, "principal"); sends++; return observer; };
    send();
    assert.equal(f.data().runs[0].status, "running");
    assert.throws(send, /déjà/);
    f.window.emit("did-navigate");
    assert.equal(f.data().runs[0].status, "interrupted");
    await f.call("pret");
    assert.throws(send, /déjà/);
    assert.equal(sends, 1);
    assert.equal(f.cancels.length, 1);
  });
  await test("deux permissions, résultat réel et lien persistés", undefined, async (f) => {
    await f.call("pret");
    const run = await f.run(await f.create());
    const emit = f.api.commencerRoutine(run.id, "dm-principal", "answer", "principal");
    for (const id of ["a", "b"]) emit({ type: "autorisation", id });
    emit({ type: "autorisation-fin", id: "a", accepte: true });
    assert.equal(f.data().runs[0].status, "needs-attention");
    await f.call("signaler", run.id, { state: "succeeded", chatId: "dm-principal", messageId: "answer", result: "renderer" });
    assert.equal(f.data().runs[0].status, "needs-attention");
    emit({ type: "autorisation-fin", id: "b", accepte: false });
    assert.equal(f.data().runs[0].status, "running");
    emit({ type: "fin", ok: false, texte: "", erreur: "Permission refusée" });
    assert.equal(f.data().runs[0].status, "failed");
    assert.equal(f.data().runs[0].error, "Permission refusée");
    assert.equal(f.data().runs[0].delivery.messageId, "answer");
  });
  await test("agent désactivé ou fiche retirée après mise en file", undefined, async (f) => {
    await f.call("pret");
    const r = await f.create("dev");
    const a = await f.run(r);
    f.active.delete("dev");
    assert.throws(() => f.api.commencerRoutine(a.id, "dm-dev", "a", "dev"), /désactivé/);
    assert.equal(f.data().runs[0].status, "failed");
    f.active.add("dev");
    const b = await f.run(r);
    fs.unlinkSync(path.join(f.fiches, "dev.md"));
    assert.throws(() => f.api.commencerRoutine(b.id, "dm-dev", "b", "dev"), /introuvable/);
    assert.equal(f.data().runs.at(-1).status, "failed");
  });
  await test("signaux bornés au run et échec déclaré transmis à la conversation", undefined, async (f) => {
    await f.call("pret");
    const r = await f.create();
    const run = await f.run(r);
    const caller = { routineRun: run.id, chatId: "dm-principal", roleId: "principal" };
    assert.equal(f.signals.active(caller), false);
    const emit = f.api.commencerRoutine(run.id, caller.chatId, "answer", caller.roleId);
    assert.equal(f.signals.active({ ...caller, routineRun: "inconnu" }), false);
    assert.equal(f.signals.active({ ...caller, roleId: "dev" }), false);
    assert.equal(f.signals.active(caller), true);
    f.signals.signaler(caller, "failed", "Source indisponible");
    assert.equal(f.data().runs[0].status, "running");
    const result = emit({ type: "fin", ok: true, texte: "Constat" });
    assert.equal(result.ok, false);
    assert.equal(result.erreur, "Source indisponible");
    assert.equal(f.data().runs[0].status, "failed");
    assert.equal(f.signals.active(caller), false);
    const second = await f.run(r);
    const finish = f.api.commencerRoutine(second.id, caller.chatId, "answer2", caller.roleId);
    f.signals.signaler({ ...caller, routineRun: second.id }, "no-update");
    assert.equal(finish({ type: "fin", ok: true, texte: "" }).silencieux, true);
    assert.equal(f.data().runs.at(-1).outcome, "no-update");
  });
  await test("erreur disque : aucun claim, résultat final retenté", undefined, async (f) => {
    await f.call("pret");
    const run = await f.run(await f.create());
    const tmp = path.join(f.dir, "routines/routines.json.tmp");
    fs.mkdirSync(tmp);
    assert.throws(() => f.api.commencerRoutine(run.id, "dm-principal", "answer", "principal"));
    assert.equal(f.data().runs[0].status, "queued");
    fs.rmdirSync(tmp);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(f.data().runs[0].status, "failed", "le refus de claim termine le run sans relance manuelle");
    const second = await f.run(await f.create());
    const emit = f.api.commencerRoutine(second.id, "dm-principal", "answer2", "principal");
    fs.mkdirSync(tmp);
    emit({ type: "fin", ok: true, texte: "Résultat conservé" });
    assert.match((await f.call("etat")).data.erreur, /enregistré/);
    fs.rmdirSync(tmp);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(f.data().runs.at(-1).status, "succeeded");
    assert.equal(f.data().runs.at(-1).result, "Résultat conservé");
  });
  await test("retry d'une ancienne fenêtre : le nouveau run reste intact", undefined, async (f) => {
    await f.call("pret");
    const premier = await f.run(await f.create());
    f.api.commencerRoutine(premier.id, "dm-principal", "reponse-ancienne", "principal");
    const tmp = path.join(f.dir, "routines/routines.json.tmp");
    fs.mkdirSync(tmp);
    f.window.emit("did-navigate");
    assert.deepEqual(f.cancels, ["reponse-ancienne"]);
    fs.rmdirSync(tmp);
    await f.call("pret");
    const second = await f.run(await f.create("dev"));
    f.api.commencerRoutine(second.id, "dm-dev", "reponse-nouvelle", "dev");
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(f.data().runs.find((r) => r.id === premier.id).status, "interrupted");
    assert.equal(f.data().runs.find((r) => r.id === second.id).status, "running");
    assert.deepEqual(f.cancels, ["reponse-ancienne"]);
  });
  await test("lecture après sauvegarde ratée : conversations intactes", { version: 1, chats: [{ id: "a-conserver" }], routines: [], workflows: [{ id: "workflow-a-conserver" }] }, async (f) => {
    const conversations = require(conversationsPath);
    const avant = await conversations.readConversations();
    const tmp = path.join(f.dir, "conversations.json.tmp");
    fs.mkdirSync(tmp);
    await assert.rejects(conversations.writeConversations({ version: 1, chats: [] }));
    fs.rmdirSync(tmp);
    assert.deepEqual(await conversations.readConversations(), avant);
  });
  const legacy = { version: 1, routines: [{ id: "ancien", nom: "Chaîne historique", roleId: "principal", consigne: "Ancienne consigne", frequence: { type: "jour", heure: "12:00" }, active: true, historique: [{ ancien: "résultat inchangé" }], relais: [{ id: "lien", de: "principal", vers: "dev", consigne: "Suite" }] }] };
  await test("migration sauvegardée : relais conservés et bloqués", legacy, async (f) => {
    const source = fs.readFileSync(path.join(f.dir, "conversations.json"), "utf8");
    assert.equal(source, JSON.stringify(legacy));
    assert.equal(fs.readFileSync(path.join(f.dir, "routines/conversations-avant-migration.json"), "utf8"), source);
    const routine = f.data().routines[0];
    assert.equal(routine.active, false);
    assert.match(routine.blockedReason, /relais/);
    assert.deepEqual(routine.relais, legacy.routines[0].relais);
    assert.equal((await f.call("executer", routine.id)).ok, false);
  });
  const rappel = { id: "rappel-temoin", titre: "Rappel fictif", notes: "Notes intactes", liste: "perso", date: "2026-11-02", heure: "09:00", fin: "2026-11-03", priorite: 2, signalee: true, faite: false, faiteLe: null, projectId: "projet-fictif", creeLe: "2026-10-30T10:00:00Z", notifiee: true };
  const avantRappels = { ...legacy, taches: [{ ...rappel, id: "avant" }, rappel, { ...rappel, id: "apres" }], chats: [{ id: "temoin" }], messages: [] };
  for (const annuler of [false, true]) {
    await test(`sauvegarde ancienne des routines : rappel ${annuler ? "restauré intact" : "supprimé absent"} après redémarrage`, avantRappels, async (f) => {
      const conversations = require(conversationsPath);
      const sansRappel = { ...avantRappels, taches: avantRappels.taches.filter((t) => t.id !== rappel.id) };
      // Deux écritures déjà demandées, comme une livraison de routine puis un clic.
      const ecritures = [conversations.writeConversations(avantRappels), conversations.writeConversations(sansRappel)];
      if (annuler) ecritures.push(conversations.writeConversations(avantRappels));
      await Promise.all(ecritures);
      const attendu = annuler ? avantRappels : sansRappel;
      assert.deepEqual(await conversations.readConversations(), attendu);
      f.close();
      const reprise = await fixture(undefined, f.dir);
      try {
        await reprise.call("pret");
        assert.deepEqual(await require(conversationsPath).readConversations(), attendu);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, "routines/conversations-avant-migration.json"), "utf8")), avantRappels);
        assert.equal(reprise.data().routines.length, 1);
        assert.equal(reprise.data().routines[0].active, false);
        assert.equal(reprise.data().runs.length, 0);
        assert.equal(reprise.events.filter(([canal]) => canal === "routines:livrer").length, 0);
      } finally { reprise.close(); }
    });
  }
  await test("fichier legacy illisible : erreur fermée, aucune réécriture", "{illisible", async (f) => {
    const state = (await f.call("etat")).data;
    assert.equal(state.actif, false);
    assert.ok(state.erreur);
    assert.equal(fs.readFileSync(path.join(f.dir, "conversations.json"), "utf8"), "{illisible");
    assert.equal(fs.existsSync(path.join(f.dir, "routines/routines.json")), false);
  });
  console.log(`${passed} scénarios IPC routines vérifiés, sans agent réel.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
