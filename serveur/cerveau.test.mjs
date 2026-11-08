import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { creerAgents } from "./agents.mjs";
import { creerIa } from "./ia.mjs";
import { CHEMIN_APPAIRER, creerCode, creerJournal, ecouter } from "./klyra-serveur.mjs";
import { ouvrirCerveau } from "./cerveau.mjs";
import { importerDocuments } from "./cerveau-service.mjs";

const note = { id: "doc-test", titre: "Note du serveur", contenu: "Une connaissance durable et ciblée.", projetId: null, liens: [], source: null, creeLe: "", modifieLe: "" };
test("API authentifiée : le stockage est sur le serveur, les métadonnées sont paginées et le contenu se lit à la demande", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-api-")), home = path.join(tmp, "home");
  mkdirSync(home);
  const journal = creerJournal(), agents = creerAgents({ home, donnees: tmp, nomServeur: "Test", publier: journal.publier });
  const e = await ecouter({ dossier: tmp, agents, journal, port: 0 });
  const url = `http://127.0.0.1:${e.port}`;
  try {
    const non = await fetch(`${url}/klyra/v1/agent/cerveau`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lister", args: {} }) });
    assert.equal(non.status, 401);
    const pair = await fetch(url + CHEMIN_APPAIRER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: creerCode(tmp) }) });
    const { jeton } = await pair.json();
    const appel = async (action, args = {}) => { const r = await fetch(`${url}/klyra/v1/agent/cerveau`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` }, body: JSON.stringify({ action, args }) }); assert.equal(r.status, 200); return (await r.json()).resultat; };
    const fond = path.join(home, "DIGITAL-OS"); mkdirSync(path.join(fond, "10_PERSONAL"), { recursive: true });
    writeFileSync(path.join(fond, "10_PERSONAL", "carnet.md"), "Un carnet astronomique fictif sur le serveur.");
    const source = await appel("digital-os-connecter", { racine: path.join(tmp, "interdit") });
    assert.equal(source.racine, fond);
    const arbre = await appel("digital-os-parcourir"); assert.equal(arbre.entrees[0].nom, "10_PERSONAL");
    await appel("digital-os-demarrer");
    for (let i = 0; i < 100; i++) { const e = await appel("digital-os-etat"); if (e.etat !== "indexation") { assert.equal(e.etat, "termine"); break; } await new Promise((r) => setTimeout(r, 10)); }
    assert.equal((await appel("chercher", { requete: "astronomique", apercuAgent: "principal" })).elements.length, 1);
    const gardee = await appel("garder", { note });
    const page = await appel("lister"); assert.equal(page.total, 2); assert.equal(page.notes[0].contenu, "");
    assert.equal((await appel("note", { id: gardee.id })).contenu, note.contenu);
    const trouve = await appel("chercher", { requete: "durable", budgetOctets: 1024 });
    assert.ok(Buffer.byteLength(JSON.stringify(trouve)) <= 1024);
    const lu = await appel("lire", { ids: trouve.elements.map((p) => p.id) }); assert.equal(lu.elements[0].extrait, note.contenu);
  } finally { await e.fermer(); rmSync(tmp, { recursive: true, force: true }); }
});
test("les vrais outils MCP existent sans IA payante et ne prennent pas le projet dans les arguments", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-mcp-"));
  const ia = creerIa({ donnees: tmp, version: "test" });
  try {
    const c = ouvrirCerveau(tmp);
    c.garder({ ...note, projetId: "projet-a" });
    c.garder({ ...note, id: "secret", projetId: "projet-b", contenu: "Une connaissance durable dans un autre projet." });
    const chat = "test-chat", dossier = path.join(tmp, "espace", "conversation"); mkdirSync(dossier, { recursive: true });
    writeFileSync(path.join(dossier, `${createHash("sha256").update(chat).digest("hex")}.json`), JSON.stringify({ id: chat, valeur: { chat: { id: chat, projectId: "projet-a" }, messages: [] } }));
    await ia.demarrer();
    const config = JSON.parse(ia.configMcp({ agent: "principal", conversation: chat })).mcpServers.klyra;
    const appel = async (method, params = {}, headers = config.headers) => { const r = await fetch(config.url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return r; };
    assert.equal((await appel("tools/list", {}, {})).status, 401);
    const outils = (await (await appel("tools/list")).json()).result.tools.map((o) => o.name);
    assert.ok(outils.includes("cerveau_chercher") && outils.includes("cerveau_lire"));
    const trouve = (await (await appel("tools/call", { name: "cerveau_chercher", arguments: { requete: "durable", projetId: "projet-b", proprietaire: true } })).json()).result;
    const r = JSON.parse(trouve.content[0].text); assert.deepEqual(r.elements.map((p) => p.noteId), [note.id]);
    const lu = (await (await appel("tools/call", { name: "cerveau_lire", arguments: { ids: [r.elements[0].id] } })).json()).result;
    assert.equal(JSON.parse(lu.content[0].text).elements[0].extrait, note.contenu);
    const secret = c.chercher("durable", { proprietaire: true, agentId: null, projetId: null }).elements.find((p) => p.noteId === "secret");
    const refuse = (await (await appel("tools/call", { name: "cerveau_lire", arguments: { ids: [secret.id], projetId: "projet-b" } })).json()).result;
    assert.deepEqual(JSON.parse(refuse.content[0].text).elements, []);
  } finally { ia.fermer(); rmSync(tmp, { recursive: true, force: true }); }
});
test("réimporter un texte modifié ne réutilise pas une citation périmée, même après oubli", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-docs-"));
  try {
    const c = ouvrirCerveau(tmp), p = { proprietaire: true, agentId: null, projetId: null };
    const d = { titre: "exemple.md", contenu: "Première version cacao", reference: "fichier-choisi" };
    assert.equal(importerDocuments(c, [d], null).indexes, 1);
    const avant = c.chercher("cacao", p).elements[0];
    assert.equal(importerDocuments(c, [d], null).inchanges, 1);
    c.oublier(avant.noteId, avant.revision);
    importerDocuments(c, [{ ...d, contenu: "Nouvelle version vanille" }], null);
    assert.deepEqual(c.lire([avant.id], p).elements, []);
    assert.equal(c.chercher("vanille", p).elements.length, 1);
    assert.throws(() => importerDocuments(c, [{ ...d, titre: "binaire.pdf" }], null), /texte/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
