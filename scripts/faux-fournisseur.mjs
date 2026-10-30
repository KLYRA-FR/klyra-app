/**
 * Un faux fournisseur Anthropic local (`ANTHROPIC_BASE_URL`) pour faire tourner le vrai Claude Code
 * sans compte ni dépense. Réponses scriptées d'après le dernier ordre de la personne :
 * - « appelle <agent> » : l'assistant appelle l'outil Agent avec ce type de sous-agent ;
 * - « fil <agent> » : il ouvre un fil (outil `ouvrir_fil` de l'app) pour cet agent ;
 * - « liste <agent> » : il liste les fils ouverts de cet agent (outil `lister_fils`) ;
 * - après un résultat d'outil : « fin OK|REFUS … » ; un sous-agent répond « bonjour de <nom> ».
 * Les fiches d'essai portent `SOUS-AGENT-TEST-<nom>` dans leur consigne pour être reconnues.
 * Chaque requête est notée : sous-agent, agents listés au modèle, résultats d'outils.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const texteDe = (contenu) => (typeof contenu === "string" ? contenu : (contenu ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));

export async function demarrerFournisseur(agentsSurveilles) {
  const requetes = [];
  /** Les recherches d'outils lancées : leur résultat appelle ensuite l'outil trouvé. */
  const recherches = new Set();
  function reponse(corps) {
    const brut = JSON.stringify(corps);
    const systeme = JSON.stringify(corps.system ?? "");
    const outilAgent = (corps.tools ?? []).find((t) => t.name === "Agent" || t.name === "Task");
    // Un sous-agent n'a que sa fiche pour consigne ; un agent lancé par l'app (`--agent`) a aussi celles de l'app.
    const sousAgent = systeme.includes("dans cette app") ? null : (systeme.match(/SOUS-AGENT-TEST-([a-z0-9-]+)/)?.[1] ?? null);
    // Claude peut ajouter un message système après le résultat d'outil.
    // Ne pas reprendre un résultat d'un tour précédent : garder le dernier message utilisateur.
    const dernier = (corps.messages ?? []).findLast((m) => m.role === "user");
    const resultats = Array.isArray(dernier?.content) ? dernier.content.filter((c) => c.type === "tool_result") : [];
    const consigne = [...(corps.messages ?? [])].reverse().find((m) => m.role === "user" && /^(appelle|fil|liste) /m.test(texteDe(m.content)));
    const ordre = consigne ? texteDe(consigne.content).match(/^(appelle|fil|liste) ([a-z0-9-]+)/m) : null;
    requetes.push({
      sousAgent,
      principal: !!outilAgent && !sousAgent,
      systeme,
      outils: (corps.tools ?? []).map((t) => t.name),
      listes: agentsSurveilles.filter((n) => brut.includes(`- ${n}: `)),
      resultats: resultats.map((r) => ({ erreur: !!r.is_error, texte: JSON.stringify(r.content).slice(0, 300) })),
    });
    if (sousAgent) return [{ type: "text", text: `bonjour de ${sousAgent}` }];
    // Les outils de l'app : « fil » ouvre un fil, « liste » liste ceux de l'agent.
    const nomOutil = ordre?.[1] === "fil" ? "mcp__klyra__ouvrir_fil" : ordre?.[1] === "liste" ? "mcp__klyra__lister_fils" : null;
    const outilFil = !!nomOutil && (corps.tools ?? []).some((t) => t.name === nomOutil);
    const filDemande = () => [
      { type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name: nomOutil, input: ordre[1] === "fil" ? { agent: ordre[2], titre: "Essai", brief: "Brief d’essai." } : { agent: ordre[2] } },
    ];
    // Les outils de l'app sont chargés à la demande (ToolSearch) : une fois trouvés, on s'en sert.
    if (resultats.some((r) => recherches.has(r.tool_use_id)) && nomOutil && outilFil) return filDemande();
    if (resultats.length) {
      return [{ type: "text", text: `fin ${resultats.map((r) => (r.is_error ? "REFUS" : "OK")).join(",")} ${JSON.stringify(resultats.map((r) => r.content)).slice(0, 400)}` }];
    }
    const id = `toolu_${randomUUID().slice(0, 8)}`;
    // Au premier plan : le sous-agent répond dans le même tour, rien ne déborde sur le suivant.
    if (outilAgent && ordre?.[1] === "appelle") {
      return [{ type: "tool_use", id, name: outilAgent.name, input: { subagent_type: ordre[2], description: "Essai", prompt: "Dis bonjour.", run_in_background: false } }];
    }
    if (nomOutil && outilFil) return filDemande();
    if (nomOutil && (corps.tools ?? []).some((t) => t.name === "ToolSearch")) {
      recherches.add(id);
      return [{ type: "tool_use", id, name: "ToolSearch", input: { query: `select:${nomOutil}`, max_results: 1 } }];
    }
    return [{ type: "text", text: "ok" }];
  }
  function sse(res, blocs) {
    const ev = [{ type: "message_start", message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: "faux", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }];
    blocs.forEach((b, i) => {
      ev.push({ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : { type: "tool_use", id: b.id, name: b.name, input: {} } });
      ev.push({ type: "content_block_delta", index: i, delta: b.type === "text" ? { type: "text_delta", text: b.text } : { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
      ev.push({ type: "content_block_stop", index: i });
    });
    ev.push({ type: "message_delta", delta: { stop_reason: blocs.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
    ev.push({ type: "message_stop" });
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const e of ev) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    res.end();
  }
  const serveur = createServer((req, res) => {
    let brut = "";
    req.on("data", (d) => (brut += d));
    req.on("end", () => {
      if (!req.url.startsWith("/v1/messages")) return res.writeHead(404).end();
      if (req.url.includes("count_tokens")) return res.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":10}');
      const corps = JSON.parse(brut || "{}");
      const blocs = reponse(corps);
      if (corps.stream) return sse(res, blocs);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "faux", content: blocs, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${serveur.address().port}`, requetes, fermer: () => serveur.close() };
}

/**
 * Fait répondre l'app par Claude Code (`window.klyra.claude.stream`) et attend la fin.
 * `app` : celle de `pilote-app.mjs`, avec `window.__evts` déjà branché (cf. `suivreEvenements`).
 */
export async function demanderA(app, fournisseur, options) {
  const id = randomUUID();
  const debut = fournisseur.requetes.length;
  await app.ev(`window.klyra.claude.stream(${JSON.stringify(id)}, ${JSON.stringify({ dossier: null, sessionId: null, chatId: "dm-principal", acces: "tout", ...options })}).then(() => 0)`);
  await app.quand(`window.__evts.some((x) => x.id === ${JSON.stringify(id)} && x.e.type === "fin")`, 60000);
  const evts = await app.ev(`window.__evts.filter((x) => x.id === ${JSON.stringify(id)}).map((x) => x.e)`);
  // Les agents d'arrière-plan reviennent après la fin : on leur laisse le temps de parler au fournisseur.
  await new Promise((r) => setTimeout(r, 1500));
  return { evts, fin: evts.find((e) => e.type === "fin"), requetes: fournisseur.requetes.slice(debut) };
}

export const suivreEvenements = (app) => app.ev(`(() => { window.__evts = []; window.klyra.claude.onEvent((id, e) => window.__evts.push({ id, e })); return 0; })()`);
export const refuse = (r) => r.requetes.some((q) => q.resultats.some((x) => x.erreur));
export const sessionDe = (r) => r.evts.find((e) => e.type === "session")?.sessionId ?? null;
