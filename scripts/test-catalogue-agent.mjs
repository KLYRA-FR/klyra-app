/**
 * Catalogue de l'agent appelé, avec le vrai Claude Code et un faux fournisseur
 * (aucun compte, aucun dossier personnel). Sinon le test est sauté.
 *   pnpm test:catalogue-agent
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { filtreSkills } from "../electron/connaissances-agent.ts";
import { preparerSessionClaude } from "../electron/preparation-fournisseur.ts";

const CLAUDE = [
  process.env.KLYRA_CLAUDE_PATH,
  "/var/lib/openbot/.local/bin/claude",
  path.join(os.homedir(), ".local/bin/claude"),
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "claude")),
].find((c) => c && existsSync(c));
if (!CLAUDE) {
  console.log("Claude Code introuvable : catalogue de l'agent appelé sauté (KLYRA_CLAUDE_PATH).");
  process.exit(0);
}

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-catalogue-"));
const HOME = path.join(TMP, "home");
const POSTE = path.join(HOME, ".claude");
const PROJET = path.join(TMP, "projet");
const USER = path.join(TMP, "userdata");
const echecs = [];
const verifier = (ok, quoi) => {
  console.log(`${ok ? "✓" : "✗"} ${quoi}`);
  if (!ok) echecs.push(quoi);
};

delete process.env.KLYRA_USER_DATA;
mkdirSync(path.join(POSTE, "agents"), { recursive: true });
mkdirSync(PROJET, { recursive: true });
for (const [nom, description, corps] of [
  ["rangement", "Range les fichiers.", "SKILL-RANGEMENT-TEXTE"],
  ["maquette", "Fait une maquette.", "SKILL-MAQUETTE-TEXTE"],
  ["partage", "En commun.", "SKILL-PARTAGE-TEXTE"],
]) {
  mkdirSync(path.join(POSTE, "skills", nom), { recursive: true });
  writeFileSync(path.join(POSTE, "skills", nom, "SKILL.md"), `---\nname: ${nom}\ndescription: ${description}\n---\n\n${corps}\n`);
}
writeFileSync(path.join(POSTE, "agents", "iris.md"), "---\nname: iris\ndescription: Iris.\n---\n\nAGENT-IRIS\n");
writeFileSync(path.join(POSTE, "agents", "hugo.md"), "---\nname: hugo\ndescription: Hugo.\n---\n\nAGENT-HUGO\n");
writeFileSync(path.join(HOME, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }));

const choix = {
  fige: true,
  personnellesConnues: ["rangement", "maquette", "partage"],
  agentsConnus: ["iris", "hugo", "principal"],
  coupees: { iris: ["rangement"], hugo: ["maquette"] },
  activees: {},
};
const filtre = filtreSkills(choix, "iris", POSTE, PROJET);
const session = preparerSessionClaude({
  userData: USER,
  home: HOME,
  agent: "iris",
  dossierAgents: path.join(POSTE, "agents"),
  idsActifs: ["iris", "hugo"],
  garder: filtre.garder,
  poste: POSTE,
  choix,
  configClaude: POSTE,
  dossierProjet: PROJET,
});
if (!session) {
  console.error("Session non préparée.");
  process.exit(1);
}

const requetes = [];
const serveur = createServer((req, res) => {
  let b = "";
  req.on("data", (d) => (b += d));
  req.on("end", () => {
    if (req.url.includes("count_tokens")) return res.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":10}');
    if (!req.url.startsWith("/v1/messages")) return res.writeHead(404).end();
    const c = JSON.parse(b || "{}");
    const texte = (x) => (typeof x === "string" ? x : JSON.stringify(x ?? ""));
    const systeme = texte(c.system);
    const tout = `${systeme}\n${(c.messages ?? []).map((m) => texte(m.content)).join("\n")}`;
    const outils = (c.tools ?? []).map((t) => t.name);
    const hugo = systeme.includes("AGENT-HUGO") && !systeme.includes("ESSAI-PARENT");
    const deja = (c.messages ?? []).some((m) => texte(m.content).includes("tool_result") || texte(m.content).includes("ok-sous"));
    requetes.push({ hugo, outils, tout });
    const blocs = hugo || deja
      ? [{ type: "text", text: "ok-sous" }]
      : [{ type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name: "Agent", input: { subagent_type: "hugo", description: "Essai", prompt: "Dis bonjour.", run_in_background: false } }];
    const ev = [{ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "faux", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }];
    blocs.forEach((x, i) => {
      ev.push({ type: "content_block_start", index: i, content_block: x.type === "text" ? { type: "text", text: "" } : { type: "tool_use", id: x.id, name: x.name, input: {} } });
      ev.push({ type: "content_block_delta", index: i, delta: x.type === "text" ? { type: "text_delta", text: x.text } : { type: "input_json_delta", partial_json: JSON.stringify(x.input) } });
      ev.push({ type: "content_block_stop", index: i });
    });
    ev.push({ type: "message_delta", delta: { stop_reason: blocs[0].type === "tool_use" ? "tool_use" : "end_turn" }, usage: { output_tokens: 1 } });
    ev.push({ type: "message_stop" });
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const e of ev) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    res.end();
  });
});

await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${serveur.address().port}`;
const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--exclude-dynamic-system-prompt-sections", "--permission-prompt-tool", "stdio", "--permission-prompts", "host", "--permission-mode", "acceptEdits", "--disallowedTools", "AskUserQuestion", "EnterPlanMode", "--append-system-prompt", "ESSAI-PARENT"];
const env = {
  PATH: process.env.PATH,
  HOME,
  CLAUDE_CONFIG_DIR: session.dossier,
  ANTHROPIC_BASE_URL: url,
  ANTHROPIC_API_KEY: "sk-faux",
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_AUTOUPDATER: "1",
};
let sortie = "";
try {
  await new Promise((resolve) => {
    const enfant = spawn(CLAUDE, args, { cwd: PROJET, env });
    enfant.stdout.on("data", (d) => (sortie += d));
    enfant.stderr.on("data", (d) => (sortie += d));
    const delai = setTimeout(() => enfant.kill("SIGTERM"), 50_000);
    enfant.on("close", () => {
      clearTimeout(delai);
      resolve();
    });
    enfant.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: "appelle hugo" } })}\n`);
  });
  const parent = requetes.find((r) => !r.hugo);
  const hugo = requetes.find((r) => r.hugo);
  const init = sortie.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.subtype === "init");
  verifier(!!parent && parent.outils.includes("Skill"), "la session a l'outil Skill");
  verifier(!!init?.skills?.includes("maquette") && !!init?.skills?.includes("partage") && !init?.skills?.includes("rangement"), `le catalogue de la session est le sien (${(init?.skills ?? []).join(",")})`);
  verifier(!!parent && parent.tout.includes("- maquette:") && parent.tout.includes("- partage:") && !parent.tout.includes("- rangement:"), "la session voit les descriptions des siennes, pas celle coupée");
  verifier(!!hugo && !hugo.outils.includes("Skill"), "Hugo n'a pas l'outil Skill");
  verifier(!!hugo && hugo.tout.includes("SKILL-RANGEMENT-TEXTE") && hugo.tout.includes("SKILL-PARTAGE-TEXTE"), "Hugo reçoit la skill injectée et celle préchargée");
  verifier(!!hugo && !hugo.tout.includes("SKILL-MAQUETTE-TEXTE") && !hugo.tout.includes("- maquette:"), "Hugo ne reçoit pas la skill de la session");
} finally {
  serveur.close();
  rmSync(TMP, { recursive: true, force: true });
}

if (echecs.length) {
  console.error(`\n${echecs.length} vérification(s) en échec.`);
  console.error(sortie.slice(0, 1500));
  process.exit(1);
}
