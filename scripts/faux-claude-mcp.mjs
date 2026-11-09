#!/usr/bin/env node
// Un faux `claude` pour les tests de la veille des MCP, qui répond comme Claude Code 2.1.319 (sorties relevées
// le 09/11/2026 face à scripts/faux-mcp-oauth.mjs) à `mcp list` et `mcp login <nom> --no-browser`.
// L'état vient de `$CLAUDE_CONFIG_DIR/faux-mcp.json` : { "<nom>": "connecte" | "auth" | "echec" | "stdio" }.
// Le login écrit le lien, attend l'adresse de retour sur l'entrée (un vrai terminal), vérifie qu'elle porte le
// code attendu, puis passe le serveur en « connecte ». `$CLAUDE_CONFIG_DIR/recu.txt` garde ce que le login a lu,
// pour que le test vérifie que l'adresse est arrivée entière.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const dossier = process.env.CLAUDE_CONFIG_DIR ?? "";
const fichier = path.join(dossier, "faux-mcp.json");
const lire = () => JSON.parse(readFileSync(fichier, "utf8"));
const [cmd, sous, nom] = process.argv.slice(2);

if (cmd !== "mcp") process.exit(2);
if (sous === "list") {
  const etat = lire();
  console.log("Checking MCP server health…\n");
  for (const [n, e] of Object.entries(etat)) {
    if (e === "stdio") console.log(`${n}: npx outil --cle=NE_PAS_GARDER - ✔ Connected`);
    else if (e === "connecte") console.log(`${n}: https://mcp.exemple.test/mcp?token=NE_PAS_GARDER (HTTP) - ✔ Connected`);
    else if (e === "auth") console.log(`${n}: https://mcp.exemple.test/mcp (HTTP) - ! Needs authentication`);
    else console.log(`${n}: https://mcp.exemple.test/mcp (HTTP) - ✗ Failed to connect`);
  }
  process.exit(0);
}
if (sous === "login") {
  const etat = lire();
  if (!(nom in etat)) {
    console.log(`No MCP server named "${nom}". Run \`claude mcp add\` to add one.`);
    process.exit(1);
  }
  if (!process.stdin.isTTY) {
    console.error("Error: stdin isn't a terminal");
    process.exit(1);
  }
  process.stdout.write(`Starting authentication for "${nom}"…\r\nVisit this URL to authorize:\r\n  https://auth.exemple.test/authorize?client_id=abc&state=etat-123&redirect_uri=http%3A%2F%2Flocalhost%3A52768%2Fcallback\r\n\r\nWaiting for authorization… (^C to cancel)\r\nOr paste the redirect URL here: `);
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (ligne) => {
    writeFileSync(path.join(dossier, "recu.txt"), ligne.trim());
    // L'écho du terminal la répète déjà : on la répète une fois de plus, comme une commande bavarde.
    process.stdout.write(`Reçu : ${ligne.trim()}\r\n`);
    if (!/^http:\/\/localhost:52768\/callback\?code=CODE-UNIQUE-42&state=etat-123$/.test(ligne.trim())) {
      process.stdout.write("Error: Invalid redirect URL\r\n");
      process.exit(1);
    }
    etat[nom] = "connecte";
    writeFileSync(fichier, JSON.stringify(etat));
    process.stdout.write(`\r\nAuthenticated with "${nom}". Its tools are now available in Claude Code.\r\n`);
    process.exit(0);
  });
}
