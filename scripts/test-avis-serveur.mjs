/**
 * Un VPS en retard, de bout en bout : un vrai serveur KLYRA local (dossier jetable) dont le code est copié sans
 * `versionCode`, comme un serveur d'avant ce contrôle, face à l'app sur un profil temporaire. Réglages du serveur
 * donne l'avis et la commande ; puis le serveur est relancé avec le code du dépôt, comme le ferait `lancer.sh`
 * (mêmes données, même port) : l'appareil reste relié et l'avis tombe tout seul. Aucun vrai VPS n'est touché.
 * Prérequis : `pnpm build && pnpm build:electron`. Linux : `xvfb-run -a pnpm test:avis-serveur`.
 * `KLYRA_CAPTURE_AVIS=<fichier.png>` garde une capture de l'avis.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const RACINE = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "klyra-avis-"));
const port = 20000 + Math.floor(Math.random() * 20000);
const adresse = `http://127.0.0.1:${port}`;
const envServeur = { ...process.env, KLYRA_SERVEUR_DONNEES: path.join(temp, "donnees"), KLYRA_SERVEUR_PORT: String(port), KLYRA_SERVEUR_HOTE: "127.0.0.1", KLYRA_SERVEUR_NOM: "Vieux-VPS" };
const { echecs, verifier } = verificateur();

/* Le code d'avant : le même serveur, sans la version du code. */
const ancien = path.join(temp, "ancien");
cpSync(path.join(RACINE, "serveur"), ancien, { recursive: true });
const fichierAncien = path.join(ancien, "klyra-serveur.mjs");
const sansVersion = readFileSync(fichierAncien, "utf8").replace(", versionCode: VERSION_CODE_SERVEUR", "");
if (sansVersion.includes("versionCode: VERSION_CODE_SERVEUR")) throw new Error("Le serveur annonce sa version autrement : ce test ne simule plus un ancien serveur.");
writeFileSync(fichierAncien, sansVersion);

const repond = () => fetch(`${adresse}/`).then(() => true, () => false);
async function lancerServeur(fichier) {
  const processus = spawn(process.execPath, [fichier], { env: envServeur, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await repond()); i++) await attendre(250);
  return processus;
}

let serveur = await lancerServeur(fichierAncien);
let app;
try {
  const code = execFileSync(process.execPath, [fichierAncien, "appairer"], { env: envServeur }).toString().trim();
  const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(code)}`;

  app = await lancerApp({ env: { HOME: path.join(temp, "home"), KLYRA_USER_DATA: path.join(temp, "profil") }, port: 9800 + Math.floor(Math.random() * 150) });
  await app.aller("/serveurs");
  verifier(await app.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`), "le champ du lien est ouvert");
  await app.saisir('input[aria-label="Lien d’invitation"]', lien);
  await app.cliquer("Rejoindre");
  verifier(await app.quand(`document.querySelector('main')?.innerText.includes("Vieux-VPS")`), "l’app accepte encore un ancien serveur");
  verifier(await app.quand(`document.querySelector('main')?.innerText.includes("Répond · à mettre à jour")`), "l’écran Serveurs dit qu’il est à mettre à jour");

  const reglages = `/serveur/reglages?serveur=${encodeURIComponent(adresse)}`;
  const principal = "(document.querySelector('main')?.innerText ?? '')";
  await app.aller(reglages);
  verifier(await app.quand(`${principal}.includes("Mise à jour à faire")`), "Réglages du serveur donne l’avis");
  verifier(await app.quand(`${principal}.includes("Il n’annonce pas sa version")`), "l’avis explique le cas d’un ancien serveur");
  verifier(await app.quand(`${principal}.includes("raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur/lancer.sh | sudo sh")`), "l’avis donne la commande à relancer");
  verifier(await app.quand(`${principal}.includes("Non annoncée") && ${principal}.includes("À mettre à jour")`), "la ligne de version le dit aussi");
  if (process.env.KLYRA_CAPTURE_AVIS) {
    const { data } = await app.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.env.KLYRA_CAPTURE_AVIS, Buffer.from(data, "base64"));
  }

  /* `lancer.sh` remplace le code et redémarre le service : mêmes données, même port. */
  serveur.kill();
  await new Promise((r) => serveur.once("exit", r));
  serveur = await lancerServeur(path.join(RACINE, "serveur", "klyra-serveur.mjs"));
  verifier(await app.quand(`!${principal}.includes("Mise à jour à faire")`, 75_000), "une fois le serveur à jour, l’avis tombe tout seul, sans rouvrir la page");
  verifier(await app.quand(`/Version \\d+/.test(${principal}) && ${principal}.includes("À jour")`), "la ligne de version annonce le serveur à jour");
  verifier(!(await app.ev(`${principal}.includes("Plus relié")`)), "l’appareil reste relié après la mise à jour");
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
