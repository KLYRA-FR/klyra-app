/**
 * Un faux serveur « Responses » d'OpenAI sur 127.0.0.1, pour faire tourner le vrai Codex sans compte
 * ni dépense. Réponses scriptées d'après le dernier message de la personne :
 * - « COMMANDE » : Codex lance `touch klyra-essai.txt` en demandant l'accord (exec_command) ;
 * - « LENT » : la réponse commence et ne finit jamais (pour l'arrêter) ;
 * - « OUTIL_MCP <serveur> <outil> » : Codex appelle cet outil MCP (`OUTIL_MCP2` : deux fois de suite), puis
 *   répond « Outil : » et ce que l'outil a rendu (ou son refus) ;
 * - après le résultat d'une commande : « Commande faite » ;
 * - sinon : « Bonjour de ChatGPT ».
 * Chaque requête est gardée telle quelle dans `requetes`.
 * Une demande qui contient LIMITES reçoit les en-têtes de limites de l'abonnement (`LIMITES`).
 * `configCodex(url)` : le config.toml qui envoie Codex vers ce serveur (clé dans FAUX_CLE).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- partagé par des tests CommonJS et ESM */
const http = require("node:http");

const usage = { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 7, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 17 };

const texte = (id, mots) => [
  { type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant", id, content: [] } },
  ...mots.map((delta) => ({ type: "response.output_text.delta", output_index: 0, item_id: id, content_index: 0, delta })),
  { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", id, content: [{ type: "output_text", text: mots.join(""), annotations: [] }] } },
];
const fini = (id) => ({ type: "response.completed", response: { id, usage } });

function sse(res, evenements) {
  if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of evenements) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
}

/** Le texte du dernier message de la personne dans une requête de Codex. */
function derniereDemande(corps) {
  const dernier = [...(corps.input ?? [])].reverse().find((i) => i.type === "message" && i.role === "user");
  return (dernier?.content ?? []).map((c) => c.text ?? "").join("\n");
}

/** Les en-têtes de limites qu'OpenAI joint à une réponse de Codex (5 h à 25 %, semaine à 60 %). */
const LIMITES = {
  "x-codex-primary-used-percent": "25",
  "x-codex-primary-window-minutes": "300",
  "x-codex-primary-reset-at": "1900000000",
  "x-codex-secondary-used-percent": "60",
  "x-codex-secondary-window-minutes": "10080",
  "x-codex-secondary-reset-at": "1900500000",
};

function repondre(corps, res, n) {
  const id = `resp_${n}`;
  const demande = derniereDemande(corps);
  if (demande.includes("LIMITES")) for (const [nom, valeur] of Object.entries(LIMITES)) res.setHeader(nom, valeur);
  sse(res, [{ type: "response.created", response: { id } }]);
  const mcp = /OUTIL_MCP(2?) (\S+) (\S+)/.exec(demande);
  if (mcp) {
    // Les sorties d'outil depuis le dernier message de la personne.
    const entree = corps.input ?? [];
    let i = entree.length - 1;
    while (i >= 0 && !(entree[i].type === "message" && entree[i].role === "user")) i--;
    const sorties = entree.slice(i + 1).filter((e) => e.type === "function_call_output");
    if (sorties.length < (mcp[1] ? 2 : 1)) {
      // Codex présente les outils d'un serveur MCP sous l'espace de noms `mcp__<serveur>` (vérifié avec Codex 0.166).
      const appel = { type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, namespace: `mcp__${mcp[2]}`, name: mcp[3], arguments: JSON.stringify({ q: "essai" }) };
      sse(res, [{ type: "response.output_item.done", output_index: 0, item: appel }, fini(id)]);
      return res.end();
    }
    const sortie = sorties.at(-1).output;
    const lu = Array.isArray(sortie) ? sortie.map((c) => c.text ?? "").join(" ") : String(sortie);
    sse(res, [...texte(`msg_${id}`, ["Outil : ", lu]), fini(id)]);
    return res.end();
  }
  if (JSON.stringify(corps.input ?? []).includes("function_call_output")) {
    sse(res, [...texte(`msg_${id}`, ["Commande ", "faite"]), fini(id)]);
    return res.end();
  }
  if (demande.includes("COMMANDE")) {
    const appel = {
      type: "function_call",
      id: `fc_${id}`,
      call_id: `call_${id}`,
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "touch klyra-essai.txt", sandbox_permissions: "require_escalated", justification: "Créer le fichier d’essai" }),
    };
    sse(res, [{ type: "response.output_item.done", output_index: 0, item: appel }, fini(id)]);
    return res.end();
  }
  if (demande.includes("LENT")) return sse(res, texte(`msg_${id}`, ["Je commence…"]).slice(0, 2));
  sse(res, [...texte(`msg_${id}`, ["Bonjour ", "de ChatGPT"]), fini(id)]);
  res.end();
}

async function demarrerFauxOpenAI() {
  const requetes = [];
  const serveur = http.createServer((req, res) => {
    let corps = "";
    req.on("data", (d) => (corps += d));
    req.on("end", () => {
      if (!req.url.endsWith("/responses")) {
        res.writeHead(404);
        return res.end("{}");
      }
      const json = JSON.parse(corps);
      requetes.push(json);
      repondre(json, res, requetes.length);
    });
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${serveur.address().port}/v1`;
  return { url, requetes, derniereDemande, fermer: () => serveur.close() };
}

const configCodex = (url) => `model = "faux-modele"\nmodel_provider = "faux"\n[model_providers.faux]\nname = "Faux"\nbase_url = "${url}"\nwire_api = "responses"\nenv_key = "FAUX_CLE"\n`;

module.exports = { demarrerFauxOpenAI, configCodex };
