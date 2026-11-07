import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { StockagePriseEnMain } from "./prise-en-main.ts";
import { appliquerChoixPriseEnMain, debutPriseEnMain, validerPriseEnMain } from "./prise-en-main-modele.ts";

test("un profil neuf commence au nommage, un profil existant garde son parcours", () => {
  assert.equal(debutPriseEnMain(true).etape, "assistant");
  assert.equal(debutPriseEnMain(false).etape, "termine");
});
test("une exploration n'annonce jamais une prise en main terminée", () => {
  const etat = appliquerChoixPriseEnMain(debutPriseEnMain(true), { mode: "exploration" });
  assert.equal(etat.etape, "assistant");
  assert.throws(() => appliquerChoixPriseEnMain(etat, { etape: "termine" }), /réponse/);
});
test("les prérequis, les identifiants et les bornes sont validés", () => {
  assert.throws(() => appliquerChoixPriseEnMain(debutPriseEnMain(true), { etape: "demande" }), /IA/);
  assert.throws(() => appliquerChoixPriseEnMain(debutPriseEnMain(true), { fournisseur: "inconnu" }), /Fournisseur/);
  assert.throws(() => appliquerChoixPriseEnMain(debutPriseEnMain(true), { brouillon: "x".repeat(20001) }), /20 000/);
  assert.throws(() => appliquerChoixPriseEnMain(debutPriseEnMain(true), { cleApi: "interdit" }), /inconnu/);
  assert.throws(() => validerPriseEnMain({ ...debutPriseEnMain(true), conversation: { id: "autre", debut: new Date().toISOString() } }), /Conversation/);
});
test("une conversation commencée peut se terminer, le choix d'IA est conservé", () => {
  const etat = appliquerChoixPriseEnMain(debutPriseEnMain(true), { etape: "conversation", fournisseur: "codex", conversation: { id: "dm-principal", debut: new Date().toISOString() } });
  const fini = appliquerChoixPriseEnMain(etat, { etape: "termine" });
  assert.equal(fini.fournisseur, "codex");
  assert.equal(fini.etape, "termine");
});
test("le nom enregistré après le début ne fait pas perdre la progression au redémarrage", async () => {
  const dossier = await mkdtemp(path.join(os.tmpdir(), "klyra-prise-reprise-"));
  const fichier = path.join(dossier, "prise-en-main.json");
  const premier = new StockagePriseEnMain(fichier, () => true);
  await premier.lire();
  await premier.ecrire({ etape: "ia", fournisseur: "claude" });
  const relance = new StockagePriseEnMain(fichier, () => false);
  assert.equal((await relance.lire()).etape, "ia");
});
test("les écritures concurrentes gardent tous les choix, et la lecture ne les expose pas par référence", async () => {
  const dossier = await mkdtemp(path.join(os.tmpdir(), "klyra-prise-serie-"));
  const stockage = new StockagePriseEnMain(path.join(dossier, "prise-en-main.json"), () => true);
  await Promise.all([stockage.ecrire({ fournisseur: "codex" }), stockage.ecrire({ brouillon: "Ma demande" }), stockage.ecrire({ etape: "ia" })]);
  const lu = await stockage.lire();
  assert.equal(lu.fournisseur, "codex"); assert.equal(lu.brouillon, "Ma demande");
  lu.brouillon = "modifié ailleurs";
  assert.equal((await stockage.lire()).brouillon, "Ma demande");
});
test("un fichier illisible reste intact et une erreur d'écriture ne termine pas le parcours", async () => {
  const dossier = await mkdtemp(path.join(os.tmpdir(), "klyra-prise-erreur-"));
  const fichier = path.join(dossier, "prise-en-main.json");
  await writeFile(fichier, "fichier interrompu");
  const stockage = new StockagePriseEnMain(fichier, () => true);
  await assert.rejects(stockage.lire(), /conservées/);
  assert.equal(await readFile(fichier, "utf8"), "fichier interrompu");
});
