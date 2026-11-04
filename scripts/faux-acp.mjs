#!/usr/bin/env node
/**
 * Un faux Grok Build pour les tests : un agent ACP (`grok agent stdio`) qui suit ce que dit la
 * documentation embarquée de Grok Build 1.0.70 (« Agent Mode ») : `initialize`, `session/new`
 * (`_meta.rules`, `_meta.yoloMode`, `modes`, `configOptions`), `session/load`, `session/set_mode`,
 * `session/set_config_option`, `session/prompt` (mises à jour `session/update`), `session/cancel`,
 * `session/request_permission`, et `_x.ai/billing` (crédits du mois, forme de Grok Build 0.1.220).
 * Aucun réseau, aucun compte.
 * Le message décide de la réponse : TEXTE, OUTIL, MCP, AUTORISATION, LENT (attend l'arrêt).
 * FAUX_ACP_JOURNAL=<fichier> : chaque requête reçue y est écrite (une ligne JSON).
 * Lancé comme `grok` : `faux-acp.mjs agent stdio` ; `--version`, `login --device-auth` et `logout` répondent aussi.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const journal = (m) => process.env.FAUX_ACP_JOURNAL && appendFileSync(process.env.FAUX_ACP_JOURNAL, `${JSON.stringify(m)}\n`);
const grokHome = process.env.GROK_HOME || path.join(process.env.HOME || os.homedir(), ".grok");

if (process.argv.includes("--version")) {
  console.log("grok 9.9.9 (faux)");
  process.exit(0);
}
/* `grok login --device-auth` : un lien et un code, puis la connexion validée (auth.json écrit). */
if (process.argv[2] === "login") {
  console.log("To sign in, open https://auth.x.ai/device and enter code: WXYZ-1234");
  setTimeout(() => {
    mkdirSync(grokHome, { recursive: true });
    writeFileSync(path.join(grokHome, "auth.json"), JSON.stringify({ tokens: { access_token: "jeton-secret" }, user: { email: "essai@exemple.fr" } }), { mode: 0o600 });
    process.exit(0);
  }, 300);
} else if (process.argv[2] === "logout") {
  rmSync(path.join(grokHome, "auth.json"), { force: true });
  process.exit(0);
}
const ecrire = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const update = (sessionId, u) => ecrire({ method: "session/update", params: { sessionId, update: u } });
const texte = (sessionId, t) => update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });

const MODES = { currentModeId: "default", availableModes: [{ id: "default", name: "Ask" }, { id: "acceptEdits", name: "Accept edits" }, { id: "plan", name: "Plan" }, { id: "bypassPermissions", name: "Always-approve" }] };
const options = (modele, effort) => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: modele, options: [{ value: "grok-4.5", name: "Grok 4.5" }, { value: "grok-4.6", name: "Grok 4.6" }] },
  { id: "reasoning_effort", name: "Effort", category: "thought_level", type: "select", currentValue: effort, options: ["low", "medium", "high"].map((v) => ({ value: v, name: v })) },
];
const sessions = new Map();
const attentes = new Map();
let suivant = 1000;

function demander(method, params) {
  const id = ++suivant;
  ecrire({ id, method, params });
  return new Promise((resolve) => attentes.set(id, resolve));
}

async function prompt(id, { sessionId, prompt }) {
  const s = sessions.get(sessionId);
  if (!s) return ecrire({ id, error: { code: -32602, message: "Session inconnue." } });
  const demande = prompt.map((b) => b.text ?? "").join("\n");
  s.vus.push(demande);
  const fin = (stopReason) => ecrire({ id, result: { stopReason } });
  if (demande.includes("OUTIL")) {
    update(sessionId, { sessionUpdate: "tool_call", toolCallId: "t1", title: "ls -la", kind: "execute", status: "pending", rawInput: { command: "ls -la" } });
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: { type: "text", text: "fichier.txt" } }] });
    texte(sessionId, "J’ai listé ");
    texte(sessionId, "le dossier.");
    return fin("end_turn");
  }
  if (demande.includes("MCP")) {
    update(sessionId, { sessionUpdate: "tool_call", toolCallId: "t2", title: "klyra__ouvrir_fil", kind: "other", status: "in_progress", rawInput: { titre: "Essai" } });
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "completed", rawOutput: "fil ouvert" });
    texte(sessionId, "Fil ouvert.");
    return fin("end_turn");
  }
  if (demande.includes("AUTORISATION")) {
    const reponse = await demander("session/request_permission", {
      sessionId,
      toolCall: { toolCallId: "t3", title: "Créer essai.txt", kind: "edit", rawInput: { path: "/tmp/essai.txt" }, locations: [{ path: "/tmp/essai.txt" }] },
      options: [
        { optionId: "oui-une-fois", name: "Allow", kind: "allow_once" },
        { optionId: "oui-toujours", name: "Always allow", kind: "allow_always" },
        { optionId: "non", name: "Reject", kind: "reject_once" },
      ],
    });
    texte(sessionId, `Réponse : ${reponse.outcome?.optionId ?? reponse.outcome?.outcome}`);
    return fin("end_turn");
  }
  if (demande.includes("LENT")) {
    texte(sessionId, "Je commence…");
    s.annuler = () => fin("cancelled");
    return;
  }
  texte(sessionId, "Bonjour ");
  texte(sessionId, "de Grok");
  update(sessionId, { sessionUpdate: "usage_update", used: 1234, size: 200000 });
  return fin("end_turn");
}

let tampon = "";
if (process.argv[2] === "agent") process.stdin.on("data", (d) => {
  tampon += d.toString();
  let fin;
  while ((fin = tampon.indexOf("\n")) >= 0) {
    const ligne = tampon.slice(0, fin).trim();
    tampon = tampon.slice(fin + 1);
    if (!ligne) continue;
    const m = JSON.parse(ligne);
    journal(m);
    if (m.id !== undefined && !m.method) {
      attentes.get(m.id)?.(m.result ?? {});
      attentes.delete(m.id);
      continue;
    }
    const { id, method, params = {} } = m;
    switch (method) {
      case "initialize":
        journal({ env: { XAI_API_KEY: process.env.XAI_API_KEY ?? null, GROK_CLAUDE_SKILLS_ENABLED: process.env.GROK_CLAUDE_SKILLS_ENABLED ?? null, GROK_DISABLE_AUTOUPDATER: process.env.GROK_DISABLE_AUTOUPDATER ?? null } });
        ecrire({ id, result: { protocolVersion: 1, agentInfo: { name: "grok", version: "9.9.9" }, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } }, authMethods: [] } });
        break;
      case "session/new": {
        const sessionId = randomUUID();
        sessions.set(sessionId, { regles: params._meta?.rules ?? null, yolo: params._meta?.yoloMode === true, mcp: params.mcpServers, cwd: params.cwd, vus: [] });
        ecrire({ id, result: { sessionId, modes: { ...MODES, currentModeId: params._meta?.yoloMode ? "bypassPermissions" : "default" }, configOptions: options("grok-4.5", "medium") } });
        break;
      }
      case "session/load":
        if (!sessions.has(params.sessionId)) ecrire({ id, error: { code: -32002, message: "Session introuvable." } });
        else {
          sessions.get(params.sessionId).mcp = params.mcpServers;
          ecrire({ id, result: { modes: MODES, configOptions: options("grok-4.5", "medium") } });
        }
        break;
      case "session/set_mode":
        ecrire({ id, result: {} });
        break;
      case "session/set_config_option":
        ecrire({ id, result: { configOptions: options(params.configId === "model" ? params.value?.value : "grok-4.5", params.configId === "reasoning_effort" ? params.value?.value : "medium") } });
        break;
      case "session/prompt":
        void prompt(id, params);
        break;
      case "session/cancel":
        sessions.get(params.sessionId)?.annuler?.();
        break;
      /* La commande `/usage` de Grok Build (forme de la 0.1.220) : les crédits du mois, seulement avec le compte. */
      case "_x.ai/billing":
        if (!existsSync(path.join(grokHome, "auth.json"))) ecrire({ id, error: { code: -32000, message: "Authentication required", data: "Authentication required to fetch billing data" } });
        else
          ecrire({
            id,
            result: {
              billingCycle: { billingPeriodStart: "2026-11-01T00:00:00Z", billingPeriodEnd: "2026-12-01T00:00:00Z" },
              monthlyLimit: { val: 10000 },
              onDemandCap: { val: 0 },
              on_demand_enabled: false,
              disabledByConfig: false,
              usage: { includedUsed: { val: 2500 }, onDemandUsed: { val: 0 }, totalUsed: { val: 2500 } },
            },
          });
        break;
      default:
        if (id !== undefined) ecrire({ id, error: { code: -32601, message: `Méthode inconnue : ${method}` } });
    }
  }
});
