/**
 * Le sélecteur de serveur du rail, de bout en bout : un vrai serveur KLYRA local (dossier jetable),
 * l'app sur un profil temporaire, l'appairage par le lien, puis la bascule Ce PC ↔ VPS et le retrait.
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
  const bouton = `document.querySelector('nav button[aria-haspopup="menu"]')`;
  const libelle = () => app.ev(`${bouton}?.getAttribute('aria-label') ?? ''`);
  const ouvrir = async () => {
    if ((await app.ev(`${bouton}?.getAttribute('aria-expanded')`)) !== "true") await app.ev(`${bouton}.click()`);
    return app.quand(`document.querySelector('[role="menu"][aria-label="Serveurs"]')`);
  };
  const choisir = (nom) =>
    app.ev(`(() => { const b = [...document.querySelectorAll('[role="menuitemradio"]')].find((x) => x.innerText.split("\\n")[0].trim() === ${JSON.stringify(nom)}); if (!b) return false; b.click(); return true; })()`);
  const machineEnTete = () => app.ev(`document.querySelector('header [aria-label="Machine de la conversation"]')?.innerText.trim() ?? null`);

  verifier(/^Serveur : Ce PC/.test(await libelle()), `sans serveur, le sélecteur montre Ce PC (« ${await libelle()} »)`);
  verifier(await ouvrir(), "le menu des serveurs s’ouvre");
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
  verifier(await app.quand(`${bouton}?.getAttribute('aria-label').startsWith("Serveur : Klyra-VPS")`), "le sélecteur montre Klyra-VPS");
  verifier((await machineEnTete())?.includes("Klyra-VPS"), `la conversation avec l’assistant passe sur Klyra-VPS (en-tête : « ${await machineEnTete()} »)`);

  await ouvrir();
  verifier(await choisir("Ce PC"), "on revient sur Ce PC");
  verifier(await app.quand(`${bouton}?.getAttribute('aria-label').startsWith("Serveur : Ce PC")`), "le sélecteur montre Ce PC");
  verifier((await machineEnTete())?.includes("Ce PC"), "la conversation revient sur Ce PC");

  await ouvrir();
  await choisir("Klyra-VPS");
  await app.quand(`${bouton}?.getAttribute('aria-label').startsWith("Serveur : Klyra-VPS")`);
  await ouvrir();
  verifier(await app.cliquer("Retirer Klyra-VPS"), "« Retirer Klyra-VPS » est proposé pour le serveur actif");
  verifier(await app.quand(`document.querySelector('[role="alertdialog"]')`), "une confirmation est demandée");
  await app.cliquer("Retirer", `document.querySelector('[role="alertdialog"]')`);
  verifier(await app.quand(`${bouton}?.getAttribute('aria-label').startsWith("Serveur : Ce PC")`), "après le retrait, le sélecteur revient sur Ce PC");
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
