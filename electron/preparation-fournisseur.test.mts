import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { nomsSkills } from "./connaissances-agent.ts";
import { diagnostiquerPoste } from "./diagnostic-poste.ts";
import { importerSkills, listerSkills, migrerCopies, preparerClaude, preparerSessionClaude } from "./preparation-fournisseur.ts";

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
    assert.equal(existsSync(path.join(dest, "plugins")), false);
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
    mkdirSync(path.join(poste, "plugins"), { recursive: true });
    writeFileSync(path.join(poste, "plugins", "installed_plugins.json"), "{\"plugins\":{}}\n");
    writeFileSync(path.join(poste, "settings.json"), "{\"enabledPlugins\":{\"vercel@claude-plugins-official\":true}}\n");
    writeFileSync(path.join(poste, "settings.local.json"), "{\"enabledPlugins\":{\"aircloud-tools@local\":true}}\n");
    const deja = path.join(userData, "preparation", "iris");
    mkdirSync(path.join(deja, "plugins", "cache"), { recursive: true });
    writeFileSync(path.join(deja, "plugins", "cache", "local.txt"), "pas-le-poste\n");
    writeFileSync(path.join(deja, "settings.json"), "{\"enabledPlugins\":{}}\n");
    const avecPlugins = preparerSessionClaude({
      userData,
      home,
      agent: "iris",
      dossierAgents: path.join(poste, "agents"),
      idsActifs: ["iris"],
      garder: () => false,
      poste,
    });
    assert.ok(avecPlugins);
    for (const nom of ["plugins", "settings.json", "settings.local.json"]) {
      assert.equal(lstatSync(path.join(avecPlugins.dossier, nom)).isSymbolicLink(), true);
    }
    assert.equal(readFileSync(path.join(avecPlugins.dossier, "settings.json"), "utf8").includes("vercel@claude-plugins-official"), true);
    assert.equal(readFileSync(path.join(poste, "settings.json"), "utf8").includes("vercel@claude-plugins-official"), true);
    assert.equal(readFileSync(path.join(poste, "plugins", "installed_plugins.json"), "utf8"), "{\"plugins\":{}}\n");
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("la session lit la bibliothèque de l'app, pas une skill ajoutée ensuite sur le poste", () => {
  const { racine, home, poste, userData } = posteVide();
  const avant = readFileSync(path.join(poste, "skills", "rangement", "SKILL.md"), "utf8");
  const avantEnv = process.env.KLYRA_USER_DATA;
  try {
    const skillsDest = path.join(userData, "bibliotheque-skills");
    const equipe = path.join(userData, "equipe");
    migrerCopies({
      fichesPoste: path.join(poste, "agents"),
      skillsPoste: path.join(poste, "skills"),
      fichesDest: equipe,
      skillsDest,
    });
    writeFileSync(path.join(skillsDest, "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range.\n---\n\nBIBLIOTHEQUE\n");
    mkdirSync(path.join(skillsDest, "klyra-seule"), { recursive: true });
    writeFileSync(path.join(skillsDest, "klyra-seule", "SKILL.md"), "---\nname: klyra-seule\ndescription: Ici.\n---\n\nAPP\n");
    mkdirSync(path.join(poste, "skills", "nouvelle"), { recursive: true });
    writeFileSync(path.join(poste, "skills", "nouvelle", "SKILL.md"), "---\nname: nouvelle\ndescription: Tard.\n---\n\nPOSTE\n");
    writeFileSync(path.join(equipe, "iris.md"), `---\nname: iris\ndescription: ${"A".repeat(400)}\n---\n\nIris.\n`);
    writeFileSync(path.join(poste, "agents", "iris.md"), "---\nname: iris\ndescription: Court.\n---\n\nIris.\n");
    const session = preparerSessionClaude({
      userData,
      home,
      agent: "iris",
      dossierAgents: equipe,
      idsActifs: ["iris"],
      garder: () => true,
    });
    assert.ok(session);
    assert.deepEqual(session.skills, ["klyra-seule", "maquette", "rangement"]);
    assert.equal(readFileSync(path.join(session.dossier, "skills", "rangement", "SKILL.md"), "utf8").includes("BIBLIOTHEQUE"), true);
    assert.throws(() => readFileSync(path.join(session.dossier, "skills", "nouvelle", "SKILL.md")));
    assert.equal(readFileSync(path.join(poste, "skills", "rangement", "SKILL.md"), "utf8"), avant);
    assert.equal(readFileSync(path.join(poste, "skills", "nouvelle", "SKILL.md"), "utf8").includes("POSTE"), true);
    assert.equal(readFileSync(path.join(poste, "agents", "iris.md"), "utf8").includes("Court."), true);
    process.env.KLYRA_USER_DATA = userData;
    assert.deepEqual(nomsSkills(poste, null).poste, ["klyra-seule", "maquette", "rangement"]);
    const diagnostic = diagnostiquerPoste(home, ["iris"]);
    const ligneSkills = diagnostic.elements.find((e) => e.cle === "skills");
    const ligneAgents = diagnostic.elements.find((e) => e.cle === "agents");
    assert.ok(ligneSkills);
    assert.match(ligneSkills.detail, /klyra-seule/);
    assert.doesNotMatch(ligneSkills.detail, /nouvelle/);
    assert.equal(ligneSkills.chemin, skillsDest);
    assert.ok(ligneAgents?.conseil);
    assert.equal(ligneAgents?.chemin, equipe);
  } finally {
    if (avantEnv === undefined) delete process.env.KLYRA_USER_DATA;
    else process.env.KLYRA_USER_DATA = avantEnv;
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
    const vide = path.join(racine, "sans-skill");
    const destVide = path.join(racine, "dest-vide");
    mkdirSync(vide);
    migrerCopies({ fichesPoste: vide, skillsPoste: vide, fichesDest: path.join(racine, "fiches-vides"), skillsDest: destVide });
    assert.equal(existsSync(destVide), true);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("un dossier choisi est copié dans la bibliothèque sans écraser et sans toucher la source", () => {
  const racine = mkdtempSync(path.join(tmpdir(), "klyra-import-"));
  try {
    const source = path.join(racine, "apport");
    const dest = path.join(racine, "bibliotheque-skills");
    mkdirSync(path.join(source, "facture"), { recursive: true });
    mkdirSync(path.join(source, "vide"), { recursive: true });
    mkdirSync(path.join(dest, "facture"), { recursive: true });
    writeFileSync(path.join(source, "facture", "SKILL.md"), "---\nname: facture\n---\n\nSOURCE\n");
    writeFileSync(path.join(source, "note.txt"), "pas une skill\n");
    writeFileSync(path.join(dest, "facture", "SKILL.md"), "---\nname: facture\n---\n\nDEJA\n");
    mkdirSync(path.join(source, "relance"), { recursive: true });
    writeFileSync(path.join(source, "relance", "SKILL.md"), "---\nname: relance\n---\n\nRELANCE\n");
    symlinkSync(path.join(source, "relance"), path.join(source, "lien-relance"));
    const une = importerSkills(source, dest);
    assert.deepEqual(une.ajoutees, ["relance"]);
    assert.deepEqual(une.dejaLa, ["facture"]);
    assert.equal(readFileSync(path.join(dest, "relance", "SKILL.md"), "utf8").includes("RELANCE"), true);
    assert.equal(readFileSync(path.join(dest, "facture", "SKILL.md"), "utf8").includes("DEJA"), true);
    assert.equal(readFileSync(path.join(source, "facture", "SKILL.md"), "utf8").includes("SOURCE"), true);
    assert.equal(existsSync(path.join(dest, "lien-relance")), false);
    assert.equal(existsSync(path.join(dest, "vide")), false);
    assert.equal(existsSync(path.join(dest, "note.txt")), false);
    const deux = importerSkills(source, dest);
    assert.deepEqual(deux.ajoutees, []);
    assert.deepEqual(deux.dejaLa, ["facture", "relance"]);
    const seule = path.join(racine, "seule");
    mkdirSync(seule);
    writeFileSync(path.join(seule, "SKILL.md"), "---\nname: seule\n---\n\nSEULE\n");
    assert.deepEqual(importerSkills(seule, dest).ajoutees, ["seule"]);
    assert.equal(readFileSync(path.join(dest, "seule", "SKILL.md"), "utf8").includes("SEULE"), true);
    assert.equal(readFileSync(path.join(seule, "SKILL.md"), "utf8").includes("SEULE"), true);
    const avant = readFileSync(path.join(dest, "relance", "SKILL.md"), "utf8");
    importerSkills(dest, dest);
    assert.equal(readFileSync(path.join(dest, "relance", "SKILL.md"), "utf8"), avant);
    assert.deepEqual(importerSkills(path.join(racine, "absent"), dest).ignorees, ["absent"]);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});
