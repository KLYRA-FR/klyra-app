import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { competencesPrechargees, consigneSkillsCodex } from "./connaissances-agent.ts";
import {
  SKILLS_PAR_DEFAUT,
  definirSkill,
  figerChoix,
  nomsCoupes,
  reglagesSession,
  skillRecue,
  validerSkillsParAgent,
} from "./skills-par-agent.ts";

const PERMISSIONS = { permissions: { ask: ["Agent"] } };

test("un réglage absent reçoit tout, et le JSON de session ne change pas", () => {
  const choix = validerSkillsParAgent(null);
  assert.deepEqual(choix, SKILLS_PAR_DEFAUT);
  assert.equal(skillRecue(choix, "iris", "rangement", "poste"), true);
  assert.equal(skillRecue(choix, null, "deploi", "projet"), true);
  assert.equal(reglagesSession(PERMISSIONS, []), JSON.stringify(PERMISSIONS));
  assert.equal(reglagesSession(PERMISSIONS, nomsCoupes(choix, "iris", ["rangement"], ["deploi"])), JSON.stringify(PERMISSIONS));
});

test("le gel garde les skills déjà là, et une nouvelle ne part pas toute seule", () => {
  const fige = figerChoix(SKILLS_PAR_DEFAUT, ["principal", "iris"], ["rangement", "maquette"]);
  assert.equal(skillRecue(fige, "iris", "rangement", "poste"), true);
  assert.equal(skillRecue(fige, "principal", "maquette", "poste"), true);
  assert.equal(skillRecue(fige, "iris", "nouvelle", "poste"), false);
  assert.equal(skillRecue(fige, "hugo", "rangement", "poste"), false);
  assert.equal(skillRecue(fige, "hugo", "deploi", "projet"), true);
  assert.deepEqual(nomsCoupes(fige, "hugo", ["rangement", "nouvelle"], ["deploi"]), ["nouvelle", "rangement"]);
  assert.deepEqual(nomsCoupes(fige, "iris", ["rangement"], ["deploi"]), []);
  const second = figerChoix(fige, ["autre"], ["autre"]);
  assert.deepEqual(second.agentsConnus, fige.agentsConnus);
});

test("allumer et couper n’écrit que l’écart, et un nom invalide est refusé", () => {
  const fige = figerChoix(SKILLS_PAR_DEFAUT, ["iris"], ["rangement"]);
  const coupee = definirSkill(fige, "iris", "rangement", "poste", false);
  assert.deepEqual(coupee.coupees.iris, ["rangement"]);
  assert.equal(skillRecue(coupee, "iris", "rangement", "poste"), false);
  const rallumee = definirSkill(coupee, "iris", "rangement", "poste", true);
  assert.equal(rallumee.coupees.iris, undefined);
  assert.equal(skillRecue(rallumee, "iris", "rangement", "poste"), true);
  const ajoutee = definirSkill(fige, "iris", "nouvelle", "poste", true);
  assert.deepEqual(ajoutee.activees.iris, ["nouvelle"]);
  assert.equal(skillRecue(ajoutee, "iris", "nouvelle", "poste"), true);
  const projetCoupe = definirSkill(fige, "iris", "deploi", "projet", false);
  assert.equal(skillRecue(projetCoupe, "iris", "deploi", "projet"), false);
  assert.equal(skillRecue(projetCoupe, "hugo", "deploi", "projet"), true);
  assert.throws(() => definirSkill(SKILLS_PAR_DEFAUT, "iris", "rangement", "poste", false));
  assert.throws(() => definirSkill(fige, "../x", "rangement", "poste", false));
});

test("le validateur jette les noms inconnus, et skillOverrides n’apparaît que s’il y a une coupe", () => {
  const lu = validerSkillsParAgent({
    fige: true,
    personnellesConnues: ["rangement", "pas un nom", ""],
    agentsConnus: ["iris", "MAUVAIS"],
    coupees: { iris: ["deploi", "a b"], hugo: [] },
    activees: { "non valide": ["x"] },
  });
  assert.deepEqual(lu.personnellesConnues, ["rangement"]);
  assert.deepEqual(lu.agentsConnus, ["iris"]);
  assert.deepEqual(lu.coupees, { iris: ["deploi"] });
  assert.deepEqual(lu.activees, {});
  assert.equal(validerSkillsParAgent({ fige: false, coupees: { iris: ["rangement"] } }).coupees.iris, undefined);
  const json = reglagesSession(PERMISSIONS, ["beta", "alpha"]);
  assert.deepEqual(JSON.parse(json), { permissions: { ask: ["Agent"] }, skillOverrides: { alpha: "off", beta: "off" } });
});

test("une skill coupée n’est ni préchargée ni présentée à Codex", () => {
  const racine = mkdtempSync(path.join(tmpdir(), "klyra-skills-agent-"));
  try {
    const config = path.join(racine, ".claude");
    const projet = path.join(racine, "projet");
    mkdirSync(path.join(config, "skills", "rangement"), { recursive: true });
    mkdirSync(path.join(projet, ".claude", "skills", "deploi"), { recursive: true });
    writeFileSync(path.join(config, "skills", "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range.\n---\n\nSKILL-RANGEMENT-TEXTE\n");
    writeFileSync(path.join(projet, ".claude", "skills", "deploi", "SKILL.md"), "---\nname: deploi\ndescription: Déploie.\n---\n\nSKILL-DEPLOI-TEXTE\n");
    const fiche = "---\nname: iris\nskills:\n  - rangement\n  - deploi\n---\n\nIris.\n";
    const garder = (nom: string) => nom !== "rangement";
    const precharge = competencesPrechargees(fiche, config, projet, garder);
    assert.deepEqual(precharge.noms, ["deploi"]);
    assert.match(precharge.texte ?? "", /SKILL-DEPLOI-TEXTE/);
    assert.doesNotMatch(precharge.texte ?? "", /SKILL-RANGEMENT-TEXTE/);
    const codex = consigneSkillsCodex(fiche, config, projet, garder);
    assert.match(codex.texte ?? "", /deploi/);
    assert.doesNotMatch(codex.texte ?? "", /- rangement:/);
    assert.ok(!codex.noms.includes("rangement"));
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});
