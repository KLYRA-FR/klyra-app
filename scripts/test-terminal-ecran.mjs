/**
 * Le terminal interactif dans l'onglet « Terminal » du panneau, de bout en bout : un vrai serveur KLYRA local
 * (dossier jetable, dans ce processus pour jouer l'agent par son serveur MCP), l'app sur un profil temporaire,
 * reliée par le lien d'invitation. L'agent du serveur ouvre un terminal qui attend une saisie (comme une
 * connexion OAuth qui demande l'URL de retour) : l'onglet Terminal s'ouvre de lui-même et montre la session en
 * direct, la personne tape dans le terminal, l'agent lit la suite ; puis fermeture.
 * Prérequis : `pnpm build && pnpm build:electron`. Linux : `xvfb-run -a pnpm test:terminal-ecran -- --no-sandbox`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { creerAgents } from "../serveur/agents.mjs";
import { creerIa } from "../serveur/ia.mjs";
import { creerCode, creerJournal, ecouter } from "../serveur/klyra-serveur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "klyra-terminal-ecran-"));
const donnees = path.join(temp, "donnees");
const home = path.join(temp, "home-serveur");
const { echecs, verifier } = verificateur();

async function mcp(config, methode, params = {}) {
  const { url, headers } = JSON.parse(config).mcpServers.klyra;
  const r = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: methode, params }) });
  const result = (await r.json()).result;
  return { texte: result.content.map((c) => c.text).join(""), erreur: result.isError === true };
}

const journal = creerJournal();
const ia = creerIa({ donnees, version: "1" });
await ia.demarrer();
const agents = creerAgents({ home, donnees, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, ia });
const ecoute = await ecouter({ nom: "Klyra-VPS", dossier: donnees, port: 0, hote: "127.0.0.1", journal, agents, ia });
const adresse = `http://127.0.0.1:${ecoute.port}`;
const hote = new URL(adresse).host;

let app;
try {
  const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(creerCode(donnees))}`;
  app = await lancerApp({ env: { HOME: path.join(temp, "home"), KLYRA_USER_DATA: path.join(temp, "profil") }, port: 9400 + Math.floor(Math.random() * 400) });

  // Relier l'app au serveur, puis passer dessus (comme test-selecteur-serveur.mjs).
  await app.aller("/serveurs");
  verifier(await app.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`), "le champ du lien est ouvert");
  await app.saisir('input[aria-label="Lien d’invitation"]', lien);
  await app.cliquer("Rejoindre");
  verifier(await app.quand(`document.querySelector('main')?.innerText.includes("Klyra-VPS")`), "Klyra-VPS rejoint par le lien");
  await app.aller("/chat?id=dm-principal");
  const bouton = `document.querySelector('nav button[aria-haspopup="menu"][aria-label*="Serveur : "]')`;
  await app.ev(`${bouton}.click()`);
  await app.quand(`document.querySelector('[role="menu"][aria-label="Compte"]')`);
  await app.ev(`document.querySelector('[role="menu"][aria-label="Compte"] [aria-haspopup="menu"]').click()`);
  await app.quand(`[...document.querySelectorAll('[role="menuitemradio"]')].some((b) => b.innerText.includes("Répond"))`);
  await app.ev(`[...document.querySelectorAll('[role="menuitemradio"]')].find((x) => x.innerText.split("\\n")[0].trim() === "Klyra-VPS").click()`);
  const conversation = `dm-principal@${hote}`;
  verifier(await app.quand(`new URLSearchParams(location.search).get("id") === ${JSON.stringify(conversation)}`), "la conversation de l’assistant sur Klyra-VPS est affichée");
  await app.touche("Escape", "Escape", 27);
  verifier(await app.quand(`[...document.querySelectorAll('[role="tab"]')].some((t) => t.innerText.trim() === "Terminal")`), "le panneau de la conversation a un onglet Terminal");
  await app.ev(`[...document.querySelectorAll('[role="tab"]')].find((t) => t.innerText.trim() === "Terminal").click()`);
  verifier(await app.quand(`document.body.innerText.includes("Aucun terminal dans cette conversation")`), "sans terminal : l’état vide l’explique");
  await app.ev(`[...document.querySelectorAll('[role="tab"]')].find((t) => t.innerText.trim() === "Réglages").click()`);

  // L'agent du serveur ouvre un terminal qui attend une saisie.
  const config = ia.configMcp({ agent: "principal", conversation });
  const ouvert = await mcp(config, "tools/call", { name: "terminal_ouvrir", arguments: { commande: "read -p 'Colle l’URL de retour : ' url; echo \"Retour reçu : $url\"; read -p 'Entrée pour finir ' f", titre: "Connexion de test" } });
  verifier(!ouvert.erreur && /Colle l’URL de retour/.test(ouvert.texte), "l’agent ouvre un terminal qui attend une saisie", ouvert.texte);
  const id = /term-[0-9a-f]{12}/.exec(ouvert.texte)?.[0];

  // L'onglet Terminal s'ouvre de lui-même et montre la session en direct.
  verifier(await app.quand(`[...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some((t) => t.innerText.trim() === "Terminal")`), "l’onglet Terminal s’ouvre de lui-même");
  verifier(await app.quand(`document.querySelector('[data-terminal=${JSON.stringify(id)}] .xterm-rows')?.innerText.includes("Colle l’URL de retour")`), "la personne voit la session de l’agent en direct");
  verifier(await app.quand(`document.body.innerText.includes("Connexion de test") && document.body.innerText.includes("En cours")`), "le titre et l’état du terminal sont affichés");

  // La personne tape dans le terminal.
  await app.ev(`document.querySelector('[data-terminal=${JSON.stringify(id)}] textarea').focus()`);
  await app.send("Input.insertText", { text: "https://exemple.test/retour?code=xyz" });
  await app.touche("Enter", "Enter", 13);
  // Le terminal suit la largeur du panneau : une longue ligne y passe à la ligne, on lit les rangées bout à bout.
  verifier(await app.quand(`document.querySelector('[data-terminal=${JSON.stringify(id)}] .xterm-rows')?.innerText.replace(/\\n/g, "").includes("Retour reçu : https://exemple.test/retour?code=xyz")`), "ce que la personne tape arrive au terminal et s’affiche");
  const lu = await mcp(config, "tools/call", { name: "terminal_lire", arguments: { id, attendre: 2 } });
  verifier(/Retour reçu : https:\/\/exemple\.test\/retour\?code=xyz/.test(lu.texte), "l’agent lit ce que la personne a tapé", lu.texte);

  // L'agent finit la commande ; l'écran le dit ; la personne ferme le terminal.
  await mcp(config, "tools/call", { name: "terminal_envoyer", arguments: { id, touche: "entree" } });
  verifier(await app.quand(`document.body.innerText.includes("Terminé")`), "la fin de la commande est affichée");
  await app.ev(`document.querySelector('button[aria-label="Fermer ce terminal"]').click()`);
  verifier(await app.quand(`document.body.innerText.includes("Aucun terminal dans cette conversation")`), "le terminal fermé disparaît du panneau");
  verifier(agents.terminaux.lister(conversation).length === 0, "et du serveur");
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
console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTERMINAL (ÉCRAN) : TOUT PASSE");
process.exit(echecs.length ? 1 : 0);
