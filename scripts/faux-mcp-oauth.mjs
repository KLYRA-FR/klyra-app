// Un faux serveur MCP protégé par OAuth (spécification MCP, autorisation), pour les tests de la veille des MCP :
// découverte (.well-known de la ressource et du serveur d'autorisation), inscription dynamique, PKCE (S256),
// jeton, et un /mcp qui répond 401 sans jeton valable. `/authorize` renvoie tout de suite vers l'adresse de
// retour avec un code : le test joue le navigateur. `revoquer()` invalide les jetons (« jeton refusé »).
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export async function demarrerFauxMcpOAuth() {
  const clients = new Map();
  const codes = new Map();
  let jetons = new Set();
  let base = "";

  const json = (res, status, corps, entetes = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...entetes });
    res.end(JSON.stringify(corps));
  };
  const lireCorps = (req) => new Promise((ok) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => ok(d));
  });

  const serveur = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const corps = await lireCorps(req);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (url.pathname.startsWith("/.well-known/oauth-authorization-server") || url.pathname.startsWith("/.well-known/openid-configuration")) {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register" && req.method === "POST") {
      const demande = JSON.parse(corps || "{}");
      const id = `client-${randomBytes(4).toString("hex")}`;
      clients.set(id, demande.redirect_uris ?? []);
      return json(res, 201, { client_id: id, redirect_uris: demande.redirect_uris, token_endpoint_auth_method: "none" });
    }
    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      const retour = p.get("redirect_uri");
      if (!clients.has(p.get("client_id") ?? "") || !retour) return json(res, 400, { error: "invalid_request" });
      const code = randomBytes(12).toString("hex");
      codes.set(code, { defi: p.get("code_challenge"), retour });
      const vers = new URL(retour);
      vers.searchParams.set("code", code);
      if (p.get("state")) vers.searchParams.set("state", p.get("state"));
      res.writeHead(302, { location: vers.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const p = new URLSearchParams(corps);
      if (p.get("grant_type") === "refresh_token") return json(res, 400, { error: "invalid_grant" });
      const c = codes.get(p.get("code") ?? "");
      const verif = createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url");
      if (!c || c.defi !== verif) return json(res, 400, { error: "invalid_grant" });
      codes.delete(p.get("code"));
      const jeton = randomBytes(16).toString("hex");
      jetons.add(jeton);
      return json(res, 200, { access_token: jeton, token_type: "Bearer", expires_in: 3600 });
    }
    if (url.pathname === "/mcp") {
      const jeton = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!jetons.has(jeton)) {
        return json(res, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      }
      if (req.method !== "POST") return json(res, 405, { error: "methode" });
      const m = JSON.parse(corps || "{}");
      if (m.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      const resultats = {
        initialize: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "faux-oauth", version: "1.0.0" } },
        "tools/list": { tools: [] },
      };
      return json(res, 200, { jsonrpc: "2.0", id: m.id, result: resultats[m.method] ?? {} });
    }
    return json(res, 404, { error: "introuvable" });
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${serveur.address().port}`;
  return {
    url: `${base}/mcp`,
    revoquer: () => {
      jetons = new Set();
    },
    fermer: () => new Promise((ok) => serveur.close(() => ok())),
  };
}

// Lancé seul : sert jusqu'à l'arrêt et écrit son adresse.
if (import.meta.url === `file://${process.argv[1]}`) {
  const f = await demarrerFauxMcpOAuth();
  console.log(f.url);
}
