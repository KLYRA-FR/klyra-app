/**
 * Les skills dans les sessions de l'app, avec le vrai Claude Code face à un faux fournisseur local
 * (aucun compte, aucune dépense), lancé avec les options de `streamAgent` (electron/claude.ts).
 * Dossier personnel et projet jetables. Vérifie :
 * - les skills du poste et du projet sont présentées au modèle, celles livrées avec Claude Code non ;
 * - l'outil Skill charge une skill sans demande d'autorisation, à chacun des trois niveaux d'accès ;
 * - `/<skill>` n'est reconnu qu'en tête : derrière le contexte de l'app, rien n'est chargé, et
 *   `promptAvecSkill` (la commande remise en tête) la charge, avec tout le message en arguments ;
 * - les `skills` d'une fiche (liste écrite par `setListe`) : préchargées par Claude Code pour un
 *   sous-agent, pas pour un agent lancé seul (`--agent`) ; `competencesPrechargees` les lui donne ;
 * - une skill de plugin (plugin installé par `claude plugin install` depuis un dépôt local) : trouvée par
 *   `lireCompetences` sous son nom `<plugin>:<skill>`, présentée au modèle, chargée par `/outils:…`.
 * Prérequis : Claude Code installé (sinon le test est sauté), Node 22 (types retirés à la volée).
 *   pnpm test:skills
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { competencesPrechargees, lireCompetences, promptAvecSkill, skillsConnues } from "../electron/connaissances-agent.ts";
import { parseAgentFile, serializeAgentFile, setListe } from "../src/lib/agent-file.ts";

const CLAUDE = [
  process.env.KLYRA_CLAUDE_PATH,
  path.join(os.homedir(), ".local/bin/claude"),
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "claude")),
].find((c) => c && existsSync(c));
if (!CLAUDE) {
  console.log("Claude Code introuvable : test des skills sauté (KLYRA_CLAUDE_PATH).");
  process.exit(0);
}

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-skills-"));
const HOME = path.join(TMP, "home");
const CONFIG = path.join(HOME, ".claude");
const PROJET = path.join(TMP, "projet");
const echecs = [];
const verifier = (ok, quoi) => {
  console.log(`${ok ? "✓" : "✗"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

/* Le poste : une skill personnelle, une du projet, un agent qui précharge la première. */
mkdirSync(path.join(CONFIG, "skills", "rangement"), { recursive: true });
mkdirSync(path.join(CONFIG, "agents"), { recursive: true });
mkdirSync(path.join(PROJET, ".claude", "skills", "deploi"), { recursive: true });
writeFileSync(path.join(CONFIG, "skills", "rangement", "SKILL.md"), "---\nname: rangement\ndescription: Range les fichiers par type.\n---\n\nSKILL-RANGEMENT-TEXTE : trie par extension.\n");
writeFileSync(path.join(PROJET, ".claude", "skills", "deploi", "SKILL.md"), "---\nname: deploi\ndescription: Déploie le site.\n---\n\nSKILL-DEPLOI-TEXTE\n");
writeFileSync(path.join(HOME, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }));
const brut = parseAgentFile("---\nname: hugo\ndescription: \"Essai — Hugo.\"\nmodel: opus\n---\n\n# Hugo\n\nAGENT-HUGO\n");
const ficheHugo = serializeAgentFile({ frontmatter: setListe(brut.frontmatter, "skills", ["rangement"]), body: brut.body });
writeFileSync(path.join(CONFIG, "agents", "hugo.md"), ficheHugo);
verifier(/skills:\n {2}- rangement\n/.test(ficheHugo), "la fiche écrite par l’app porte ses skills en liste YAML");

/* Un plugin d'un dépôt local, installé par Claude Code lui-même, avec une skill. */
const MARCHE = path.join(TMP, "marche");
mkdirSync(path.join(MARCHE, ".claude-plugin"), { recursive: true });
mkdirSync(path.join(MARCHE, "outils", ".claude-plugin"), { recursive: true });
mkdirSync(path.join(MARCHE, "outils", "skills", "deploi-rapide"), { recursive: true });
writeFileSync(path.join(MARCHE, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "essai", owner: { name: "KLYRA" }, plugins: [{ name: "outils", source: "./outils", description: "Outils d’essai", version: "1.0.0" }] }));
writeFileSync(path.join(MARCHE, "outils", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "outils", version: "1.0.0", description: "Outils d’essai" }));
writeFileSync(path.join(MARCHE, "outils", "skills", "deploi-rapide", "SKILL.md"), "---\nname: deploi-rapide\ndescription: Déploie vite, skill de plugin.\n---\n\nSKILL-PLUGIN-TEXTE\n");
const claudePlugin = (...args) => spawnSync(CLAUDE, ["plugin", ...args], { cwd: PROJET, env: { PATH: process.env.PATH, HOME, DISABLE_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1" }, encoding: "utf8", timeout: 60_000 });
const ajoutMarche = claudePlugin("marketplace", "add", MARCHE);
const installation = claudePlugin("install", "outils@essai");
verifier(ajoutMarche.status === 0 && installation.status === 0, `plugin d’essai installé par Claude Code ${ajoutMarche.status === 0 && installation.status === 0 ? "" : `(${(ajoutMarche.stderr + installation.stderr).slice(0, 300)})`}`);

/* Le faux fournisseur : « utilise <skill> » appelle l'outil Skill, « appelle <agent> » l'outil Agent. */
const texte = (c) => (typeof c === "string" ? c : (c ?? []).map((x) => (x.type === "text" ? x.text : x.type === "tool_result" ? JSON.stringify(x.content) : "")).join("\n"));
let requetes = [];
const serveur = createServer((req, res) => {
  let b = "";
  req.on("data", (d) => (b += d));
  req.on("end", () => {
    if (req.url.includes("count_tokens")) return res.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":10}');
    if (!req.url.startsWith("/v1/messages")) return res.writeHead(404).end();
    const c = JSON.parse(b || "{}");
    const dernier = (c.messages ?? []).findLast((m) => m.role === "user");
    const resultats = Array.isArray(dernier?.content) ? dernier.content.filter((x) => x.type === "tool_result") : [];
    const systeme = JSON.stringify(c.system ?? "");
    const tout = `${systeme}\n${(c.messages ?? []).map((m) => texte(m.content)).join("\n")}`;
    const sousAgent = systeme.includes("AGENT-HUGO") && !systeme.includes("dans l’essai principal");
    const utilise = /utilise ([a-z0-9-]+)/.exec(texte(dernier?.content ?? ""));
    const appelle = /appelle ([a-z0-9-]+)/.exec(texte(dernier?.content ?? ""));
    const outils = (c.tools ?? []).map((t) => t.name);
    const id = `toolu_${randomUUID().slice(0, 8)}`;
    let blocs;
    if (resultats.length) blocs = [{ type: "text", text: `fin ${resultats.map((r) => (r.is_error ? "REFUS" : "OK")).join(",")}` }];
    else if (utilise && outils.includes("Skill")) blocs = [{ type: "tool_use", id, name: "Skill", input: { skill: utilise[1] } }];
    else if (appelle && outils.includes("Agent") && !sousAgent) blocs = [{ type: "tool_use", id, name: "Agent", input: { subagent_type: appelle[1], description: "Essai", prompt: "Dis bonjour.", run_in_background: false } }];
    else blocs = [{ type: "text", text: "ok" }];
    requetes.push({ tout, systeme, outils, sousAgent });
    const ev = [{ type: "message_start", message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: "faux", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }];
    blocs.forEach((x, i) => {
      ev.push({ type: "content_block_start", index: i, content_block: x.type === "text" ? { type: "text", text: "" } : { type: "tool_use", id: x.id, name: x.name, input: {} } });
      ev.push({ type: "content_block_delta", index: i, delta: x.type === "text" ? { type: "text_delta", text: x.text } : { type: "input_json_delta", partial_json: JSON.stringify(x.input) } });
      ev.push({ type: "content_block_stop", index: i });
    });
    ev.push({ type: "message_delta", delta: { stop_reason: blocs.some((x) => x.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
    ev.push({ type: "message_stop" });
    if (!c.stream) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "faux", content: blocs, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const e of ev) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    res.end();
  });
});
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const URL_FOURNISSEUR = `http://127.0.0.1:${serveur.address().port}`;

/** Un tour de Claude Code lancé comme `streamAgent` : message en flux, autorisations posées à l'app. */
function tour(prompt, { mode = "auto", agent = null, consignes = null, settings = null } = {}) {
  requetes = [];
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--exclude-dynamic-system-prompt-sections", "--permission-prompt-tool", "stdio", "--permission-prompts", "host", "--permission-mode", mode, "--disallowedTools", "AskUserQuestion", "EnterPlanMode"];
  if (settings) args.push("--settings", settings);
  if (agent) args.push("--agent", agent);
  args.push("--append-system-prompt", ["Consigne dans l’essai principal.", ...(consignes ? [consignes] : [])].join("\n\n"));
  const env = { PATH: process.env.PATH, HOME, ANTHROPIC_BASE_URL: URL_FOURNISSEUR, ANTHROPIC_API_KEY: "sk-faux", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", DISABLE_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1" };
  return new Promise((resolve) => {
    const enfant = spawn(CLAUDE, args, { cwd: PROJET, env });
    let sortie = "";
    enfant.stdout.on("data", (d) => (sortie += d));
    const delai = setTimeout(() => enfant.kill("SIGTERM"), 60_000);
    enfant.on("close", () => {
      clearTimeout(delai);
      const evenements = sortie.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      resolve({ evenements, requetes: [...requetes], demandes: evenements.filter((e) => e.type === "control_request") });
    });
    enfant.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`);
  });
}
const charge = (r, marque = "SKILL-RANGEMENT-TEXTE") => r.requetes.some((q) => q.tout.includes(marque));

try {
  for (const mode of ["manual", "auto", "acceptEdits"]) {
    const r = await tour("utilise rangement", { mode });
    const init = r.evenements.find((e) => e.subtype === "init");
    if (mode === "auto") {
      verifier(!!init?.skills?.includes("rangement") && !!init?.skills?.includes("deploi"), "les skills du poste et du projet sont dans la session");
      verifier(r.requetes[0]?.tout.includes("- rangement: Range les fichiers par type.") && r.requetes[0]?.tout.includes("- deploi: Déploie le site."), "et présentées au modèle avec leur description");
    }
    verifier(charge(r) && r.demandes.length === 0, `accès ${mode} : l’outil Skill charge la skill, sans demande d’autorisation`);
  }

  const contexte = "[Contexte] Tu échanges avec Corentin dans l’app de bureau KLYRA.\n\n[Message de Corentin]\n/rangement range le dossier";
  verifier(!charge(await tour(contexte)), "/rangement derrière le contexte de l’app n’est pas reconnu (d’où promptAvecSkill)");
  const envoye = promptAvecSkill(contexte, "rangement", skillsConnues(CONFIG, PROJET));
  const r = await tour(envoye);
  verifier(envoye.startsWith("/rangement\n\n") && charge(r), "/rangement remis en tête : la skill est chargée");
  verifier(r.requetes.some((q) => q.tout.includes("ARGUMENTS: [Contexte]") && q.tout.includes("range le dossier")), "avec tout le message de l’app en arguments");
  verifier(promptAvecSkill(contexte, "inconnue", skillsConnues(CONFIG, PROJET)) === contexte, "une skill inconnue laisse le message tel quel");

  const plugins = lireCompetences(null, CONFIG, PROJET).plugins;
  verifier(plugins.some((p) => p.nom === "outils:deploi-rapide" && p.description === "Déploie vite, skill de plugin."), "lireCompetences trouve la skill du plugin, sous son nom outils:deploi-rapide");
  const avecPlugin = await tour("bonjour");
  verifier(!!avecPlugin.evenements.find((e) => e.subtype === "init")?.skills?.includes("outils:deploi-rapide") && avecPlugin.requetes[0]?.tout.includes("- outils:deploi-rapide: Déploie vite, skill de plugin."), "Claude Code la présente au modèle sous le même nom");
  const contextePlugin = "[Contexte] Essai.\n\n[Message de Corentin]\n/outils:deploi-rapide vas-y";
  verifier(charge(await tour(promptAvecSkill(contextePlugin, "outils:deploi-rapide", skillsConnues(CONFIG, PROJET))), "SKILL-PLUGIN-TEXTE"), "/outils:deploi-rapide remis en tête : la skill du plugin est chargée");

  const sous = await tour("appelle hugo", { mode: "acceptEdits" });
  verifier(sous.requetes.some((q) => q.sousAgent && q.tout.includes("SKILL-RANGEMENT-TEXTE")), "sous-agent : Claude Code précharge les skills de sa fiche");
  const seul = await tour("bonjour", { agent: "hugo" });
  verifier(!charge(seul), "agent lancé seul (--agent) : Claude Code ne les précharge pas");
  const { texte: precharge } = competencesPrechargees(ficheHugo, CONFIG, PROJET);
  const aide = await tour("bonjour", { agent: "hugo", consignes: precharge });
  verifier(aide.requetes.length > 0 && aide.requetes.every((q) => q.systeme.includes("SKILL-RANGEMENT-TEXTE") && q.systeme.includes("AGENT-HUGO")), "agent lancé seul avec competencesPrechargees : sa skill est dans ses consignes");
  verifier(!readFileSync(path.join(CONFIG, "agents", "hugo.md"), "utf8").includes("SKILL-RANGEMENT-TEXTE"), "la fiche n’est pas modifiée par le préchargement");

  /* skillOverrides à off retire une skill sans retirer les agents ni les CLAUDE.md (04/11/2026). */
  writeFileSync(path.join(CONFIG, "CLAUDE.md"), "CLAUDE-PERSO-PREUVE\n");
  writeFileSync(path.join(PROJET, "CLAUDE.md"), "CLAUDE-PROJET-PREUVE\n");
  const ouvert = await tour("bonjour");
  const coupe = await tour("bonjour", { settings: JSON.stringify({ permissions: { ask: ["Agent"] }, skillOverrides: { rangement: "off" } }) });
  const taille = (r) => r.requetes[0]?.tout.length ?? 0;
  console.log(`Mesure skillOverrides : ${taille(ouvert)} caractères avec toutes les skills, ${taille(coupe)} avec rangement coupée (${taille(ouvert) - taille(coupe)} de moins).`);
  const initCoupe = coupe.evenements.find((e) => e.subtype === "init");
  const agentsCoupes = JSON.stringify(initCoupe?.agents ?? "");
  verifier(!!initCoupe?.skills?.includes("deploi") && !initCoupe?.skills?.includes("rangement"), "skillOverrides off retire rangement et garde deploi");
  verifier(agentsCoupes.includes("hugo"), `l’agent hugo reste (${agentsCoupes.slice(0, 180)})`);
  verifier(coupe.requetes[0]?.tout.includes("CLAUDE-PERSO-PREUVE") && coupe.requetes[0]?.tout.includes("CLAUDE-PROJET-PREUVE"), "les CLAUDE.md personnel et de projet restent dans la requête");
  verifier(!coupe.requetes[0]?.tout.includes("- rangement:") && !!coupe.requetes[0]?.tout.includes("- deploi:"), "la description coupée n’est pas dans la requête, l’autre reste");
} finally {
  serveur.close();
  rmSync(TMP, { recursive: true, force: true });
}

if (echecs.length) {
  console.error(`\n${echecs.length} vérification(s) en échec.`);
  process.exit(1);
}
console.log("\nSkills : tout est vérifié.");
