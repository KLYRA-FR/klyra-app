import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Cerveau, sauvegarderCerveau } from "./cerveau.ts";
import { ingererDecisions, ingererDossierAgent } from "./cerveau-ingest.ts";
import { PROPRIETAIRE } from "./cerveau-service.ts";
import type { NoteCerveau } from "./cerveau-types.ts";

const note = (id: string, titre: string, contenu: string, projetId: string | null = null): NoteCerveau => ({ id, titre, contenu, projetId, liens: [], source: null, creeLe: "", modifieLe: "" });
const hugo = { agentId: "hugo", projetId: "projet-a" };

test("les liens naissent du sens : même client, lien wiki, et pas entre sujets sans rapport", () => {
  const c = new Cerveau(new DatabaseSync(":memory:"));
  try {
    const brief = c.garder(note("brief", "Brief Atelier Nord", "Client : Atelier Nord\nDécision : on lance la refonte du site en mars.")).note;
    const reunion = c.garder(note("reunion", "Point commercial", "Le compte Atelier Nord confirme la refonte. Marie Dupont était là.")).note;
    const page = c.garder(note("page", "Refonte site", "Le périmètre de la refonte, à relire avant le devis.")).note;
    const renvoi = c.garder(note("renvoi", "À suivre", "Reprendre [[Refonte site]] avant d’écrire au client.")).note;
    const recette = c.garder(note("recette", "Tarte", "Recette de tarte aux pommes et à la cannelle, sans rapport avec un client.")).note;
    assert.ok(reunion.liens.includes(brief.id), "le même client relie les deux notes");
    assert.match(reunion.liensAuto?.includes(brief.id) ? c.db.prepare("SELECT pourquoi FROM lien_auto WHERE a IN (?, ?) AND b IN (?, ?)").get(brief.id, reunion.id, brief.id, reunion.id)?.pourquoi as string : "", /client/i);
    assert.ok(renvoi.liens.includes(page.id), "un [[lien]] retrouve la note par son titre");
    assert.equal(recette.liens.includes(brief.id), false);
    assert.equal(recette.liens.includes(reunion.id), false);
    const trouve = c.chercher("que prévoit-on pour le compte Atelier Nord", hugo, 8192);
    assert.ok(trouve.elements.some((p) => p.noteId === brief.id), "la recherche par le sens retrouve le client même avec d’autres mots");
    assert.ok(trouve.elements[0]?.extrait);
    const sans = c.garder({ ...reunion, liens: reunion.liens.filter((id) => id !== brief.id) }).note;
    assert.equal(sans.liens.includes(brief.id), false, "décocher un lien automatique l’empêche de revenir");
    assert.equal(c.garder({ ...sans, contenu: sans.contenu }).note.liens.includes(brief.id), false);
    const pendant = c.garder(note("pendant", "Suite Atelier Nord", "Client : Atelier Nord\nNote arrivée pendant que l’autre était ouverte.")).note;
    const figee = c.garder({ ...sans, liens: sans.liens, liensAuto: sans.liensAuto ?? [] }).note;
    assert.equal(figee.liens.includes(brief.id), false);
    assert.ok(figee.liens.includes(pendant.id) || pendant.liens.includes(figee.id), "un lien apparu hors de l’éditeur n’est pas refusé");
  } finally { c.fermer(); }
});

test("une base déjà remplie n’est pas vidée, et la sauvegarde n’y touche pas", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-migration-"));
  const fichier = path.join(tmp, "connaissances.sqlite");
  const brut = new DatabaseSync(fichier);
  brut.exec(`CREATE TABLE connaissance(id TEXT PRIMARY KEY, titre TEXT NOT NULL, contenu TEXT NOT NULL,
    projet_id TEXT, agent_id TEXT, source TEXT, origine TEXT UNIQUE, hash TEXT NOT NULL,
    revision INTEGER NOT NULL, cree_le TEXT NOT NULL, modifie_le TEXT NOT NULL, octets INTEGER NOT NULL, obsolete INTEGER NOT NULL DEFAULT 0);
    PRAGMA user_version=1;`);
  brut.prepare("INSERT INTO connaissance VALUES('garde','Déjà là','Un souvenir posé avant cette version.',null,null,null,null,'h',1,'2026-01-01','2026-01-01',10,0)").run();
  brut.close();
  const c = new Cerveau(new DatabaseSync(fichier));
  try {
    assert.equal(Number(c.db.prepare("PRAGMA user_version").get()?.user_version), 2);
    assert.equal(c.note("garde", PROPRIETAIRE).contenu, "Un souvenir posé avant cette version.");
    const copie = path.join(tmp, "copie.sqlite");
    assert.equal(sauvegarderCerveau(c, copie), copie);
    assert.equal(c.note("garde", PROPRIETAIRE).contenu, "Un souvenir posé avant cette version.");
    const relu = new DatabaseSync(copie);
    assert.equal(relu.prepare("SELECT contenu FROM connaissance WHERE id='garde'").get()?.contenu, "Un souvenir posé avant cette version.");
    relu.close();
    assert.throws(() => sauvegarderCerveau(c, copie), /déjà/);
  } finally { c.fermer(); rmSync(tmp, { recursive: true, force: true }); }
});

test("les décisions et les fichiers d’agent entrent seuls, sans modifier l’original ni un secret", async () => {
  const c = new Cerveau(new DatabaseSync(":memory:"));
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-ingest-"));
  try {
    const original = path.join(tmp, "iris", "brief.md");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.join(tmp, "iris"), { recursive: true });
    const texte = "Client : Atelier Nord\nDécision : garder le devis de mars dans le dossier du client.";
    writeFileSync(original, texte);
    writeFileSync(path.join(tmp, "iris", "secret.md"), "clé sk-proj-abcdefghijklmnopqrstuvwxyz0123456789");
    const avant = readFileSync(original);
    const rang = await ingererDossierAgent(c, path.join(tmp, "iris"), "iris", "rendu:iris", "projet-a");
    assert.equal(rang.indexes, 1);
    assert.deepEqual(readFileSync(original), avant);
    assert.equal(c.chercher("devis", { agentId: "iris", projetId: "projet-a" }).elements.length, 1);
    assert.equal(c.chercher("devis", { agentId: "hugo", projetId: "projet-a" }).elements.length, 0, "le fichier d’Iris ne s’ouvre pas à Hugo");
    assert.equal(c.chercher("sk-proj", PROPRIETAIRE).elements.length, 0);
    const decision = "Décision : on retient Atelier Nord pour la refonte, avec un point de suivi dans deux semaines et le devis signé.";
    const r = ingererDecisions(c, [{ id: "chat-1", title: "Atelier", projectId: "projet-a" }], [
      { id: "m-1", chatId: "chat-1", statut: "fait", author: { kind: "role", roleId: "iris" }, parts: [{ type: "text", text: decision }] },
      { id: "m-2", chatId: "chat-1", statut: "fait", author: { kind: "user" }, parts: [{ type: "text", text: "ok" }] },
    ]);
    assert.equal(r.indexes, 1);
    assert.ok(c.chercher("refonte", hugo).elements.some((p) => p.origine === "conversation"));
    assert.equal(ingererDecisions(c, [{ id: "chat-1", title: "Atelier", projectId: "projet-a" }], [
      { id: "m-1", chatId: "chat-1", statut: "fait", author: { kind: "role", roleId: "iris" }, parts: [{ type: "text", text: decision }] },
    ]).indexes, 0, "le même passage n’est pas recopié");
  } finally { c.fermer(); rmSync(tmp, { recursive: true, force: true }); }
});
