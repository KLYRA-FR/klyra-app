import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Cerveau } from "./cerveau.ts";
import { connecterDigitalOs, etatDossier, parcourirDossier, scannerDossier, lancerScan, actionDossier } from "./cerveau-dossiers.ts";
const proprietaire = { proprietaire: true, agentId: null, projetId: null };
function fixture() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "digital-os-test-")), root = path.join(tmp, "DIGITAL-OS");
  mkdirSync(root);
  const c = new Cerveau(new DatabaseSync(":memory:"));
  const ecrire = (rel: string, contenu: string | Uint8Array) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, contenu); return f; };
  return { tmp, root, c, ecrire, fermer: () => { c.fermer(); rmSync(tmp, { recursive: true, force: true }); } };
}
test("DIGITAL-OS reste la source : tous les espaces et les archives, texte indexé et pièces repérées", async () => {
  const f = fixture();
  try {
    const texte = "# Astronomie\nUne nébuleuse de démonstration, dans le dossier personnel.";
    const original = f.ecrire("10_PERSONAL/astronomie.md", texte);
    f.ecrire("20_COMPANY/strategies.csv", "sujet,choix\narchitecture,locale");
    f.ecrire("90_ARCHIVES/histoire.md", "# Historique\nUne décision archivée de démonstration.");
    f.ecrire("30_CLIENTS/exemple/piece.pdf", "%PDF Pièce jointe de test non interprétée.");
    const avant = createHash("sha256").update(readFileSync(original)).digest("hex");
    await connecterDigitalOs(f.c, f.root); await scannerDossier(f.c);
    const etat = etatDossier(f.c)!;
    assert.equal(etat.etat, "termine"); assert.equal(etat.fichiers, 4); assert.equal(etat.indexes, 3); assert.equal(etat.reperes, 1);
    assert.equal(createHash("sha256").update(readFileSync(original)).digest("hex"), avant);
    const r = f.c.chercher("nebuleuse", { agentId: "principal", projetId: null });
    assert.equal(r.elements.length, 1); assert.equal(r.elements[0].origine, "DIGITAL-OS/10_PERSONAL/astronomie.md");
    assert.equal(f.c.chercher("nebuleuse", { agentId: "hugo", projetId: null }).elements.length, 0);
    assert.ok(f.c.chercher("archivee", proprietaire).elements[0].origine?.includes("90_ARCHIVES"));
    assert.equal(f.c.chercher("archivee", proprietaire).elements[0].historique, true);
    assert.equal((await parcourirDossier(f.c, "30_CLIENTS/exemple")).entrees[0].etat, "repere-seul");
    const piece = f.c.chercher("piece.pdf", proprietaire).elements[0];
    assert.ok(piece); assert.match(f.c.lire([piece.id], proprietaire).elements[0].extrait, /contenu non extrait/);
  } finally { f.fermer(); }
});
test("ni secrets, ni copies techniques, ni liens hors de la source ne deviennent du contexte", async () => {
  const f = fixture();
  try {
    f.ecrire(".env", "MARQUEUR_CONFIDENTIEL_TEST=non_secret_de_fixture");
    f.ecrire("code.ts", `// Signature factice de test\nconst valeur = "${["ghp", "_"].join("")}${"x".repeat(36)}";`);
    f.ecrire(".git/objet.md", "Un faux doublon technique.");
    f.ecrire(".claude/worktrees/copie/README.md", "Un autre faux doublon technique.");
    const exterieur = path.join(f.tmp, "exterieur.md"); writeFileSync(exterieur, "Un marqueur extérieur aux limites.");
    symlinkSync(exterieur, path.join(f.root, "lien.md"));
    await connecterDigitalOs(f.c, f.root); await scannerDossier(f.c);
    const etat = etatDossier(f.c)!;
    assert.equal(etat.indexes, 0); assert.equal(etat.proteges, 2); assert.ok(etat.techniques >= 2);
    assert.equal(f.c.chercher("MARQUEUR_CONFIDENTIEL_TEST", proprietaire).elements.length, 0);
    assert.equal(f.c.chercher("exterieur", proprietaire).elements.length, 0);
    await assert.rejects(parcourirDossier(f.c, "../"), /accessible/);
    await assert.rejects(parcourirDossier(f.c, ".git"), /accessible/);
    assert.equal((await parcourirDossier(f.c)).entrees.find((e) => e.nom === "lien.md")?.etat, "lien-non-suivi");
  } finally { f.fermer(); }
});
test("actualisation incrémentale, vérification forcée et disparition d’un fichier sans réécrire l’original", async () => {
  const f = fixture();
  try {
    const fichier = f.ecrire("40_KNOWLEDGE/repere.md", "# Repère\nLa connaissance initiale.");
    await connecterDigitalOs(f.c, f.root); await scannerDossier(f.c);
    const avant = f.c.chercher("initiale", proprietaire).elements[0];
    await scannerDossier(f.c); assert.equal(etatDossier(f.c)!.inchanges, 1);
    assert.equal(f.c.chercher("initiale", proprietaire).elements[0].id, avant.id);
    writeFileSync(fichier, "# Repère\nUne connaissance actualisée.");
    await scannerDossier(f.c, { forcer: true });
    assert.equal(f.c.chercher("actualisee", proprietaire).elements.length, 1); assert.equal(f.c.lire([avant.id], proprietaire).elements.length, 0);
    unlinkSync(fichier); await scannerDossier(f.c);
    assert.equal(f.c.chercher("actualisee", proprietaire).elements.length, 0);
    assert.equal(f.c.db.prepare("SELECT etat FROM dossier_fichier WHERE relatif=?").get("40_KNOWLEDGE/repere.md")!.etat, "disparu");
  } finally { f.fermer(); }
});
test("scan interrompu : les connaissances précédentes restent disponibles et le contrôle d’arrêt fonctionne", async () => {
  const f = fixture();
  try {
    f.ecrire("note.md", "Une connaissance de référence."); await connecterDigitalOs(f.c, f.root); await scannerDossier(f.c);
    await scannerDossier(f.c, { arrete: () => true });
    assert.equal(etatDossier(f.c)!.etat, "interrompu"); assert.equal(f.c.chercher("reference", proprietaire).elements.length, 1);
    lancerScan(f.c, false); actionDossier(f.c, "digital-os-arreter", {});
    for (let i = 0; i < 50 && etatDossier(f.c)!.etat === "indexation"; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(etatDossier(f.c)!.etat, "interrompu");
  } finally { f.fermer(); }
});
test("l’arborescence est paginée même avant l’indexation et les fichiers volumineux restent repérables", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 125; i++) f.ecrire(`documents/${String(i).padStart(3, "0")}.pdf`, "Pièce de test.");
    f.ecrire("volumineux.txt", new Uint8Array(2_000_001));
    await connecterDigitalOs(f.c, f.root);
    const page = await parcourirDossier(f.c, "documents"); assert.equal(page.entrees.length, 100); assert.equal(page.suite, 100);
    assert.equal((await parcourirDossier(f.c, "documents", 100)).entrees.length, 25);
    await scannerDossier(f.c);
    assert.equal((await parcourirDossier(f.c)).entrees.find((e) => e.nom === "volumineux.txt")?.etat, "volume-non-indexe");
    assert.equal(etatDossier(f.c)!.reperes, 126);
  } finally { f.fermer(); }
});
