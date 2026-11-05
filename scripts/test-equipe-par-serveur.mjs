/**
 * Chaque serveur a sa propre équipe, de bout en bout : un vrai serveur KLYRA local, l'app sur un profil
 * temporaire. Au premier passage, le VPS reçoit une copie des agents actifs du PC ; ensuite, ce qu'on
 * crée ici ou là-bas n'existe que là, et changer une fiche du PC n'écrase plus celle du VPS.
 * Prérequis : `pnpm build && pnpm build:electron`. Linux : `xvfb-run -a node scripts/test-equipe-par-serveur.mjs --no-sandbox`.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const RACINE = path.resolve(import.meta.dirname, "..");
const SERVEUR = path.join(RACINE, "serveur", "klyra-serveur.mjs");
const temp = mkdtempSync(path.join(os.tmpdir(), "klyra-equipe-"));
const donnees = path.join(temp, "donnees");
const home = path.join(temp, "home-vps");
const profil = path.join(temp, "profil");
mkdirSync(path.join(profil, "equipe"), { recursive: true });
mkdirSync(home, { recursive: true });
const fiche = (id, nom, texte) => `---\nname: ${id}\ndisplayName: ${nom}\ndescription: ${nom}\n---\n${texte}\n`;
writeFileSync(path.join(profil, "equipe", "lou.md"), fiche("lou", "Lou", "Consignes du PC."));
writeFileSync(path.join(profil, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Cicco", teinte: null }, agents: { lou: { actif: true, ajouteLe: 1, origine: { type: "local" }, empreinte: null } } }));

const port = 20000 + Math.floor(Math.random() * 20000);
const adresse = `http://127.0.0.1:${port}`;
const envServeur = { ...process.env, HOME: home, KLYRA_SERVEUR_DONNEES: donnees, KLYRA_SERVEUR_PORT: String(port), KLYRA_SERVEUR_HOTE: "127.0.0.1", KLYRA_SERVEUR_NOM: "Klyra-VPS" };
const { echecs, verifier } = verificateur();
const serveur = spawn(process.execPath, [SERVEUR], { env: envServeur, stdio: "ignore" });
let app;
try {
  for (let i = 0; i < 40 && !(await fetch(`${adresse}/`).then(() => true, () => false)); i++) await attendre(250);
  const code = execFileSync(process.execPath, [SERVEUR, "appairer"], { env: envServeur }).toString().trim();
  const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(code)}`;
  app = await lancerApp({ env: { HOME: path.join(temp, "home"), KLYRA_USER_DATA: profil }, port: 9400 + Math.floor(Math.random() * 400) });

  const vps = (methode, corps = {}) => app.ev(`window.klyra.agents.vps(${JSON.stringify(adresse)}, ${JSON.stringify(methode)}, ${JSON.stringify(corps)})`);
  const page = () => app.ev("document.body.innerText");
  const surServeur = (lieu) =>
    app.ev(`(() => {
      if (${JSON.stringify(lieu)}) localStorage.setItem("klyra:lieu-actif", ${JSON.stringify(lieu)}); else localStorage.removeItem("klyra:lieu-actif");
      window.dispatchEvent(new Event("klyra:lieu-actif"));
    })()`);

  // On rejoint le serveur par l'écran Serveurs.
  await app.aller("/serveurs");
  await app.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`);
  await app.saisir('input[aria-label="Lien d’invitation"]', lien);
  await app.cliquer("Rejoindre");
  await app.quand(`document.querySelector('main')?.innerText.includes("Klyra-VPS")`);
  verifier((await page()).includes("Klyra-VPS"), "le VPS est rejoint");

  await app.aller("/equipe");
  verifier(await app.quand(`document.body.innerText.includes("Lou")`), "Ce PC : Lou est dans Mes agents");

  await surServeur(adresse);
  verifier(await app.quand(`document.body.innerText.includes("Lou")`, 20000), "VPS : la première fois, il reçoit une copie de Lou");
  const claudeVps = (id) => path.join(home, ".claude", "agents", `${id}.md`);
  verifier(existsSync(claudeVps("lou")), "VPS : la fiche de Lou est chargée par Claude Code");
  const mes = await vps("mes");
  verifier(mes.ok && mes.data.assistant.nom === "Cicco", "VPS : l'assistant garde son nom dans la copie");

  // Créé sur le VPS : n'existe que là.
  const cree = await vps("creer", { id: "iris", contenu: fiche("iris", "Iris", "Maquettes du VPS.") });
  verifier(cree.ok, "VPS : on y crée Iris");
  await app.aller("/equipe");
  verifier(await app.quand(`document.body.innerText.includes("Iris")`, 40000), "VPS : Iris est dans Mes agents");
  await surServeur(null);
  verifier(await app.quand(`document.body.innerText.includes("Lou") && !document.body.innerText.includes("Iris")`, 20000), "Ce PC : Iris n'y est pas");

  // Le PC ne réécrit plus le VPS.
  writeFileSync(path.join(profil, "equipe", "lou.md"), fiche("lou", "Lou", "Consignes changées sur le PC."));
  await attendre(800);
  await app.ev(`window.klyra.claude.stream("essai-sync", { agent: null, prompt: "x", dossier: null, sessionId: null, modele: null, effort: null, acces: "demander", lieu: ${JSON.stringify(adresse)} }).catch(() => undefined)`);
  await attendre(1500);
  verifier(readFileSync(claudeVps("lou"), "utf8").includes("Consignes du PC."), "VPS : changer la fiche du PC n'écrase plus celle du VPS");

  // Copier vers : une fiche du PC va sur le VPS, sans écraser ce qui y est.
  writeFileSync(path.join(profil, "equipe", "noe.md"), fiche("noe", "Noé", "Code."));
  const ajoute = await app.ev(`window.klyra.agents.ajouter("noe")`);
  verifier(ajoute.ok, "Ce PC : on ajoute Noé");
  await app.aller("/equipe?agent=noe");
  verifier(await app.quand(`document.body.innerText.includes("Noé")`), "Ce PC : sa fiche s'ouvre");
  /* Le bouton des options est le dernier du haut de la fiche, à côté d'« Historique ». */
  const options = `[...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => (b.getAttribute("aria-label") ?? "") === "Plus d’options")`;
  await app.ev(`${options}?.click()`);
  verifier(await app.quand(`[...document.querySelectorAll('[role="menuitem"]')].some((x) => x.innerText.includes("Copier vers Klyra-VPS"))`), "Ce PC : le menu propose de le copier vers le VPS");
  await app.ev(`[...document.querySelectorAll('[role="menuitem"]')].find((x) => x.innerText.includes("Copier vers Klyra-VPS")).click()`);
  for (let i = 0; i < 20 && !existsSync(claudeVps("noe")); i++) await attendre(250);
  verifier(existsSync(claudeVps("noe")), "VPS : Noé y est copié");
  verifier(existsSync(claudeVps("noe")) && readFileSync(claudeVps("noe"), "utf8").includes("Code."), "VPS : sa copie a ses consignes");

  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
} finally {
  await app?.fermer();
  serveur.kill();
  rmSync(temp, { recursive: true, force: true });
}
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nÉquipe par serveur : tout est bon.");
