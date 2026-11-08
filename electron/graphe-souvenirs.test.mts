import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { agentDuProjetClaude, lireEnTete, lireSouvenirsGraphe } from "./graphe-souvenirs.ts";

function ecrire(fichier: string, texte: string) {
  mkdirSync(path.dirname(fichier), { recursive: true });
  writeFileSync(fichier, texte);
}
const souvenir = (nom: string, type: string, corps = "", extra = "") =>
  `---\nname: ${nom}\ndescription: Résumé de ${nom}\nmetadata:\n  type: ${type}\n${extra}---\n\n${corps}\n`;

test("lit la mémoire de chaque agent là où Claude Code l'écrit, avec le bon auteur, sans rien modifier", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "graphe-"));
  try {
    const donnees = path.join(home, "donnees"), config = path.join(home, ".claude");
    const fichiers = {
      cicco: path.join(config, "projects", "-home-x-atelier-principal", "memory", "github.md"),
      index: path.join(config, "projects", "-home-x-atelier-principal", "memory", "MEMORY.md"),
      iris: path.join(home, "atelier", "designer", ".claude", "agent-memory", "designer", "feedback-visuel.md"),
      hugo: path.join(home, "atelier", "principal", ".claude", "agent-memory", "dev", "outillage.md"),
      camille: path.join(donnees, "preparation", "camille", "projects", "-x", "memory", "qonto.md"),
      user: path.join(config, "agent-memory", "dev", "prefs.md"),
      projet: path.join(home, "projets", "site", ".claude", "agent-memory", "designer", "charte.md"),
    };
    ecrire(fichiers.cicco, souvenir("github-klyra-app", "reference", "Voir [[Outillage]] et [[inconnu|libellé]]."));
    ecrire(fichiers.index, "- [GitHub](github.md)\n");
    ecrire(fichiers.iris, souvenir("feedback-visuel", "feedback", "", "  prive: oui\n"));
    ecrire(fichiers.hugo, souvenir("outillage", "project", "", "  remplace: [ancien-outillage]\n"));
    ecrire(fichiers.camille, souvenir("qonto", "reference"));
    ecrire(fichiers.user, souvenir("prefs", "user"));
    ecrire(fichiers.projet, souvenir("charte", "project"));
    // Un lien qui sort du dossier n'est pas suivi.
    ecrire(path.join(home, "dehors.md"), souvenir("dehors", "user"));
    symlinkSync(path.join(home, "dehors.md"), path.join(path.dirname(fichiers.user), "lien.md"));
    const avant = Object.values(fichiers).map((f) => readFileSync(f, "utf8"));

    const r = lireSouvenirsGraphe({ donnees, configClaude: config, home, projets: [{ id: "p-site", dossier: path.join(home, "projets", "site") }, { id: "p-dehors", dossier: "/etc" }] });
    const parNom = new Map(r.souvenirs.map((s) => [s.nom, s]));
    assert.equal(r.souvenirs.length, 6);
    assert.equal(parNom.get("github-klyra-app")?.agent, "principal");
    assert.deepEqual(parNom.get("github-klyra-app")?.liens, ["Outillage", "inconnu"]);
    assert.equal(parNom.get("feedback-visuel")?.agent, "designer");
    assert.equal(parNom.get("feedback-visuel")?.prive, true);
    assert.equal(parNom.get("feedback-visuel")?.type, "feedback");
    assert.equal(parNom.get("outillage")?.agent, "dev");
    assert.deepEqual(parNom.get("outillage")?.remplace, ["ancien-outillage"]);
    assert.equal(parNom.get("qonto")?.agent, "camille");
    assert.equal(parNom.get("prefs")?.agent, "dev");
    assert.equal(parNom.get("charte")?.projetId, "p-site");
    assert.equal(parNom.has("dehors"), false);
    assert.ok(r.dossiers.every((d) => d.nombre > 0));
    assert.deepEqual(Object.values(fichiers).map((f) => readFileSync(f, "utf8")), avant);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("en-tête et auteur d'une mémoire automatique", () => {
  assert.equal(agentDuProjetClaude("-var-lib-klyra-atelier-designer"), "designer");
  assert.equal(agentDuProjetClaude("-home-corentin-KLYRA-site"), "principal");
  const { champs, corps } = lireEnTete("---\nname: \"x\"\nmetadata:\n  type: user\n  remplace:\n    - a\n    - b\n---\ncorps");
  assert.equal(champs.name, "x");
  assert.equal(champs["metadata.type"], "user");
  assert.deepEqual(champs["metadata.remplace"], ["a", "b"]);
  assert.equal(corps, "corps");
});
