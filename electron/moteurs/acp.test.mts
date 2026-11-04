import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "./types.ts";
import { lireUtilisationGrok } from "../utilisation.ts";
import { creerClientAcp, emailDeAuth, etapeAcp, lireCodeAppareil, lireOptions, mcpPourAcp, modePour, reponseAutorisationAcp, TourAcp, type TourDemande } from "./acp.ts";

const FAUX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "faux-acp.mjs");

test("serveurs MCP de l'app dans la forme d'ACP", () => {
  const config = JSON.stringify({ mcpServers: { klyra: { type: "http", url: "http://127.0.0.1:1/mcp", headers: { "X-Klyra-Agent": "hugo" } }, local: { command: "node", args: ["s.js"], env: { A: "1" } } } });
  assert.deepEqual(mcpPourAcp(config), [
    { type: "http", name: "klyra", url: "http://127.0.0.1:1/mcp", headers: [{ name: "X-Klyra-Agent", value: "hugo" }] },
    { name: "local", command: "node", args: ["s.js"], env: [{ name: "A", value: "1" }] },
  ]);
  assert.deepEqual(mcpPourAcp(null), []);
});

test("mode de la session pour chaque accès, seulement s'il existe et change", () => {
  const modes = ["default", "acceptEdits", "plan", "bypassPermissions"];
  assert.equal(modePour("tout", modes, "default"), "bypassPermissions");
  assert.equal(modePour("projet", modes, "default"), "acceptEdits");
  assert.equal(modePour("demander", modes, "default"), null);
  assert.equal(modePour("projet", [], null), null);
});

test("options de la session : modèles (groupes compris), efforts, choix courants", () => {
  const lues = lireOptions([
    { id: "model", category: "model", currentValue: "grok-4.6", options: [{ group: "xai", name: "xAI", options: [{ value: "grok-4.5", name: "Grok 4.5" }, { value: "grok-4.6" }] }] },
    { id: "reasoning_effort", category: "thought_level", currentValue: "high", options: [{ value: "low" }, { value: "high" }] },
  ]);
  assert.deepEqual(lues.modeles.map((m) => [m.id, m.nom, m.parDefaut]), [["grok-4.5", "Grok 4.5", false], ["grok-4.6", "grok-4.6", true]]);
  assert.deepEqual(lues.modeles[0].efforts, ["low", "high"]);
  assert.equal(lues.effort, "high");
  assert.deepEqual(lireOptions(undefined).modeles, []);
});

test("étapes : commande, fichier, outil MCP sous le nom que l'app connaît", () => {
  assert.deepEqual(etapeAcp({ kind: "execute", title: "ls", rawInput: { command: "ls -la" } }), { outil: "Bash", entree: { command: "ls -la" } });
  assert.equal(etapeAcp({ kind: "edit", locations: [{ path: "/p/a.ts" }] }).entree.file_path, "/p/a.ts");
  assert.deepEqual(etapeAcp({ kind: "other", title: "klyra__ouvrir_fil", rawInput: { titre: "x" } }), { outil: "mcp__klyra__ouvrir_fil", entree: { titre: "x" } });
  assert.deepEqual(etapeAcp({ kind: "other", title: "Use tool", rawInput: { name: "ordinateur__capture", arguments: { ecran: 1 } } }), { outil: "mcp__ordinateur__capture", entree: { ecran: 1 } });
});

test("un tour : texte en direct, étapes, fin avec le texte écrit après la dernière étape", () => {
  const evts: AgentEvent[] = [];
  const tour = new TourAcp("s1", (e) => evts.push(e));
  tour.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Je regarde." } });
  tour.update({ sessionUpdate: "tool_call", toolCallId: "a", kind: "read", title: "Lire", locations: [{ path: "/x" }], status: "pending" });
  tour.update({ sessionUpdate: "tool_call_update", toolCallId: "a", status: "completed", content: [{ type: "content", content: { type: "text", text: "contenu" } }] });
  tour.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "C’est fait." } });
  tour.finir({ stopReason: "end_turn" });
  assert.deepEqual(evts.map((e) => e.type), ["texte", "etape", "etape-fin", "texte", "fin"]);
  assert.equal((evts[3] as { nouveauBloc: boolean }).nouveauBloc, true);
  assert.deepEqual(evts.at(-1), { type: "fin", ok: true, texte: "C’est fait.", erreur: undefined, sessionId: "s1" });
  const arrete = new TourAcp("s2", (e) => evts.push(e));
  arrete.finir({ stopReason: "cancelled" });
  assert.equal((evts.at(-1) as { erreur?: string }).erreur, "Arrêté par toi.");
});

test("autorisation : l'option de Grok qui correspond à ta réponse", () => {
  const params = { options: [{ optionId: "a", kind: "allow_once" }, { optionId: "b", kind: "allow_always" }, { optionId: "c", kind: "reject_once" }] };
  assert.deepEqual(reponseAutorisationAcp(params, "oui"), { outcome: { outcome: "selected", optionId: "a" } });
  assert.deepEqual(reponseAutorisationAcp(params, "toujours"), { outcome: { outcome: "selected", optionId: "b" } });
  assert.deepEqual(reponseAutorisationAcp(params, "non"), { outcome: { outcome: "selected", optionId: "c" } });
  assert.deepEqual(reponseAutorisationAcp({}, "oui"), { outcome: { outcome: "cancelled" } });
});

test("compte et connexion : l'e-mail seul, jamais un jeton ; le code d'appareil", () => {
  assert.equal(emailDeAuth(JSON.stringify({ tokens: { access_token: "secret" }, user: { email: "a@b.fr" } })), "a@b.fr");
  assert.equal(emailDeAuth(JSON.stringify({ access_token: "a@b.fr-pas-une-adresse" })), null);
  assert.equal(emailDeAuth("pas du json"), null);
  assert.deepEqual(lireCodeAppareil("Open https://auth.x.ai/device and enter code: ABCD-1234\n"), { url: "https://auth.x.ai/device", code: "ABCD-1234" });
  assert.equal(lireCodeAppareil("rien ici"), null);
});

/** Le client face au faux Grok (scripts/faux-acp.mjs) : le protocole de bout en bout. */
test("le client ACP face au faux Grok : réponse, session reprise, outils, autorisation, arrêt", async () => {
  chmodSync(FAUX, 0o755);
  const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-acp-"));
  const journal = path.join(dossier, "journal.jsonl");
  const client = creerClientAcp({ trouver: () => FAUX, env: () => ({ ...process.env, FAUX_ACP_JOURNAL: journal }), cwd: () => dossier, client: { name: "klyra", title: "KLYRA", version: "1" } });
  const demande = (prompt: string, plus: Partial<TourDemande> = {}): TourDemande => ({ sessionId: null, cwd: dossier, prompt, regles: "Consigne KLYRA", mcp: mcpPourAcp(JSON.stringify({ mcpServers: { klyra: { type: "http", url: "http://127.0.0.1:9/mcp" } } })), acces: "projet", signature: "s1", ...plus });
  const repondre = (requestId: string, d: TourDemande, pendant: (e: AgentEvent) => void = () => {}) =>
    new Promise<AgentEvent[]>((resolve) => {
      const evts: AgentEvent[] = [];
      client.lancer(requestId, d, (e) => {
        evts.push(e);
        pendant(e);
        if (e.type === "fin") resolve(evts);
      });
    });
  const requetes = () => readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown> });
  try {
    const premiere = await repondre("r1", demande("TEXTE"));
    const session = (premiere.find((e) => e.type === "session") as { sessionId: string }).sessionId;
    assert.deepEqual(premiere.at(-1), { type: "fin", ok: true, texte: "Bonjour de Grok", erreur: undefined, sessionId: session });
    assert.ok(premiere.some((e) => e.type === "contexte" && e.jetons === 1234));
    assert.equal(client.version, "9.9.9");
    const nouvelle = requetes().find((m) => m.method === "session/new")!.params!;
    assert.deepEqual(nouvelle._meta, { rules: "Consigne KLYRA" });
    assert.deepEqual(nouvelle.mcpServers, [{ type: "http", name: "klyra", url: "http://127.0.0.1:9/mcp", headers: [] }]);
    assert.ok(requetes().some((m) => m.method === "session/set_mode" && m.params!.modeId === "acceptEdits"), "le mode « projet » n’est pas posé");

    /* Même session, signature changée : rechargée (pas de nouvelle), modèle et effort posés. */
    const seconde = await repondre("r2", demande("OUTIL", { sessionId: session, signature: "s2", modele: "grok-4.6", effort: "high" }));
    assert.ok(!seconde.some((e) => e.type === "session"));
    assert.deepEqual(seconde.filter((e) => e.type === "etape").map((e) => (e as { outil: string }).outil), ["Bash"]);
    assert.equal((seconde.find((e) => e.type === "etape-fin") as { apercu: string }).apercu, "fichier.txt");
    assert.equal((seconde.at(-1) as { texte: string }).texte, "J’ai listé le dossier.");
    assert.ok(requetes().some((m) => m.method === "session/load" && m.params!.sessionId === session));
    assert.ok(requetes().some((m) => m.method === "session/set_config_option" && m.params!.configId === "model" && (m.params!.value as { value: string }).value === "grok-4.6"));
    assert.ok(requetes().some((m) => m.method === "session/set_config_option" && m.params!.configId === "reasoning_effort"));

    const mcp = await repondre("r3", demande("MCP", { sessionId: session, signature: "s2" }));
    assert.equal((mcp.find((e) => e.type === "etape") as { outil: string }).outil, "mcp__klyra__ouvrir_fil");

    /* Autorisation montrée, acceptée pour la session. */
    const autorisee = await repondre("r4", demande("AUTORISATION", { sessionId: session, signature: "s2" }), (e) => {
      if (e.type === "autorisation") assert.equal(client.autoriser("r4", e.id, "toujours"), true);
    });
    assert.equal((autorisee.find((e) => e.type === "autorisation") as { outil: string }).outil, "Edit");
    assert.equal((autorisee.at(-1) as { texte: string }).texte, "Réponse : oui-toujours");

    /* Accès complet : nouvelle session en always-approve, l'autorisation est accordée d'office. */
    const toutes = await repondre("r5", demande("AUTORISATION", { acces: "tout", signature: "s3" }));
    assert.ok(!toutes.some((e) => e.type === "autorisation"));
    assert.equal((toutes.at(-1) as { texte: string }).texte, "Réponse : oui-une-fois");
    assert.ok(requetes().some((m) => m.method === "session/new" && (m.params!._meta as { yoloMode?: boolean }).yoloMode === true));

    /* Arrêt en cours de réponse. */
    const arretee = await repondre("r6", demande("LENT", { sessionId: session, signature: "s2" }), (e) => {
      if (e.type === "texte") assert.equal(client.arreter("r6"), true);
    });
    assert.deepEqual([(arretee.at(-1) as { ok: boolean }).ok, (arretee.at(-1) as { erreur: string }).erreur], [false, "Arrêté par toi."]);

    /* Une session inconnue (d'un autre moteur) : une nouvelle, sans erreur. */
    const etrangere = await repondre("r7", demande("TEXTE", { sessionId: "00000000-0000-4000-8000-000000000000", signature: "s4" }));
    assert.ok(etrangere.some((e) => e.type === "session"));
    assert.equal((etrangere.at(-1) as { ok: boolean }).ok, true);

    assert.deepEqual((await client.modeles(dossier)).map((m) => m.id), ["grok-4.5", "grok-4.6"]);

    /* Les crédits du mois de l'abonnement (`x.ai/billing`), lus comme l'anneau du rail les lit. */
    const mois = lireUtilisationGrok(await client.facturation(), null)?.mois;
    assert.deepEqual(mois, { utilise: 0.375, reinitialiseA: Date.parse("2026-12-01T00:00:00Z") });
    assert.ok(requetes().some((m) => m.method === "x.ai/billing"));
  } finally {
    client.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("une version de Grok qui veut une session pour la facturation : une session ouverte dans un dossier vide", async () => {
  chmodSync(FAUX, 0o755);
  const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-acp-"));
  const journal = path.join(dossier, "journal.jsonl");
  const client = creerClientAcp({ trouver: () => FAUX, env: () => ({ ...process.env, FAUX_ACP_FACTURATION_SESSION: "1", FAUX_ACP_JOURNAL: journal }), cwd: () => dossier, client: { name: "klyra", title: "KLYRA", version: "1" } });
  try {
    assert.equal(lireUtilisationGrok(await client.facturation(), null)?.mois?.utilise, 0.375);
    const nouvelle = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method?: string; params?: { cwd?: string; mcpServers?: unknown[] } }).find((m) => m.method === "session/new");
    assert.deepEqual(nouvelle?.params?.mcpServers, []);
    assert.ok(nouvelle?.params?.cwd?.includes("klyra-grok-facturation-"), "la session n’est pas ouverte dans un dossier vide");
  } finally {
    client.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("une version de Grok sans facturation : la lecture échoue, sans bloquer ni inventer", async () => {
  chmodSync(FAUX, 0o755);
  const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-acp-"));
  const client = creerClientAcp({ trouver: () => FAUX, env: () => ({ ...process.env, FAUX_ACP_SANS_FACTURATION: "1" }), cwd: () => dossier, client: { name: "klyra", title: "KLYRA", version: "1" } });
  try {
    await assert.rejects(client.facturation(), /sans session : Méthode inconnue : x\.ai\/billing ; avec session : Méthode inconnue/);
  } finally {
    client.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});
