/* eslint-disable @typescript-eslint/no-require-imports -- Fournisseur de test CommonJS. */
const { createServer } = require("node:http");
const { randomUUID } = require("node:crypto");

/** Fournisseur Anthropic scripté : recherche puis exécution, jamais d'IA distante. */
exports.demarrerFauxAnthropic = async function demarrerFauxAnthropic() {
  const requetes = [];
  const text = (v) => typeof v === "string" ? v : (v ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const usage = { input_tokens: 1, output_tokens: 1 };
  const respond = (body) => {
    requetes.push(body);
    const messages = body.messages ?? [];
    let debut = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && text(messages[i].content).includes("COMPOSIO_RUNTIME")) { debut = i; break; }
    }
    if (debut < 0) return [{ type: "text", text: "ALLOW" }];
    const blocs = messages.slice(debut + 1).flatMap((m) => Array.isArray(m.content) ? m.content : []);
    const resultats = blocs.filter((b) => b.type === "tool_result");
    if (resultats.some((b) => b.is_error)) return [{ type: "text", text: "REFUS_SIMULE" }];
    if (blocs.some((b) => b.type === "tool_use" && b.name === "mcp__klyra__composio_executer") && resultats.length) {
      return [{ type: "text", text: "FIN_SIMULEE" }];
    }
    const cherche = blocs.some((b) => b.type === "tool_use" && b.name === "mcp__klyra__composio_rechercher");
    const nom = cherche ? "mcp__klyra__composio_executer" : "mcp__klyra__composio_rechercher";
    const id = `toolu_${randomUUID().slice(0, 12)}`;
    if (!(body.tools ?? []).some((t) => t.name === nom)) {
      if ((body.tools ?? []).some((t) => t.name === "ToolSearch")) {
        return [{ type: "tool_use", id, name: "ToolSearch", input: { query: `select:${nom}`, max_results: 1 } }];
      }
      return [{ type: "text", text: `OUTIL_ABSENT_${nom}` }];
    }
    return [{ type: "tool_use", id, name: nom, input: cherche
      ? { outil: "GMAIL_RUNTIME_TEST", arguments: { message: "Donnée synthétique" } }
      : { service: "gmail", recherche: "outil de test simulé" } }];
  };
  const server = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 4_000_000) return res.writeHead(413).end(); }
      if (!req.url.startsWith("/v1/messages")) return res.writeHead(404).end();
      if (req.url.includes("count_tokens")) return res.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":10}');
      const body = JSON.parse(raw);
      const blocs = respond(body);
      const stop = blocs.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
      if (!body.stream) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: "simule", content: blocs, stop_reason: stop, usage,
      }));
      const events = [{ type: "message_start", message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: "simule", content: [], stop_reason: null, stop_sequence: null, usage } }];
      blocs.forEach((b, index) => {
        events.push({ type: "content_block_start", index, content_block: b.type === "text" ? { type: "text", text: "" } : { type: "tool_use", id: b.id, name: b.name, input: {} } });
        events.push({ type: "content_block_delta", index, delta: b.type === "text" ? { type: "text_delta", text: b.text } : { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
        events.push({ type: "content_block_stop", index });
      });
      events.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
      events.push({ type: "message_stop" });
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    } catch { res.writeHead(500).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requetes, fermer: () => server.close() };
};
