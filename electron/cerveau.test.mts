import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Cerveau, decouperCerveau } from "./cerveau.ts";
import { indexerSouvenirs, PROPRIETAIRE } from "./cerveau-service.ts";
import { executerCerveau, porteeConversation } from "./cerveau-outils.ts";
import type { NoteCerveau } from "./cerveau-types.ts";
const note = (id: string, contenu: string, projetId: string | null = null): NoteCerveau => ({ id, titre: id, contenu, projetId, liens: [], source: null, creeLe: "", modifieLe: "" });
const principal = { agentId: "principal", projetId: "projet-a" };
function base() { return new Cerveau(new DatabaseSync(":memory:")); }

test("SQLite sans FTS5 : persistance sur disque, métadonnées seules dans le graphe et modification versionnée", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-test-")), fichier = path.join(tmp, "base.sqlite");
  let c = new Cerveau(new DatabaseSync(fichier));
  try {
    const n = c.garder(note("une-note", "Un choix durable pour la mémoire.")).note;
    const premier = c.chercher("durable", principal).elements[0];
    assert.ok(premier); assert.equal(c.lister(PROPRIETAIRE).notes[0].contenu, "");
    c.fermer(); c = new Cerveau(new DatabaseSync(fichier));
    assert.equal(c.note(n.id, principal).contenu, n.contenu);
    const corrigee = c.garder({ ...n, contenu: "Le choix a changé : nouvelle version." }).note;
    assert.equal(corrigee.revision, 2); assert.deepEqual(c.lire([premier.id], principal).elements, []);
    assert.throws(() => c.garder({ ...n, contenu: "Écrasement périmé." }), /changé/);
    assert.throws(() => c.oublier(n.id, 1), /changé/);
  } finally { c.fermer(); rmSync(tmp, { recursive: true, force: true }); }
});
test("un agent ne retrouve ni la mémoire d’un autre agent ni un autre projet, même par identifiant exact", () => {
  const c = base();
  try {
    c.garder(note("globale", "astronomie partagée"));
    c.garder(note("projet-a", "astronomie projet A", "projet-a"));
    c.garder(note("projet-b", "astronomie projet B", "projet-b"));
    c.garder(note("hugo", "astronomie privée Hugo"), { origine: "source-hugo", agentId: "hugo" });
    c.garder(note("iris", "astronomie privée Iris"), { origine: "source-iris", agentId: "iris" });
    const scope = { projetId: "projet-a", agentId: "hugo" };
    assert.deepEqual(new Set(c.chercher("astronomie", scope, 16384).elements.map((p) => p.noteId)), new Set(["globale", "projet-a", "hugo"]));
    const interdits = c.chercher("astronomie", PROPRIETAIRE, 16384).elements.filter((p) => ["iris", "projet-b"].includes(p.noteId));
    assert.deepEqual(c.lire(interdits.map((p) => p.id), scope).elements, []);
    assert.throws(() => c.note("iris", scope), /introuvable/);
  } finally { c.fermer(); }
});
test("sorties JSON réellement bornées, Unicode intact, recherche française sans accents et pas d’injection SQL", () => {
  const c = base();
  try {
    const contenu = ("Décision mémoire 🌍 : architecture locale.\n").repeat(100);
    assert.equal(decouperCerveau(contenu).map((p) => p.texte).join(""), contenu);
    assert.ok(decouperCerveau(contenu).every((p) => Buffer.byteLength(p.texte) <= 1800));
    c.garder(note("memoire", contenu));
    for (const budget of [1024, 2048, 4096, 8192, 16384]) {
      const r = c.chercher("memoire", principal, budget), lu = c.lire(r.elements.map((p) => p.id), principal, budget);
      for (const sortie of [r, lu]) { assert.ok(Buffer.byteLength(JSON.stringify(sortie)) <= budget); assert.equal(sortie.octets, Buffer.byteLength(JSON.stringify(sortie))); }
    }
    assert.ok(c.chercher("memoire", principal).elements.length);
    assert.equal(c.chercher("'; DROP TABLE connaissance; --", principal).elements.length, 0);
    assert.equal(c.etat(PROPRIETAIRE).notes, 1);
  } finally { c.fermer(); }
});
test("import des souvenirs existants : index inchangé non reconstruit, original conservé, source disparue écartée", async () => {
  const c = base(), tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-souvenirs-"));
  try {
    writeFileSync(path.join(tmp, "MEMORY.md"), "# Sommaire\n- voir choix.md");
    writeFileSync(path.join(tmp, "choix.md"), "# Décision locale\nUn souvenir de provenance démontrable.");
    const m = { dossier: tmp, portee: "user" as const };
    assert.equal((await indexerSouvenirs(c, "hugo", m, null)).indexes, 1);
    const avant = c.chercher("provenance", { agentId: "hugo", projetId: null }).elements[0];
    assert.equal((await indexerSouvenirs(c, "hugo", m, null)).inchanges, 1);
    assert.equal(c.chercher("provenance", { agentId: "hugo", projetId: null }).elements[0].id, avant.id);
    assert.throws(() => c.garder(c.note(avant.noteId, PROPRIETAIRE)), /source/);
    unlinkSync(path.join(tmp, "choix.md"));
    await indexerSouvenirs(c, "hugo", m, null);
    assert.deepEqual(c.lire([avant.id], { agentId: "hugo", projetId: null }).elements, []);
    assert.equal(c.db.prepare("SELECT count(*) AS n FROM connaissance").get()!.n, 1); // Pas de destruction de la sauvegarde.
  } finally { c.fermer(); rmSync(tmp, { recursive: true, force: true }); }
});
test("liens et index retirés avec la note ; les doublons exacts ne gonflent pas le corpus", () => {
  const c = base();
  try {
    const a = c.garder(note("premiere", "algorithme source")).note;
    assert.equal(c.garder({ ...a, id: "doublon", revision: undefined }).note.id, a.id);
    c.garder({ ...note("seconde", "algorithme relié"), liens: [a.id] });
    c.oublier(a.id, a.revision);
    assert.deepEqual(c.note("seconde", PROPRIETAIRE).liens, []);
    assert.equal(c.chercher("source", principal).elements.length, 0);
    assert.equal(c.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { c.fermer(); }
});
test("le projet d’un appel MCP est résolu depuis la conversation enregistrée, pas depuis les arguments", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-portee-"));
  try {
    writeFileSync(path.join(tmp, "conversations.json"), JSON.stringify({ chats: [{ id: "chat", projectId: "projet-a" }, { id: "distant", projectId: "secret", lieu: "https://autre.test" }] }));
    assert.deepEqual(porteeConversation(tmp, "hugo", "chat"), { agentId: "hugo", projetId: "projet-a" });
    assert.equal(porteeConversation(tmp, "hugo", "distant").projetId, null);
    const r = executerCerveau(tmp, "cerveau_chercher", { requete: "x", proprietaire: true, projetId: "secret" }, "hugo", "chat");
    assert.ok(!("isError" in r)); assert.equal(JSON.parse(r.content[0].text).elements.length, 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
