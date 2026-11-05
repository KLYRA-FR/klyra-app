/**
 * Chaque serveur a sa propre équipe, de bout en bout : un vrai serveur KLYRA local, l'app sur un profil
 * temporaire. Au premier passage, le VPS reçoit une copie des agents actifs du PC ; ensuite, ce qu'on
 * crée ici ou là-bas n'existe que là, et changer une fiche du PC n'écrase plus celle du VPS.
 * Prérequis : `pnpm build && pnpm build:electron`. Linux : `xvfb-run -a node scripts/test-equipe-serveur.mjs --no-sandbox`.
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

  // Ses réglages : les consignes et les skills d'un serveur restent à ce serveur.
  const lus = await vps("reglages");
  verifier(lus.ok && lus.data.configuration, "VPS : il a ses réglages, copiés de ce PC la première fois");
  const ecrits = await vps("reglages-ecrire", { configuration: { memoireAgents: false, consignes: "Consignes du VPS" }, configurationEcran: { ...lus.data.configuration, memoireAgents: false } });
  verifier(ecrits.ok && ecrits.data.configuration.memoireAgents === false, "VPS : on y coupe la mémoire des agents");
  const ceuxDuPc = await app.ev(`window.klyra.reglages.lire()`);
  verifier(ceuxDuPc.ok && ceuxDuPc.data.configuration.memoireAgents === true, "Ce PC : sa mémoire reste allumée");
  await app.ev(`window.klyra.claude.stream("essai-sync-2", { agent: null, prompt: "x", dossier: null, sessionId: null, modele: null, effort: null, acces: "demander", lieu: ${JSON.stringify(adresse)} }).catch(() => undefined)`);
  await attendre(1000);
  const apres = await vps("reglages");
  verifier(apres.ok && apres.data.configuration.memoireAgents === false, "VPS : l’app ne remet pas ses réglages à ceux de ce PC");
  const catalogue = await vps("skills", {});
  verifier(catalogue.ok && Array.isArray(catalogue.data.poste), "VPS : il donne ses propres skills");
  await app.aller("/reglages?section=computer-use");
  await surServeur(adresse);
  await app.quand(`document.querySelector('[role="note"]')`);

  // L'accès des agents se choisit par serveur.
  await app.aller("/reglages?section=agents&reglage=acces");
  verifier(await app.quand(`document.querySelector('[role="radiogroup"][aria-label="Accès des agents"]')`), "le choix de l’accès s’ouvre");
  const choisi = () => app.ev(`[...document.querySelectorAll('[role="radiogroup"][aria-label="Accès des agents"] [role="radio"]')].findIndex((b) => b.getAttribute("aria-checked") === "true")`);
  const surPc = await (async () => { await surServeur(null); await attendre(300); return choisi(); })();
  await surServeur(adresse);
  await attendre(300);
  const autre = surPc === 0 ? 1 : 0;
  await app.ev(`document.querySelectorAll('[role="radiogroup"][aria-label="Accès des agents"] [role="radio"]')[${autre}].click()`);
  await attendre(300);
  verifier((await choisi()) === autre, "VPS : on change son accès");
  await surServeur(null);
  await attendre(300);
  verifier((await choisi()) === surPc, "Ce PC : son accès n’a pas changé");

  // Le Coffre : chaque serveur a le sien, et un secret n'y va que si on le copie.
  const coffrePc = await app.ev(`window.klyra.coffre.etat()`);
  if (coffrePc.ok && coffrePc.data.chiffrement) {
    const ajoute = await app.ev(`window.klyra.coffre.ajouter({ variable: "CLE_DU_PC", nom: "Clé du PC", valeur: "secret-du-pc" })`);
    verifier(ajoute.ok, "Ce PC : un secret dans son coffre");
    const avant = await app.ev(`window.klyra.coffre.vps(${JSON.stringify(adresse)}, "etat", {})`);
    verifier(avant.ok && avant.data.secrets.length === 0, "VPS : il ne le voit pas");
    const copie = await app.ev(`window.klyra.coffre.copierVers(${JSON.stringify(ajoute.data?.id)}, ${JSON.stringify(adresse)})`);
    verifier(copie.ok, "on copie ce secret sur le VPS");
    const apresCopie = await app.ev(`window.klyra.coffre.vps(${JSON.stringify(adresse)}, "etat", {})`);
    verifier(apresCopie.ok && apresCopie.data.secrets.some((x) => x.variable === "CLE_DU_PC") && !JSON.stringify(apresCopie.data).includes("secret-du-pc"), "VPS : il l’a, et l’écran ne reçoit jamais la valeur");
    const refuse = await app.ev(`window.klyra.coffre.vps(${JSON.stringify(adresse)}, "lire", { id: "x" })`);
    verifier(!refuse.ok, "l’écran ne peut pas demander une valeur au VPS");
  } else {
    console.log("(pas de trousseau ici : seul le coffre du VPS est essayé)");
    const direct = await app.ev(`window.klyra.coffre.vps(${JSON.stringify(adresse)}, "ajouter", { entree: { variable: "CLE_VPS", nom: "Clé du VPS", valeur: "secret-vps" } })`);
    verifier(direct.ok, "VPS : on range un secret dans son coffre");
    const lu = await app.ev(`window.klyra.coffre.vps(${JSON.stringify(adresse)}, "etat", {})`);
    verifier(lu.ok && lu.data.secrets.length === 1 && !JSON.stringify(lu.data).includes("secret-vps"), "VPS : l’écran ne reçoit jamais la valeur");
    const refuse = await app.ev(`window.klyra.coffre.vps(${JSON.stringify(adresse)}, "lire", { id: "x" })`);
    verifier(!refuse.ok, "l’écran ne peut pas demander une valeur au VPS");
  }
  await surServeur(adresse);
  await app.aller("/reglages?section=coffre");
  verifier(await app.quand(`document.body.innerText.includes("à lui seul")`), "Réglages › Coffre, sur le VPS : la page dit que c’est le sien, et comment il est protégé");

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
