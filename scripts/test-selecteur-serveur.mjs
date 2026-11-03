/**
 * Le sélecteur de serveur, de bout en bout : un vrai serveur KLYRA local (dossier jetable), l'app sur un
 * profil temporaire, le menu de l'avatar (Réglages, Serveurs), l'appairage par le lien, puis la bascule
 * Ce PC ↔ VPS (chaque serveur est un espace : la conversation de l'assistant n'est pas la même) et le retrait.
 * Prérequis : `pnpm build && pnpm build:electron`. Linux : `xvfb-run -a pnpm test:selecteur`.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const RACINE = path.resolve(import.meta.dirname, "..");
const SERVEUR = path.join(RACINE, "serveur", "klyra-serveur.mjs");
const temp = mkdtempSync(path.join(os.tmpdir(), "klyra-selecteur-"));
const donnees = path.join(temp, "donnees");
const port = 20000 + Math.floor(Math.random() * 20000);
const envServeur = { ...process.env, KLYRA_SERVEUR_DONNEES: donnees, KLYRA_SERVEUR_PORT: String(port), KLYRA_SERVEUR_HOTE: "127.0.0.1", KLYRA_SERVEUR_NOM: "Klyra-VPS" };
const { echecs, verifier } = verificateur();

const serveur = spawn(process.execPath, [SERVEUR], { env: envServeur, stdio: "ignore" });
let app;
try {
  const adresse = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40 && !(await fetch(`${adresse}/`).then(() => true, () => false)); i++) await attendre(250);
  const code = execFileSync(process.execPath, [SERVEUR, "appairer"], { env: envServeur }).toString().trim();
  const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(code)}`;

  app = await lancerApp({ env: { HOME: path.join(temp, "home"), KLYRA_USER_DATA: path.join(temp, "profil") }, port: 9400 + Math.floor(Math.random() * 400) });
  // L'avatar en bas du rail ouvre le menu Compte ; sa ligne Serveurs ouvre le sous-menu des machines.
  const bouton = `document.querySelector('nav button[aria-haspopup="menu"][aria-label*="Serveur : "]')`;
  const libelle = () => app.ev(`${bouton}?.getAttribute('aria-label') ?? ''`);
  const ligneServeurs = `document.querySelector('[role="menu"][aria-label="Compte"] [aria-haspopup="menu"]')`;
  const ouvrirCompte = async () => {
    if ((await app.ev(`${bouton}?.getAttribute('aria-expanded')`)) !== "true") await app.ev(`${bouton}.click()`);
    return app.quand(`document.querySelector('[role="menu"][aria-label="Compte"]')`);
  };
  const ouvrir = async () => {
    await ouvrirCompte();
    if ((await app.ev(`${ligneServeurs}?.getAttribute('aria-expanded')`)) !== "true") await app.ev(`${ligneServeurs}.click()`);
    return app.quand(`document.querySelector('[role="menu"][aria-label="Serveurs"]')`);
  };
  const choisir = (nom) =>
    app.ev(`(() => { const b = [...document.querySelectorAll('[role="menuitemradio"]')].find((x) => x.innerText.split("\\n")[0].trim() === ${JSON.stringify(nom)}); if (!b) return false; b.click(); return true; })()`);
  const machineEnTete = () => app.ev(`document.querySelector('header [aria-label="Machine de la conversation"]') !== null`);
  const conversation = () => app.ev(`new URLSearchParams(location.search).get("id")`);
  const hote = new URL(adresse).host;

  verifier((await app.ev(`document.querySelectorAll('nav button[aria-haspopup="menu"]').length`)) === 1, "le haut du rail n’a plus de sélecteur : seul l’avatar ouvre un menu");
  verifier((await libelle()).includes("Serveur : Ce PC"), `sans serveur, l’avatar annonce Ce PC (« ${await libelle()} »)`);
  verifier(await ouvrirCompte(), "un clic sur l’avatar ouvre le menu Compte");
  verifier(
    (await app.ev(`[...document.querySelectorAll('[role="menu"][aria-label="Compte"] [role="menuitem"]')].map((b) => b.innerText.split("\\n")[0].trim()).join("|")`)) === "Réglages|Serveurs",
    "le menu propose Réglages puis Serveurs",
  );
  verifier(await app.cliquer("Réglages", `document.querySelector('[role="menu"][aria-label="Compte"]')`), "on choisit Réglages");
  verifier(await app.quand(`location.pathname.startsWith("/reglages") && !document.querySelector('[role="menu"][aria-label="Compte"]')`), "Réglages ouvre l’écran des réglages et ferme le menu");
  await ouvrirCompte();
  await app.ev(`${ligneServeurs}.focus()`);
  await app.touche("ArrowRight", "ArrowRight", 39);
  verifier(await app.quand(`document.activeElement?.closest('[role="menu"][aria-label="Serveurs"]') && document.activeElement.getAttribute("aria-checked") === "true"`), "→ ouvre les serveurs, le focus sur la machine cochée");
  await app.touche("ArrowLeft", "ArrowLeft", 37);
  verifier(await app.quand(`!document.querySelector('[role="menu"][aria-label="Serveurs"]') && document.activeElement === ${ligneServeurs}`), "← referme les serveurs et rend le focus à la ligne Serveurs");
  await app.touche("Escape", "Escape", 27);
  verifier(await app.quand(`!document.querySelector('[role="menu"][aria-label="Compte"]') && document.activeElement === ${bouton}`), "Échap ferme le menu et rend le focus à l’avatar");
  verifier(await ouvrir(), "le menu des serveurs s’ouvre depuis la ligne Serveurs");
  verifier((await app.ev(`document.querySelectorAll('[role="menuitemradio"]').length`)) === 1, "seul Ce PC est proposé");
  verifier(await app.cliquer("Ajouter un serveur"), "« Ajouter un serveur » mène à l’écran Serveurs");
  verifier(await app.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`), "le champ du lien est ouvert");

  await app.saisir('input[aria-label="Lien d’invitation"]', lien);
  await app.cliquer("Rejoindre");
  verifier(await app.quand(`document.querySelector('main')?.innerText.includes("Klyra-VPS")`), "Klyra-VPS rejoint par le lien");

  await app.aller("/chat?id=dm-principal");
  verifier(await ouvrir(), "le menu se rouvre avec le VPS");
  verifier(await app.quand(`[...document.querySelectorAll('[role="menuitemradio"]')].some((b) => b.innerText.includes("Répond"))`), "Klyra-VPS répond");
  verifier(await choisir("Klyra-VPS"), "on choisit Klyra-VPS");
  verifier(await app.quand(`${bouton}?.getAttribute('aria-label').includes("Serveur : Klyra-VPS")`), "l’avatar annonce Klyra-VPS");
  verifier(await app.quand(`${bouton}?.querySelector('[aria-hidden="true"] svg') && !document.querySelector('[role="menu"][aria-label="Compte"]')`), "le globe sur l’avatar montre qu’un VPS est actif, menu fermé");
  await ouvrirCompte();
  verifier(await app.quand(`${ligneServeurs}?.innerText.includes("Klyra-VPS")`), "la ligne Serveurs du menu montre Klyra-VPS");
  verifier(await app.quand(`new URLSearchParams(location.search).get("id") === ${JSON.stringify(`dm-principal@${hote}`)}`), `la page passe à la conversation de l’assistant sur Klyra-VPS (« ${await conversation()} »)`);
  verifier(!(await machineEnTete()), "l’en-tête n’a plus de choix de machine : on change de serveur, pas de conversation");
  verifier(!(await app.ev(`[...document.querySelectorAll('[role="status"]')].some((e) => e.innerText.includes("Passer sur"))`)), "la conversation affichée est bien celle du serveur choisi");
  await app.touche("Escape", "Escape", 27);

  await ouvrir();
  verifier(await choisir("Ce PC"), "on revient sur Ce PC");
  verifier(await app.quand(`${bouton}?.getAttribute('aria-label').includes("Serveur : Ce PC")`), "l’avatar annonce Ce PC");
  verifier(await app.quand(`new URLSearchParams(location.search).get("id") === "dm-principal"`), `la page revient à la conversation de Ce PC (« ${await conversation()} »)`);
  await app.aller(`/chat?id=${encodeURIComponent(`dm-principal@${hote}`)}`);
  verifier(await app.quand(`[...document.querySelectorAll('[role="status"]')].some((e) => e.innerText.includes("Passer sur Klyra-VPS"))`), "un lien vers une conversation du VPS propose d’y passer");

  await ouvrir();
  await choisir("Klyra-VPS");
  await app.quand(`${bouton}?.getAttribute('aria-label').includes("Serveur : Klyra-VPS")`);
  await ouvrir();
  verifier(await app.cliquer("Retirer Klyra-VPS"), "« Retirer Klyra-VPS » est proposé pour le serveur actif");
  verifier(await app.quand(`document.querySelector('[role="alertdialog"]')`), "une confirmation est demandée");
  await app.cliquer("Retirer", `document.querySelector('[role="alertdialog"]')`);
  verifier(await app.quand(`${bouton}?.getAttribute('aria-label').includes("Serveur : Ce PC")`), "après le retrait, l’avatar revient sur Ce PC");
  await ouvrir();
  verifier((await app.ev(`document.querySelectorAll('[role="menuitemradio"]').length`)) === 1, "le serveur retiré n’est plus proposé");
  await app.touche("Escape", "Escape", 27);
  await app.aller("/serveurs");
  verifier(await app.quand(`document.querySelector('main')?.innerText.includes("Colle cette commande")`), "l’écran Serveurs revient au guide");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
} catch (erreur) {
  verifier(false, String(erreur));
} finally {
  await app?.fermer();
  serveur.kill();
  rmSync(temp, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s)` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
