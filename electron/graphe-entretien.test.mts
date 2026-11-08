import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { accepterLien, annuler, archiver, avecLien, avecRemplace, fusionner, refuserLien, resumeEntretien } from "./graphe-entretien.ts";
import { lireSouvenirsGraphe } from "./graphe-souvenirs.ts";

const souvenir = (nom: string, corps: string) => `---\nname: ${nom}\ndescription: ${nom}\nmetadata:\n  type: project\n---\n\n${corps}\n`;

function banc() {
  const home = mkdtempSync(path.join(os.tmpdir(), "graphe-entretien-"));
  const dossier = path.join(home, ".claude", "agent-memory", "dev");
  mkdirSync(dossier, { recursive: true });
  writeFileSync(path.join(dossier, "a.md"), souvenir("outillage", "Lancer les tests."));
  writeFileSync(path.join(dossier, "b.md"), souvenir("outillage-bis", "Lancer aussi le build."));
  writeFileSync(path.join(dossier, "MEMORY.md"), "- [Outillage](a.md) — tests\n- [Bis](b.md) — build\n");
  const r = { donnees: path.join(home, "donnees"), configClaude: path.join(home, ".claude"), home };
  const parNom = () => new Map(lireSouvenirsGraphe(r).souvenirs.map((s) => [s.nom, s]));
  return { home, dossier, r, parNom, fin: () => rmSync(home, { recursive: true, force: true }) };
}

test("accepter un lien l'écrit dans le souvenir, annuler le retire", () => {
  const b = banc();
  try {
    const s = b.parNom();
    accepterLien(b.r, b.r.donnees, { de: s.get("outillage")!.id, attenduDe: s.get("outillage")!.date, vers: s.get("outillage-bis")!.id });
    assert.match(readFileSync(path.join(b.dossier, "a.md"), "utf8"), /Voir aussi : \[\[outillage-bis\]\]\n$/);
    assert.deepEqual(b.parNom().get("outillage")!.liens, ["outillage-bis"]);
    const op = resumeEntretien(b.r.donnees).operations[0];
    annuler(b.r.donnees, op.id);
    assert.equal(readFileSync(path.join(b.dossier, "a.md"), "utf8"), souvenir("outillage", "Lancer les tests."));
    assert.throws(() => annuler(b.r.donnees, op.id), /déjà annulée/);
  } finally { b.fin(); }
});

test("archiver déplace le fichier et sa ligne d'index, rien n'est supprimé, annulable", () => {
  const b = banc();
  try {
    const s = b.parNom().get("outillage-bis")!;
    archiver(b.r, b.r.donnees, { id: s.id, attendu: s.date });
    assert.ok(!existsSync(path.join(b.dossier, "b.md")));
    assert.ok(existsSync(path.join(b.dossier, "archive", "b.md")));
    assert.equal(readFileSync(path.join(b.dossier, "MEMORY.md"), "utf8"), "- [Outillage](a.md) — tests\n");
    assert.equal(b.parNom().has("outillage-bis"), false);
    annuler(b.r.donnees, resumeEntretien(b.r.donnees).operations[0].id);
    assert.ok(existsSync(path.join(b.dossier, "b.md")));
    assert.match(readFileSync(path.join(b.dossier, "MEMORY.md"), "utf8"), /\(b\.md\)/);
  } finally { b.fin(); }
});

test("fusionner garde l'un, y reprend l'autre, archive l'autre ; refuse un souvenir changé", () => {
  const b = banc();
  try {
    const s = b.parNom(), a = s.get("outillage")!, bis = s.get("outillage-bis")!;
    // Changé depuis l'affichage : refusé, rien n'est touché.
    utimesSync(a.chemin, new Date(), new Date(Date.now() + 5000));
    assert.throws(() => fusionner(b.r, b.r.donnees, { garder: a.id, attenduGarder: a.date, retirer: bis.id, attenduRetirer: bis.date }), /a changé/);
    assert.ok(existsSync(bis.chemin));
    const frais = b.parNom().get("outillage")!;
    fusionner(b.r, b.r.donnees, { garder: frais.id, attenduGarder: frais.date, retirer: bis.id, attenduRetirer: bis.date });
    const texte = readFileSync(a.chemin, "utf8");
    assert.match(texte, /remplace: outillage-bis/);
    assert.match(texte, /## Repris de « outillage-bis »\n\nLancer aussi le build\./);
    assert.deepEqual(b.parNom().get("outillage")!.remplace, ["outillage-bis"]);
    assert.ok(existsSync(path.join(b.dossier, "archive", "b.md")));
    // Un fichier modifié après l'action n'est pas écrasé par l'annulation.
    writeFileSync(a.chemin, texte + "\nAjout de Hugo.\n");
    assert.throws(() => annuler(b.r.donnees, resumeEntretien(b.r.donnees).operations[0].id), /a changé depuis/);
    assert.match(readFileSync(a.chemin, "utf8"), /Ajout de Hugo/);
  } finally { b.fin(); }
});

test("refus de lien gardé, aides de texte", () => {
  const b = banc();
  try {
    refuserLien(b.r.donnees, "a|b");
    refuserLien(b.r.donnees, "a|b");
    assert.deepEqual(resumeEntretien(b.r.donnees).refuses, ["a|b"]);
    assert.throws(() => refuserLien(b.r.donnees, 3), /invalide/);
  } finally { b.fin(); }
  assert.equal(avecLien("x\n\nVoir aussi : [[a]]\n", "b"), "x\n\nVoir aussi : [[a]], [[b]]\n");
  assert.equal(avecLien("x [[b]]", "b"), "x [[b]]");
  assert.equal(avecRemplace("---\nname: x\n---\ncorps", "y"), "---\nname: x\nmetadata:\n  remplace: y\n---\ncorps");
  assert.equal(avecRemplace("sans en-tête", "y"), "sans en-tête");
});
