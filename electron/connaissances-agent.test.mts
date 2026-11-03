import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cheminSouvenir,
  creerSouvenir,
  dossierMemoire,
  ecrireSouvenir,
  lireCompetences,
  lireMemoire,
  lireSouvenir,
  nomDeFichier,
  porteeDeLaFiche,
  competencesPrechargees,
  promptAvecSkill,
  skillEnTete,
  skillsConnues,
  skillsDeLaFiche,
} from "./connaissances-agent.ts";

function poste() {
  const racine = mkdtempSync(path.join(os.tmpdir(), "klyra-connaissances-"));
  const config = path.join(racine, ".claude");
  const projet = path.join(racine, "projet");
  mkdirSync(projet, { recursive: true });
  return { racine, config, projet, fin: () => rmSync(racine, { recursive: true, force: true }) };
}

test("les dossiers de la mémoire, tels que Claude Code les range", () => {
  assert.equal(dossierMemoire("hugo", "user", "/p", "/c"), path.join("/c", "agent-memory", "hugo"));
  assert.equal(dossierMemoire("hugo", "project", "/p", "/c"), path.join("/p", ".claude", "agent-memory", "hugo"));
  assert.equal(dossierMemoire("hugo", "local", "/p", "/c"), path.join("/p", ".claude", "agent-memory-local", "hugo"));
  assert.equal(dossierMemoire("principal", "auto", "/home/c/.klyra/atelier/principal", "/c"), path.join("/c", "projects", "-home-c--klyra-atelier-principal", "memory"));
  assert.throws(() => dossierMemoire("../x", "user", "/p", "/c"), /invalide/);
});

test("l'index d'abord, puis les souvenirs du plus récent au plus ancien, titrés par leur en-tête", () => {
  const { config, fin } = poste();
  try {
    const d = path.join(config, "agent-memory", "hugo");
    mkdirSync(path.join(d, "projets"), { recursive: true });
    writeFileSync(path.join(d, "MEMORY.md"), "- [Klyra](projets/klyra.md) — l'app\n- [Ton](ton.md)\n");
    writeFileSync(path.join(d, "ton.md"), "# Le ton de Corentin\n\nTutoiement, phrases courtes.\n");
    writeFileSync(path.join(d, "projets", "klyra.md"), '---\nname: "KLYRA, l’app"\ndescription: Electron et Next\n---\n\nDétails.\n');
    writeFileSync(path.join(d, "notes.txt"), "pas un souvenir");
    utimesSync(path.join(d, "ton.md"), new Date(2026, 0, 1), new Date(2026, 0, 1));
    const m = lireMemoire("user", d);
    assert.deepEqual(m.souvenirs.map((s) => s.id), ["MEMORY.md", "projets/klyra.md", "ton.md"]);
    assert.equal(m.souvenirs[0].toujours, true);
    assert.equal(m.souvenirs[0].description, "2 lignes");
    assert.equal(m.souvenirs[1].titre, "KLYRA, l’app");
    assert.equal(m.souvenirs[1].description, "Electron et Next");
    assert.equal(m.souvenirs[2].titre, "Le ton de Corentin");
    assert.equal(m.souvenirs[2].description, "Tutoiement, phrases courtes.");
  } finally {
    fin();
  }
});

test("une mémoire qui n'existe pas encore est vide, sans erreur", () => {
  const m = lireMemoire("project", "/nulle/part/agent-memory/hugo");
  assert.deepEqual(m.souvenirs, []);
});

test("un souvenir reste dans le dossier de la mémoire", () => {
  assert.throws(() => cheminSouvenir("/m", "../secret.md"), /pas dans la mémoire/);
  assert.throws(() => cheminSouvenir("/m", "/etc/passwd.md"), /pas dans la mémoire/);
  assert.throws(() => cheminSouvenir("/m", "ton.txt"), /pas dans la mémoire/);
  assert.equal(cheminSouvenir("/m", "projets/klyra.md"), path.resolve("/m", "projets/klyra.md"));
});

test("créer un souvenir : un fichier avec son en-tête, sa ligne dans l'index, jamais d'écrasement", () => {
  const { config, fin } = poste();
  try {
    const d = path.join(config, "agent-memory", "hugo");
    const a = creerSouvenir(d, "Réunion du 3 nov.", "Décidé : la v2 sort lundi.\nDétails ensuite.");
    assert.equal(a.id, "reunion-du-3-nov.md");
    assert.equal(a.titre, "Réunion du 3 nov.");
    assert.equal(a.description, "Décidé : la v2 sort lundi.");
    const b = creerSouvenir(d, "Réunion du 3 nov.", "Autre chose.");
    assert.equal(b.id, "reunion-du-3-nov-2.md");
    const index = readFileSync(path.join(d, "MEMORY.md"), "utf8");
    assert.match(index, /^- \[Réunion du 3 nov\.\]\(reunion-du-3-nov\.md\) — Décidé : la v2 sort lundi\.\n- \[Réunion du 3 nov\.\]\(reunion-du-3-nov-2\.md\) — Autre chose\.\n$/);
    assert.throws(() => creerSouvenir(d, " ", "x"), /titre et un contenu/);
    assert.equal(nomDeFichier("MEMORY"), "memory");
  } finally {
    fin();
  }
});

test("modifier un souvenir refuse un fichier changé depuis sa lecture", () => {
  const { config, fin } = poste();
  try {
    const d = path.join(config, "agent-memory", "hugo");
    const s = creerSouvenir(d, "Ton", "Court.");
    const lu = lireSouvenir(d, s.id);
    ecrireSouvenir(d, s.id, `${lu.contenu}Encore.`, lu.modifieLe);
    assert.match(readFileSync(path.join(d, s.id), "utf8"), /Encore\.\n$/);
    assert.throws(() => ecrireSouvenir(d, s.id, "écrasé", lu.modifieLe - 60_000), /a changé/);
    assert.throws(() => ecrireSouvenir(d, "absent.md", "x", null), /n’existe plus/);
  } finally {
    fin();
  }
});

test("les skills de la fiche, sous chacune de ses formes", () => {
  assert.deepEqual(skillsDeLaFiche("---\nname: a\nskills: rangement, \"composio-cli\"\n---\n"), ["rangement", "composio-cli"]);
  assert.deepEqual(skillsDeLaFiche("---\nskills: [a, b]\n---\n"), ["a", "b"]);
  assert.deepEqual(skillsDeLaFiche("---\nskills:\n  - a\n  - 'b'\nmodel: opus\n---\n"), ["a", "b"]);
  assert.deepEqual(skillsDeLaFiche("---\nname: a\n---\nskills: x\n"), []);
});

test("compétences : celles de la fiche retrouvées sur le poste ou le projet, puis toutes celles du poste et du projet", () => {
  const { config, projet, fin } = poste();
  try {
    mkdirSync(path.join(config, "skills", "rangement"), { recursive: true });
    writeFileSync(path.join(config, "skills", "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range les fichiers\nversion: 14\n---\n");
    mkdirSync(path.join(projet, ".claude", "skills", "deploi"), { recursive: true });
    writeFileSync(path.join(projet, ".claude", "skills", "deploi", "SKILL.md"), "---\nname: deploi\ndescription: Déploie\n---\n");
    const c = lireCompetences("---\nskills: rangement, absente\n---\n", config, projet);
    assert.deepEqual(c.fiche.map((s) => [s.nom, s.version, !!s.dossier]), [["rangement", "14", true], ["absente", null, false]]);
    assert.deepEqual(c.poste.map((s) => s.description), ["Range les fichiers"]);
    assert.deepEqual(c.projet.map((s) => s.nom), ["deploi"]);
    assert.deepEqual(lireCompetences(null, config, null).projet, []);
  } finally {
    fin();
  }
});

test("la portée vient de l'en-tête de la fiche, jamais de son texte", () => {
  assert.equal(porteeDeLaFiche("---\nname: a\nmemory: project\n---\n"), "project");
  assert.equal(porteeDeLaFiche("---\nmemory: \"user\"\n---\n"), "user");
  assert.equal(porteeDeLaFiche("---\nname: a\n---\nmemory: user\n"), null);
  assert.equal(porteeDeLaFiche("---\nmemory: auto\n---\n"), null);
  assert.equal(porteeDeLaFiche(""), null);
});

test("une skill demandée en tête du message, jamais /compact", () => {
  assert.equal(skillEnTete("/rangement range le dossier"), "rangement");
  assert.equal(skillEnTete("  /rangement"), "rangement");
  assert.equal(skillEnTete("/outils:deploi vite"), "outils:deploi");
  assert.equal(skillEnTete("/compact"), null);
  assert.equal(skillEnTete("range avec /rangement"), null);
  assert.equal(skillEnTete("/"), null);
  assert.equal(skillEnTete("/rangement.txt"), null);
});

test("la commande remise en tête, devant le contexte de l'app, seulement pour une skill connue", () => {
  const connues = new Set(["rangement"]);
  const prompt = "[Contexte] Tu échanges avec Corentin.\n\n[Message de Corentin]\n/rangement range le dossier";
  assert.equal(promptAvecSkill(prompt, "rangement", connues), `/rangement\n\n${prompt}`);
  assert.equal(promptAvecSkill("/rangement range", "rangement", connues), "/rangement range");
  assert.equal(promptAvecSkill(prompt, "clear", connues), prompt);
  assert.equal(promptAvecSkill(prompt, "../x", new Set(["../x"])), prompt);
  assert.equal(promptAvecSkill(prompt, null, connues), prompt);
});

test("les skills connues du poste et du projet, et ce que la fiche précharge", () => {
  const { config, projet, fin } = poste();
  try {
    mkdirSync(path.join(config, "skills", "rangement"), { recursive: true });
    writeFileSync(path.join(config, "skills", "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range\n---\n\nTrie par extension.\n");
    mkdirSync(path.join(projet, ".claude", "skills", "dossier-deploi"), { recursive: true });
    writeFileSync(path.join(projet, ".claude", "skills", "dossier-deploi", "SKILL.md"), "---\nname: deploi\n---\n\n" + "x".repeat(50_000));
    assert.deepEqual([...skillsConnues(config, projet)].sort(), ["deploi", "dossier-deploi", "rangement"]);
    assert.deepEqual([...skillsConnues(config, null)], ["rangement"]);
    const p = competencesPrechargees("---\nskills:\n  - rangement\n  - deploi\n  - absente\n---\n", config, projet);
    assert.deepEqual(p.noms, ["rangement", "deploi", "absente"]);
    assert.match(p.texte ?? "", /<competence nom="rangement">\nDossier de la compétence : .*rangement\n\nTrie par extension\.\n<\/competence>/);
    assert.doesNotMatch(p.texte ?? "", /description: Range/);
    assert.match(p.texte ?? "", /\[Coupée ici : lis la suite dans .*SKILL\.md\.\]/);
    assert.match(p.texte ?? "", /Introuvables sur ce poste, donc absentes : absente\./);
    assert.deepEqual(competencesPrechargees("---\nname: a\n---\n", config, projet), { noms: [], texte: null });
    assert.deepEqual(competencesPrechargees(null, config, projet), { noms: [], texte: null });
  } finally {
    fin();
  }
});
