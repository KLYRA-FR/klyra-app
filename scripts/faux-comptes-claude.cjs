/* Faux CLI d'authentification : exclusivement des comptes fictifs, dans un dossier temporaire. */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("2.1.318 (Claude Code fictif)");
} else {
  const dossier = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR;
  const fichier = path.join(dossier, "connexion-test.json");
  if (args[1] === "login") {
    if (process.env.KLYRA_FAUX_ECHEC === "1") {
      console.log("URL autorisation fictive, ne doit pas quitter main");
      process.exit(1);
    }
    fs.writeFileSync(fichier, JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: process.env.KLYRA_FAUX_EMAIL, orgName: "Organisation fictive", subscriptionType: "max" }));
  } else if (args[1] === "logout") {
    fs.rmSync(fichier, { force: true });
  } else if (args[1] === "status") {
    console.log(fs.existsSync(fichier) ? fs.readFileSync(fichier, "utf8") : JSON.stringify({ loggedIn: false }));
  }
}
