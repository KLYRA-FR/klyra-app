/**
 * Ce que l'app lit et demande à Claude Code (electron/session-claude.ts), et les petits modules des projets qui
 * vont avec : liste des fichiers (« @ »), autorisations retenues, branches de travail, sessions du terminal.
 *   node --experimental-strip-types --test electron/session-claude.test.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  commandeLancee,
  creerControles,
  creerInstantanes,
  diffDeLaReponse,
  entreeAvecReponses,
  fenetreDe,
  lireCommandes,
  lirePlan,
  lireQuestions,
  lireSortie,
  lireUsageContexte,
  morceauReflexion,
  reponsePlan,
  requeteInitialisation,
  sortieDe,
  versCorbeille,
} from "./session-claude.ts";
import { listerFichiersProjet } from "./liste-fichiers.ts";
import { lireReglesProjet, reglesProposees, retirerRegleProjet } from "./regles-projet.ts";
import { creerBrancheTravail, nomBrancheTravail, retirerBrancheTravail } from "./branche-travail.ts";
import { commandeTerminal, dossierTranscriptions, lireSessionTerminal, listerSessionsTerminal } from "./sessions-terminal.ts";

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-session-claude-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

test("réflexion : un bloc qui commence, puis ses morceaux ; le reste n'en est pas", () => {
  assert.deepEqual(morceauReflexion({ type: "content_block_start", content_block: { type: "thinking", thinking: "" } }), { texte: "", nouveau: true });
  assert.deepEqual(morceauReflexion({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Je pèse" } }), { texte: "Je pèse", nouveau: false });
  assert.equal(morceauReflexion({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } }), null);
  assert.equal(morceauReflexion({ type: "content_block_delta", delta: { type: "signature_delta", signature: "s" } }), null);
});

test("questions : lues proprement, réponses rendues seulement pour les questions posées", () => {
  const entree = {
    questions: [
      { question: "Quelle couleur ?", header: "Couleur", options: [{ label: "Bleu", description: "le bleu" }, { label: "" }], multiSelect: false },
      { question: "Quelle couleur ?", header: "doublon", options: [] },
      { question: "", options: [] },
    ],
  };
  const questions = lireQuestions(entree);
  assert.deepEqual(questions, [{ question: "Quelle couleur ?", entete: "Couleur", options: [{ libelle: "Bleu", description: "le bleu" }], multiple: false }]);
  assert.equal(lireQuestions({}), null);
  assert.deepEqual(entreeAvecReponses(entree, { "Quelle couleur ?": "Bleu", "Autre ?": "x" })?.answers, { "Quelle couleur ?": "Bleu" });
  assert.equal(entreeAvecReponses(entree, { "Autre ?": "x" }), null);
  assert.equal(entreeAvecReponses(entree, null), null);
});

test("plan : lu dans l'appel ; lancé, il rend l'accès de la conversation ; refusé, il dit quoi changer", () => {
  assert.equal(lirePlan({ plan: "  # Plan\n1. A  " }), "# Plan\n1. A");
  assert.equal(lirePlan({}), null);
  const lance = reponsePlan(true, { plan: "x" }, "acceptEdits", "");
  assert.deepEqual(lance.updatedPermissions, [{ type: "setMode", mode: "acceptEdits", destination: "session" }]);
  const corrige = reponsePlan(false, {}, "auto", "Ajoute les tests");
  assert.equal(corrige.behavior, "deny");
  assert.match(String(corrige.message), /Ajoute les tests/);
});

test("initialisation : les rappels avant et après les outils de modification", () => {
  const r = requeteInitialisation() as { hooks: { PreToolUse: { matcher: string }[]; PostToolUse: { matcher: string }[] } };
  assert.equal(r.hooks.PreToolUse[0].matcher, "Write|Edit|MultiEdit|NotebookEdit");
  assert.equal(r.hooks.PostToolUse[0].matcher, "Write|Edit|MultiEdit|NotebookEdit");
});

test("commandes, contexte, fenêtre, sortie", () => {
  assert.deepEqual(lireCommandes([{ name: "review", description: "Relit", argumentHint: "[pr]" }, { name: "review" }, { name: "pas bon" }, "init"]), [
    { nom: "review", description: "Relit", indice: "[pr]" },
    { nom: "init", description: "", indice: "" },
  ]);
  assert.deepEqual(lireCommandes([{ name: "clear" }, { name: "doctor" }, { name: "heapdump" }, { name: "security-review" }, { name: "lint" }], new Set(["lint"])).map((c) => c.nom), ["security-review"]);
  const usage = lireUsageContexte({ totalTokens: 51407, maxTokens: 200000, categories: [{ id: "messages", name: "Messages", tokens: 1200, kind: "used" }, { id: "x", name: "Vide", tokens: 0 }] });
  assert.deepEqual(usage, { total: 51407, max: 200000, categories: [{ id: "messages", nom: "Messages", jetons: 1200, genre: "used" }] });
  assert.equal(lireUsageContexte({}), null);
  assert.equal(fenetreDe({ "claude-sonnet-4-6": { contextWindow: 200000 }, haiku: { contextWindow: 1000000 } }), 1000000);
  assert.equal(fenetreDe({}), null);
  assert.equal(lireSortie({ output: "\u001b[32mvert\u001b[0m\rbis\n" }), "vert\nbis\n");
  assert.equal(lireSortie({}), null);
  assert.equal(sortieDe([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(sortieDe("x".repeat(9000)).length, 8192 + 2);
  assert.deepEqual(commandeLancee({ type: "system", subtype: "task_started", task_type: "local_bash", task_id: "t1", tool_use_id: "toolu_1", is_backgrounded: false }), { tache: "t1", appel: "toolu_1", fond: false });
  assert.equal(commandeLancee({ type: "system", subtype: "task_started", task_type: "local_agent", task_id: "t1", tool_use_id: "toolu_1" }), null);
});

test("diff : d'après la réponse de l'outil (patch, ou fichier créé)", () => {
  const edit = diffDeLaReponse({ type: "update", structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-bonjour", "+salut"] }] });
  assert.deepEqual(edit, { lignes: ["@@ -1,1 +1,1 @@", "-bonjour", "+salut"], ajouts: 1, retraits: 1, tronque: false, cree: false });
  const cree = diffDeLaReponse({ type: "create", content: "a\nb\n", structuredPatch: [], originalFile: null });
  assert.deepEqual(cree, { lignes: ["@@ -0,0 +1,2 @@", "+a", "+b"], ajouts: 2, retraits: 0, tronque: false, cree: true });
  assert.equal(diffDeLaReponse({}), null);
  const long = diffDeLaReponse({ structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 500, lines: Array.from({ length: 500 }, (_, i) => `+${i}`) }] });
  assert.equal(long?.tronque, true);
  assert.equal(long?.lignes.length, 400);
});

test("instantanés : annuler une modification, un fichier créé, un conflit, forcer, deux fois", () => {
  const corbeille = path.join(TMP, "corbeille");
  const store = creerInstantanes(path.join(TMP, "instantanes"), { supprimer: versCorbeille(corbeille) });
  const projet = path.join(TMP, "projet");
  mkdirSync(projet, { recursive: true });
  const fichier = path.join(projet, "page.txt");
  writeFileSync(fichier, "bonjour\n");
  // Une modification : avant, l'outil écrit, après.
  store.avant("conv", { tool_use_id: "toolu_a", tool_name: "Edit", tool_input: { file_path: fichier } });
  writeFileSync(fichier, "salut\n");
  const vue = store.apres("conv", { tool_use_id: "toolu_a", tool_input: { file_path: fichier }, tool_response: { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-bonjour", "+salut"] }] } });
  assert.equal(vue?.annulable, true);
  assert.equal(vue?.ajouts, 1);
  // Une deuxième, sur le même fichier.
  store.avant("conv", { tool_use_id: "toolu_b", tool_name: "Edit", tool_input: { file_path: fichier } });
  writeFileSync(fichier, "salut tout le monde\n");
  store.apres("conv", { tool_use_id: "toolu_b", tool_input: { file_path: fichier } });
  // Un fichier créé.
  const nouveau = path.join(projet, "nouveau.txt");
  store.avant("conv", { tool_use_id: "toolu_c", tool_name: "Write", tool_input: { file_path: nouveau } });
  writeFileSync(nouveau, "neuf\n");
  assert.equal(store.apres("conv", { tool_use_id: "toolu_c", tool_input: { file_path: nouveau }, tool_response: { type: "create", content: "neuf\n" } })?.cree, true);

  // Changé depuis par quelqu'un d'autre : rien ne bouge sans forcer.
  writeFileSync(fichier, "changé à la main\n");
  assert.deepEqual(store.annuler("conv", ["toolu_a", "toolu_b"]).fichiers, [{ chemin: fichier, etat: "conflit", raison: "Le fichier a changé depuis." }]);
  assert.equal(readFileSync(fichier, "utf8"), "changé à la main\n");
  // Forcé : il revient comme avant la première modification.
  assert.deepEqual(store.annuler("conv", ["toolu_a", "toolu_b"], true).fichiers, [{ chemin: fichier, etat: "annule" }]);
  assert.equal(readFileSync(fichier, "utf8"), "bonjour\n");
  // Une deuxième fois : déjà fait.
  assert.deepEqual(store.annuler("conv", ["toolu_a"]).fichiers, [{ chemin: fichier, etat: "deja" }]);
  // Le fichier créé part à la corbeille, sans être détruit.
  assert.deepEqual(store.annuler("conv", ["toolu_c"]).fichiers, [{ chemin: nouveau, etat: "annule" }]);
  assert.equal(existsSync(nouveau), false);
  assert.equal(readdirSync(corbeille).length, 1);
  // Un appel inconnu, un id hors de forme : rien.
  assert.deepEqual(store.annuler("conv", ["toolu_x", "../evil"]).fichiers, []);
  assert.deepEqual(store.annuler("../conv", ["toolu_a"]).fichiers, []);
  // Une modification refusée (pas d'après) : pas annulable.
  store.avant("conv", { tool_use_id: "toolu_d", tool_name: "Write", tool_input: { file_path: path.join(projet, "refuse.txt") } });
  assert.equal(store.annuler("conv", ["toolu_d"]).fichiers[0]?.etat, "impossible");
  // Un fichier binaire n'est pas gardé.
  const image = path.join(projet, "image.bin");
  writeFileSync(image, Buffer.from([0, 1, 2, 3]));
  store.avant("conv", { tool_use_id: "toolu_e", tool_name: "Write", tool_input: { file_path: image } });
  assert.equal(store.apres("conv", { tool_use_id: "toolu_e", tool_input: { file_path: image } })?.annulable, false);
  // Oublier une conversation retire ce qui était gardé.
  store.oublier("conv");
  assert.equal(existsSync(path.join(TMP, "instantanes", "conv")), false);
});

test("contrôles : une réponse par demande, une erreur rendue, et tout échoue à la fermeture", async () => {
  const ecrits: unknown[] = [];
  let n = 0;
  const c = creerControles((l) => ecrits.push(l), () => `id${++n}`);
  const a = c.demander({ subtype: "get_context_usage" });
  const b = c.demander({ subtype: "get_plan" });
  assert.equal(c.recevoir({ type: "control_response", response: { subtype: "success", request_id: "id1", response: { totalTokens: 1 } } }), true);
  assert.deepEqual(await a, { totalTokens: 1 });
  assert.equal(c.recevoir({ type: "control_response", response: { subtype: "error", request_id: "id2", error: "non" } }), true);
  await assert.rejects(b, /non/);
  assert.equal(c.recevoir({ type: "control_response", response: { subtype: "success", request_id: "inconnu" } }), false);
  const d = c.demander({ subtype: "x" });
  c.fermer();
  await assert.rejects(d, /arrêté/);
  assert.equal(ecrits.length, 3);
});

test("liste des fichiers : par Git dans un dépôt (sans les ignorés), sinon en parcourant le dossier", () => {
  const depot = path.join(TMP, "depot-liste");
  mkdirSync(path.join(depot, "src"), { recursive: true });
  mkdirSync(path.join(depot, "node_modules", "x"), { recursive: true });
  writeFileSync(path.join(depot, "src", "page.tsx"), "x");
  writeFileSync(path.join(depot, "lisez moi.md"), "x");
  writeFileSync(path.join(depot, "node_modules", "x", "i.js"), "x");
  writeFileSync(path.join(depot, ".gitignore"), "ignore.txt\n");
  writeFileSync(path.join(depot, "ignore.txt"), "x");
  assert.deepEqual(listerFichiersProjet(depot).fichiers.sort(), [".gitignore", "ignore.txt", "lisez moi.md", "src/page.tsx"]);
  execFileSync("git", ["init", "-q"], { cwd: depot });
  assert.deepEqual(listerFichiersProjet(depot).fichiers.sort(), [".gitignore", "lisez moi.md", "src/page.tsx"]);
  assert.deepEqual(listerFichiersProjet(depot, 2), { fichiers: listerFichiersProjet(depot).fichiers.slice(0, 2), coupe: true });
});

test("autorisations retenues : lues, une règle retirée sans toucher au reste, jamais par un lien", () => {
  const projet = path.join(TMP, "projet-regles");
  mkdirSync(path.join(projet, ".claude"), { recursive: true });
  assert.deepEqual(lireReglesProjet(projet), { allow: [], ask: [], deny: [] });
  writeFileSync(path.join(projet, ".claude", "settings.local.json"), JSON.stringify({ model: "opus", permissions: { allow: ["Bash(npm test:*)", "Read(./src/**)"], defaultMode: "acceptEdits" } }));
  assert.deepEqual(lireReglesProjet(projet).allow, ["Bash(npm test:*)", "Read(./src/**)"]);
  assert.deepEqual(retirerRegleProjet(projet, "allow", "Bash(npm test:*)").allow, ["Read(./src/**)"]);
  const relu = JSON.parse(readFileSync(path.join(projet, ".claude", "settings.local.json"), "utf8"));
  assert.equal(relu.model, "opus");
  assert.equal(relu.permissions.defaultMode, "acceptEdits");
  assert.throws(() => retirerRegleProjet(projet, "autre" as "allow", "x"), /invalide/);
  assert.deepEqual(reglesProposees([{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test:*" }, { toolName: "WebFetch" }], behavior: "allow", destination: "localSettings" }, { type: "setMode", mode: "acceptEdits" }]), ["Bash(npm test:*)", "WebFetch"]);
});

test("branches de travail : un dossier à part sur une branche neuve, caché du dépôt principal, retiré s'il est propre", async () => {
  const depot = path.join(TMP, "depot-branches");
  mkdirSync(path.join(depot, "app"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=essai@klyra.fr", "-c", "user.name=Essai", ...args], { cwd: depot, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(depot, "app", "page.txt"), "v1\n");
  git("add", "-A");
  git("commit", "-qm", "départ");
  // Un crochet du dépôt ne doit jamais tourner.
  writeFileSync(path.join(depot, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch "${path.join(TMP, "crochet-lance")}"\n`, { mode: 0o755 });
  assert.equal(nomBrancheTravail("Correctif du Menu !"), "correctif-du-menu");
  assert.equal(nomBrancheTravail("!!!"), null);
  const b = await creerBrancheTravail(path.join(depot, "app"), "Correctif menu");
  assert.equal(b.branche, "klyra/correctif-menu");
  assert.equal(b.dossier, path.join(depot, ".claude", "worktrees", "correctif-menu", "app"));
  assert.equal(readFileSync(path.join(b.dossier, "page.txt"), "utf8"), "v1\n");
  assert.equal(existsSync(path.join(TMP, "crochet-lance")), false);
  assert.equal(git("status", "--porcelain").trim(), "");
  await assert.rejects(creerBrancheTravail(path.join(depot, "app"), "correctif menu"), /existe déjà/);
  // Pas propre : il reste.
  writeFileSync(path.join(b.dossier, "nouveau.txt"), "x");
  await assert.rejects(retirerBrancheTravail(b.dossier), /pas encore publiés/);
  rmSync(path.join(b.dossier, "nouveau.txt"));
  await retirerBrancheTravail(b.dossier);
  assert.equal(existsSync(path.join(depot, ".claude", "worktrees", "correctif-menu")), false);
  assert.match(git("branch", "--list", "klyra/correctif-menu"), /klyra\/correctif-menu/);
  await assert.rejects(retirerBrancheTravail(path.join(depot, "app")), /pas une branche de travail/);
});

test("sessions du terminal : listées (celles de l'app reconnues), lues sans outils ni rappels, commande pour les reprendre", () => {
  const config = path.join(TMP, "config-claude");
  const projet = path.join(TMP, "projet sessions");
  mkdirSync(projet, { recursive: true });
  const dossier = dossierTranscriptions(config, projet);
  assert.equal(path.basename(dossier), projet.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dossier, { recursive: true });
  const id1 = "11111111-1111-4111-8111-111111111111";
  const id2 = "22222222-2222-4222-8222-222222222222";
  const lignes = (...l: unknown[]) => l.map((x) => JSON.stringify(x)).join("\n");
  writeFileSync(
    path.join(dossier, `${id1}.jsonl`),
    lignes(
      { type: "user", message: { role: "user", content: "<command-name>/clear</command-name>" }, timestamp: "2026-11-01T10:00:00Z" },
      { type: "user", message: { role: "user", content: "Corrige le menu" }, timestamp: "2026-11-01T10:00:01Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "Je regarde." }, { type: "tool_use", id: "t", name: "Read", input: {} }] }, timestamp: "2026-11-01T10:00:02Z" },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "…" }] }, timestamp: "2026-11-01T10:00:03Z" },
      { type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "sous-agent" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "C'est corrigé." }] }, timestamp: "2026-11-01T10:00:04Z" },
      { type: "user", message: { role: "user", content: "<system-reminder>x</system-reminder>Merci" }, timestamp: "2026-11-01T10:00:05Z" },
    ),
  );
  writeFileSync(path.join(dossier, `${id2}.jsonl`), lignes({ type: "user", message: { role: "user", content: "[Contexte] Tu échanges avec Corentin" } }));
  const liste = listerSessionsTerminal(config, projet);
  assert.deepEqual(
    liste.map((s) => [s.id, s.titre, s.deLApp]).sort(),
    [
      [id1, "Corrige le menu", false],
      [id2, "[Contexte] Tu échanges avec Corentin", true],
    ],
  );
  assert.deepEqual(
    lireSessionTerminal(config, projet, id1).map((m) => [m.auteur, m.texte]),
    [
      ["personne", "Corrige le menu"],
      ["agent", "Je regarde.\n\nC'est corrigé."],
      ["personne", "Merci"],
    ],
  );
  assert.throws(() => lireSessionTerminal(config, projet, "../x"), /invalide/);
  assert.equal(commandeTerminal("/srv/mon projet", id1), `cd '/srv/mon projet' && claude --resume ${id1}`);
  assert.equal(commandeTerminal("C:\\projet d'Eve", id1, true), `cd 'C:\\projet d''Eve'; claude --resume ${id1}`);
  assert.equal(commandeTerminal("/srv/l'atelier", id1), `cd '/srv/l'\\''atelier' && claude --resume ${id1}`);
});
