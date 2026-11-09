/**
 * La veille des MCP des agents dans l'app, de bout en bout : un vrai serveur KLYRA local (dossier jetable), dont
 * l'assistant a un MCP en « Needs authentication » (faux `claude`, scripts/faux-claude-mcp.mjs, qui répond comme
 * Claude Code 2.1.319) ; l'app sur un profil temporaire, reliée par le lien d'invitation. La vérification fait
 * apparaître la pastille « Connexion » du rail ; la fenêtre montre le MCP, l'agent et depuis quand ; « Reconnecter »
 * donne le lien d'autorisation ; l'adresse de retour collée mène à « Connected », sans terminal. Le code de
 * l'adresse ne reste nulle part : ni à l'écran, ni dans le journal du serveur, ni dans les fichiers du profil.
 * Prérequis : `pnpm build && pnpm build:electron`. Linux : `xvfb-run -a pnpm test:mcp-sante-ecran -- --no-sandbox`.
 */
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { creerAgents } from "../serveur/agents.mjs";
import { creerIa } from "../serveur/ia.mjs";
import { creerCode, creerJournal, ecouter } from "../serveur/klyra-serveur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(path.join(os.tmpdir(), "klyra-mcp-ecran-"));
const donnees = path.join(temp, "donnees");
const home = path.join(temp, "home-serveur");
const profil = path.join(temp, "profil");
mkdirSync(home, { recursive: true });
const { echecs, verifier } = verificateur();

const claude = path.join(home, "claude");
writeFileSync(claude, `#!/bin/sh\nexec '${process.execPath}' '${path.join(racine, "scripts", "faux-claude-mcp.mjs")}' "$@"\n`);
chmodSync(claude, 0o755);
const prepare = path.join(donnees, "preparation", "principal");
mkdirSync(prepare, { recursive: true });
writeFileSync(path.join(prepare, "faux-mcp.json"), JSON.stringify({ "qonto-mcp": "auth" }));
const CODE = "CODE-UNIQUE-42";
const ADRESSE_RETOUR = `http://localhost:52768/callback?code=${CODE}&state=etat-123`;

/** Le code apparaît-il dans un fichier de ce dossier ? */
function contient(dossier, texte) {
  for (const nom of readdirSync(dossier)) {
    const p = path.join(dossier, nom);
    const s = lstatSync(p);
    if (s.isSymbolicLink()) continue;
    if (s.isDirectory()) {
      if (contient(p, texte)) return p;
    } else if (s.size < 20_000_000 && readFileSync(p).includes(texte)) return p;
  }
  return null;
}

const journal = creerJournal();
const publies = [];
const publier = (requestId, event, sessionId) => {
  publies.push(JSON.stringify(event));
  journal.publier(requestId, event, sessionId);
};
const ia = creerIa({ donnees, version: "1" });
await ia.demarrer();
const agents = creerAgents({ home, donnees, nomServeur: "Klyra-VPS", publier, spontane: journal.spontane, ia, claude, veilleMcp: false });
const ecoute = await ecouter({ nom: "Klyra-VPS", dossier: donnees, port: 0, hote: "127.0.0.1", journal, agents, ia });
const adresse = `http://127.0.0.1:${ecoute.port}`;

let app;
try {
  const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(creerCode(donnees))}`;
  app = await lancerApp({ env: { HOME: path.join(temp, "home"), KLYRA_USER_DATA: profil }, port: 9400 + Math.floor(Math.random() * 400) });

  await app.aller("/serveurs");
  verifier(await app.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`), "le champ du lien est ouvert");
  await app.saisir('input[aria-label="Lien d’invitation"]', lien);
  await app.cliquer("Rejoindre");
  verifier(await app.quand(`document.querySelector('main')?.innerText.includes("Klyra-VPS")`), "Klyra-VPS rejoint par le lien");
  await app.aller("/chat?id=dm-principal");
  verifier(await app.quand(`!document.querySelector('nav button[aria-label*="connexion"]')`), "sans défaut connu : pas de pastille");

  // La vérification (celle du lancement et de chaque heure, ou « Vérifier maintenant ») trouve le MCP en défaut.
  await app.ev(`window.klyra.santeMcp.sante(true)`);
  const pastille = `document.querySelector('nav button[aria-label="Une connexion d’agent à reprendre : qonto-mcp"]')`;
  verifier(await app.quand(pastille), "la pastille « Connexion » apparaît dans le rail");
  const alertes = JSON.parse(readFileSync(path.join(profil, "mcp-alertes.json"), "utf8"));
  verifier(alertes.length === 1 && alertes[0].startsWith(`${adresse}|principal|qonto-mcp|authentification|`), "l’alerte est notée une fois", JSON.stringify(alertes));
  await app.ev(`window.klyra.santeMcp.sante(true)`);
  verifier(JSON.parse(readFileSync(path.join(profil, "mcp-alertes.json"), "utf8")).length === 1, "une deuxième vérification ne l’ajoute pas");

  await app.ev(`${pastille}.click()`);
  verifier(await app.quand(`document.querySelector('[role="dialog"]')?.innerText.includes("Connexions des agents")`), "la fenêtre des connexions s’ouvre");
  const fenetre = `document.querySelector('[role="dialog"]')`;
  verifier(await app.quand(`${fenetre}.innerText.includes("qonto-mcp") && ${fenetre}.innerText.includes("Klyra-VPS") && /Connexion expirée depuis/.test(${fenetre}.innerText)`), "le MCP, la machine et depuis quand");

  await app.cliquer("Reconnecter", fenetre);
  verifier(await app.quand(`[...${fenetre}.querySelectorAll('a')].some((a) => a.innerText.includes("Ouvrir la page de connexion") && a.href.startsWith("https://auth.exemple.test/authorize?"))`), "le lien d’autorisation est affiché");
  verifier(await app.quand(`${fenetre}.querySelector('input[id^="retour-"]')`), "le champ de l’adresse de retour est là");
  await app.saisir('[role="dialog"] input[id^="retour-"]', ADRESSE_RETOUR);
  await app.cliquer("Envoyer", fenetre);
  verifier(await app.quand(`${fenetre}.innerText.includes("Reconnecté : qonto-mcp répond de nouveau.")`), "« Reconnecter » mène à Connected");
  verifier(agents.veilleMcp.etat().entrees.find((e) => e.mcp === "qonto-mcp")?.etat === "connecte", "le serveur le voit Connected");
  verifier(await app.quand(`!${pastille}`), "la pastille disparaît");
  verifier(!(await app.ev(`document.body.innerText.includes(${JSON.stringify(CODE)}) || [...document.querySelectorAll('input')].some((i) => i.value.includes(${JSON.stringify(CODE)}))`)), "le code n’est plus à l’écran");
  verifier(!publies.some((p) => p.includes(CODE)), "ni dans le journal du serveur");
  await app.touche("Escape", "Escape", 27);
  await attendre(300);
  const fuite = contient(profil, CODE);
  verifier(!fuite, `ni dans les fichiers du profil${fuite ? ` (${fuite})` : ""}`);
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
} catch (erreur) {
  verifier(false, String(erreur));
} finally {
  await app?.fermer().catch(() => undefined);
  agents.fermerTout();
  await ecoute.fermer();
  ia.fermer();
  await attendre(200);
  rmSync(temp, { recursive: true, force: true });
}
console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nVEILLE DES MCP (ÉCRAN) : TOUT PASSE");
process.exit(echecs.length ? 1 : 0);
