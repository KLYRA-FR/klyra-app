/**
 * Les outils MCP de l'app avec ChatGPT : le vrai Codex, lancé par `serveur/codex.mjs` (le même protocole que
 * l'app, `codex-protocole`), face au faux serveur « Responses » d'OpenAI et à un petit serveur MCP local.
 * Aucun compte, aucune dépense ; dossiers jetables.
 * Codex demande l'accord avant chaque appel d'outil MCP (`mcpServer/elicitation/request`), et le refuse en accès
 * complet : l'app refusait d'office, l'agent lisait « user rejected MCP tool call ». Vérifie :
 * - accès « Projet » : un outil libre (même liste que l'`--allowedTools` de Claude Code) passe sans carte ;
 *   un autre ouvre une carte d'autorisation qui porte l'outil, son entrée et sa description ;
 * - la carte acceptée : l'outil tourne ; refusée : il ne tourne pas ; « toujours » : plus de carte dans la session ;
 * - accès « Demander » : même un outil libre passe par une carte ;
 * - accès complet : tout outil passe, sans carte.
 *   KLYRA_CODEX_PATH=/chemin/codex node scripts/test-codex-mcp.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { demarrerFauxOpenAI, configCodex } = require("./faux-openai.cjs");

const bin = process.env.KLYRA_CODEX_PATH;
if (!bin) {
  console.log("Codex introuvable : test sauté (KLYRA_CODEX_PATH).");
  process.exit(0);
}

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-codex-mcp-"));
const HOME = path.join(TMP, "klyra");
const DONNEES = path.join(HOME, "donnees");
const CODEX_HOME = path.join(TMP, "codex");
const PROJET = path.join(HOME, "projet");
for (const d of [DONNEES, CODEX_HOME, PROJET]) mkdirSync(d, { recursive: true });
process.env.CODEX_HOME = CODEX_HOME;
process.env.KLYRA_USER_DATA = DONNEES;
process.env.FAUX_CLE = "sk-faux-essai";
const ok = (texte) => console.log(`OK     ${texte}`);

/* Un serveur MCP sur stdio, deux outils : chacun rend « FAIT-<outil> ». */
const serveurMcp = path.join(TMP, "faux-mcp.mjs");
writeFileSync(
  serveurMcp,
  `import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const outil = (name, description) => ({ name, description, inputSchema: { type: "object", properties: { q: { type: "string" } } } });
readline.createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "essai", version: "1" } } });
  else if (m.method === "tools/list") out({ jsonrpc: "2.0", id: m.id, result: { tools: [outil("lire_truc", "Lit un truc."), outil("ecrire_truc", "Écrit un truc.")] } });
  else if (m.method === "tools/call") out({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "FAIT-" + m.params.name }] } });
  else if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, result: {} });
});
`,
);

const { creerCodex } = await import("../serveur/codex.mjs");
const openai = await demarrerFauxOpenAI();
writeFileSync(path.join(CODEX_HOME, "config.toml"), configCodex(openai.url));

const evenements = new Map();
const codex = creerCodex({
  home: HOME,
  donnees: DONNEES,
  version: "essai",
  publier: (requestId, event) => {
    if (!evenements.has(requestId)) evenements.set(requestId, []);
    evenements.get(requestId).push(event);
  },
  consigne: () => "Tu es l'assistant.",
  estActif: () => true,
  mcp: () => JSON.stringify({ mcpServers: { essai: { command: process.execPath, args: [serveurMcp] } } }),
  // Comme `outilsLibres` d'agents.mjs : seul `lire_truc` est libre en accès « Projet ».
  outilsLibres: () => ["mcp__essai__lire_truc", "mcp__klyra__cerveau_chercher"],
  generation: () => "g",
  codex: bin,
});

let n = 0;
/** Une réponse jusqu'à son `fin` ; `surCarte` répond à chaque carte d'autorisation. */
async function reponse(prompt, acces, surCarte = () => "non") {
  const requestId = `r${++n}`;
  const vues = new Set();
  codex.envoyer(requestId, { prompt, acces, agent: null, sessionId: null, conversation: "essai" }, PROJET);
  const debut = Date.now();
  for (;;) {
    const liste = evenements.get(requestId) ?? [];
    for (const e of liste)
      if (e.type === "autorisation" && !vues.has(e.id)) {
        vues.add(e.id);
        assert.equal(codex.autoriser(requestId, e.id, surCarte(e)), true);
      }
    const fin = liste.find((e) => e.type === "fin");
    if (fin) return { liste, fin, cartes: liste.filter((e) => e.type === "autorisation"), outils: liste.filter((e) => e.type === "etape-fin") };
    if (Date.now() - debut > 90_000) throw new Error(`délai dépassé : ${JSON.stringify(liste).slice(0, 800)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

try {
  /* 1. Accès « Projet », outil libre : pas de carte, l'outil tourne. */
  let r = await reponse("OUTIL_MCP essai lire_truc", "projet");
  assert.equal(r.fin.ok, true, r.fin.erreur);
  assert.equal(r.cartes.length, 0, "un outil libre ne demande rien");
  assert.equal(r.outils[0]?.ok, true);
  assert.match(r.fin.texte, /FAIT-lire_truc/);
  ok("accès Projet : un outil libre de l'app tourne sans carte");

  /* 2. Accès « Projet », autre outil : une carte, acceptée. */
  r = await reponse("OUTIL_MCP essai ecrire_truc", "projet", () => "oui");
  assert.equal(r.cartes.length, 1);
  assert.equal(r.cartes[0].outil, "mcp__essai__ecrire_truc");
  assert.deepEqual(r.cartes[0].entree, { q: "essai" });
  assert.equal(r.cartes[0].description, "Écrit un truc.");
  assert.deepEqual(r.liste.find((e) => e.type === "autorisation-fin"), { type: "autorisation-fin", id: r.cartes[0].id, accepte: true });
  assert.equal(r.outils[0]?.ok, true);
  assert.match(r.fin.texte, /FAIT-ecrire_truc/);
  ok("accès Projet : un autre outil ouvre une carte (outil, entrée, description) ; acceptée, il tourne");

  /* 3. La même carte, refusée : l'outil ne tourne pas, l'agent le sait. */
  r = await reponse("OUTIL_MCP essai ecrire_truc", "projet", () => "non");
  assert.equal(r.cartes.length, 1);
  assert.equal(r.outils[0]?.ok, false);
  assert.doesNotMatch(r.fin.texte, /FAIT-/);
  assert.match(r.fin.texte, /rejected/);
  ok("carte refusée : l'outil ne tourne pas");

  /* 4. « Toujours » : une seule carte pour deux appels dans la session. */
  r = await reponse("OUTIL_MCP2 essai ecrire_truc", "projet", () => "toujours");
  assert.equal(r.cartes.length, 1, "« toujours » vaut pour la session");
  assert.equal(r.outils.length, 2);
  assert.ok(r.outils.every((o) => o.ok));
  ok("« toujours » : le second appel de la session passe sans carte");

  /* 5. Accès « Demander » : même un outil libre demande. */
  r = await reponse("OUTIL_MCP essai lire_truc", "demander", () => "oui");
  assert.equal(r.cartes.length, 1);
  assert.equal(r.cartes[0].outil, "mcp__essai__lire_truc");
  assert.equal(r.outils[0]?.ok, true);
  ok("accès Demander : chaque outil passe par une carte");

  /* 6. Accès complet : Codex refusait tout appel MCP (« approval policy is never ») ; maintenant tout passe. */
  r = await reponse("OUTIL_MCP essai ecrire_truc", "tout");
  assert.equal(r.fin.ok, true, r.fin.erreur);
  assert.equal(r.cartes.length, 0);
  assert.equal(r.outils[0]?.ok, true);
  assert.match(r.fin.texte, /FAIT-ecrire_truc/);
  ok("accès complet : tout outil MCP tourne, sans carte");

  console.log("\nTous les contrôles sont passés.");
} finally {
  codex.fermer?.();
  openai.fermer();
  rmSync(TMP, { recursive: true, force: true });
}
process.exit(0);
