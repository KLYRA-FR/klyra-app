/* Faux CLI d'authentification : exclusivement des comptes fictifs, dans un dossier temporaire. */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const dossier = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR;
const fichier = dossier ? path.join(dossier, "connexion-test.json") : null;
const connecter = () => fs.writeFileSync(fichier, JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: process.env.KLYRA_FAUX_EMAIL, orgName: "Organisation fictive", subscriptionType: "max" }));
if (args[0] === "--version") {
  console.log("2.1.318 (Claude Code fictif)");
} else if (args[0] === "-p") {
  /* La petite requête qui fait donner ses limites : seulement pour un compte connecté, avec le compte du dossier. */
  if (!fs.existsSync(fichier)) process.exit(1);
  const email = JSON.parse(fs.readFileSync(fichier, "utf8")).email;
  const utilise = email === "second@example.test" ? 0.25 : 0.6;
  console.log(JSON.stringify({ type: "system", subtype: "init" }));
  console.log(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: utilise, resetsAt: 2_000_000_000 } }));
  console.log(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "seven_day", utilization: 0.1, resetsAt: 2_000_500_000 } }));
  console.log(JSON.stringify({ type: "result", result: "ok" }));
} else if (args[1] === "login") {
  if (process.env.KLYRA_FAUX_ECHEC === "1") {
    console.log("URL autorisation fictive, ne doit pas quitter main");
    process.exit(1);
  }
  if (process.env.KLYRA_FAUX_DEUX_TEMPS === "1") {
    /* Comme `claude auth login` sans navigateur : la page à ouvrir, puis le code collé sur l'entrée. */
    const page = process.env.KLYRA_FAUX_PAGE || "https://claude.com/cai/oauth/authorize?code=true&client_id=fictif&state=etat";
    process.stdout.write(`Opening browser to sign in…\nIf the browser didn't open, visit: ${page}\nPaste code here if prompted > `);
    let entree = "";
    process.stdin.on("data", (d) => {
      entree += d.toString();
      if (!entree.includes("\n")) return;
      if (entree.trim() === "bon-code#etat") { connecter(); process.exit(0); }
      console.log("Login failed: That code wasn't accepted.");
      process.exit(1);
    });
  } else {
    connecter();
  }
} else if (args[1] === "logout") {
  fs.rmSync(fichier, { force: true });
} else if (args[1] === "status") {
  console.log(fs.existsSync(fichier) ? fs.readFileSync(fichier, "utf8") : JSON.stringify({ loggedIn: false }));
}
