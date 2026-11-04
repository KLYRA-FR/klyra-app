import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listerSkills, migrerCopies, preparerClaude, preparerSessionClaude } from "./preparation-fournisseur.ts";

function posteVide() {
  const racine = mkdtempSync(path.join(tmpdir(), "klyra-prep-"));
  const poste = path.join(racine, "home", ".claude");
  const userData = path.join(racine, "userdata");
  mkdirSync(path.join(poste, "agents"), { recursive: true });
  mkdirSync(path.join(poste, "skills", "rangement"), { recursive: true });
  mkdirSync(path.join(poste, "skills", "maquette"), { recursive: true });
  mkdirSync(path.join(poste, "projects"), { recursive: true });
  writeFileSync(path.join(poste, "skills", "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range.\n---\n\nRange.\n");
  writeFileSync(path.join(poste, "skills", "maquette", "SKILL.md"), "---\nname: maquette\ndescription: Dessine.\n---\n\nDessine.\n");
  writeFileSync(path.join(poste, "agents", "iris.md"), "---\nname: iris\n---\n\nIris.\n");
  writeFileSync(path.join(poste, "agents", "hugo.md"), "---\nname: hugo\n---\n\nHugo.\n");
  writeFileSync(path.join(poste, "CLAUDE.md"), "CLAUDE-PERSO\n");
  writeFileSync(path.join(poste, ".credentials.json"), "{\"jeton\":\"secret\"}\n");
  writeFileSync(path.join(poste, "projects", "session.jsonl"), "{}\n");
  return { racine, poste, userData, home: path.join(racine, "home") };
}

test("le dossier préparé ne garde que les fiches actives et les skills allumées", () => {
  const { racine, poste } = posteVide();
  try {
    const dest = path.join(racine, "config");
    preparerClaude(dest, {
      fiches: [{ id: "iris", contenu: readFileSync(path.join(poste, "agents", "iris.md"), "utf8") }],
      skills: listerSkills(path.join(poste, "skills")).filter((s) => s.nom === "rangement"),
      claudeMd: path.join(poste, "CLAUDE.md"),
      identifiants: path.join(poste, ".credentials.json"),
      projects: path.join(poste, "projects"),
      sessions: null,
    });
    assert.equal(readFileSync(path.join(dest, "agents", "iris.md"), "utf8").includes("Iris."), true);
    assert.throws(() => readFileSync(path.join(dest, "agents", "hugo.md"), "utf8"));
    assert.equal(readFileSync(path.join(dest, "skills", "rangement", "SKILL.md"), "utf8").includes("Range."), true);
    assert.throws(() => readFileSync(path.join(dest, "skills", "maquette", "SKILL.md")));
    assert.equal(lstatSync(path.join(dest, "CLAUDE.md")).isSymbolicLink(), true);
    assert.equal(readFileSync(path.join(dest, "CLAUDE.md"), "utf8"), "CLAUDE-PERSO\n");
    assert.equal(readFileSync(path.join(poste, "CLAUDE.md"), "utf8"), "CLAUDE-PERSO\n");
    assert.equal(lstatSync(path.join(dest, ".credentials.json")).isSymbolicLink(), true);
    assert.equal(path.resolve(dest, readlinkSync(path.join(dest, ".credentials.json"))), path.resolve(poste, ".credentials.json"));
    assert.equal(readFileSync(path.join(dest, "projects", "session.jsonl"), "utf8"), "{}\n");
    assert.equal(readFileSync(path.join(poste, "agents", "hugo.md"), "utf8").includes("Hugo."), true);
    assert.equal(readFileSync(path.join(poste, "skills", "maquette", "SKILL.md"), "utf8").includes("Dessine."), true);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("une session prépare le dossier de l'agent et laisse le poste intact", () => {
  const { racine, home, poste, userData } = posteVide();
  try {
    const avant = readFileSync(path.join(poste, "CLAUDE.md"), "utf8");
    const session = preparerSessionClaude({
      userData,
      home,
      agent: "iris",
      dossierAgents: path.join(poste, "agents"),
      idsActifs: ["iris"],
      garder: (nom) => nom === "rangement",
    });
    assert.ok(session);
    assert.equal(session.dossier, path.join(userData, "preparation", "iris"));
    assert.deepEqual(session.skills, ["rangement"]);
    assert.equal(readFileSync(path.join(session.dossier, "agents", "iris.md"), "utf8").includes("Iris."), true);
    assert.throws(() => readFileSync(path.join(session.dossier, "agents", "hugo.md")));
    assert.equal(lstatSync(path.join(session.dossier, "CLAUDE.md")).isSymbolicLink(), true);
    assert.equal(readFileSync(path.join(session.dossier, "CLAUDE.md"), "utf8"), avant);
    assert.equal(readFileSync(path.join(poste, "CLAUDE.md"), "utf8"), avant);
    assert.equal(preparerSessionClaude({ userData: null, home, agent: null, dossierAgents: poste, idsActifs: [], garder: () => true }), null);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("la reprise copie sans écraser et sans toucher au poste", () => {
  const { racine, poste } = posteVide();
  try {
    const fichesDest = path.join(racine, "equipe");
    const skillsDest = path.join(racine, "bibliotheque");
    mkdirSync(fichesDest, { recursive: true });
    writeFileSync(path.join(fichesDest, "iris.md"), "DEJA\n");
    const une = migrerCopies({ fichesPoste: path.join(poste, "agents"), skillsPoste: path.join(poste, "skills"), fichesDest, skillsDest });
    assert.deepEqual(une.fiches, ["hugo"]);
    assert.deepEqual(une.skills, ["maquette", "rangement"]);
    assert.equal(readFileSync(path.join(fichesDest, "iris.md"), "utf8"), "DEJA\n");
    assert.equal(readFileSync(path.join(poste, "agents", "hugo.md"), "utf8").includes("Hugo."), true);
    const deux = migrerCopies({ fichesPoste: path.join(poste, "agents"), skillsPoste: path.join(poste, "skills"), fichesDest, skillsDest });
    assert.deepEqual(deux, { fiches: [], skills: [] });
    symlinkSync(path.join(poste, "agents", "hugo.md"), path.join(poste, "skills", "lien"));
    assert.equal(listerSkills(path.join(poste, "skills")).some((s) => s.nom === "lien"), false);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});
