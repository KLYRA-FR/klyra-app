import { execFile, spawn } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { voirOutil } from "./apercu";
import {
  adresseHttp,
  bundleDepuisHandlers,
  detectionDe,
  executableDepuisCommande,
  fenetreDuNavigateur,
  planDeLancement,
  progIdDepuisReg,
  progIdSur,
  reconnaitre,
  valeurReg,
  type NavigateurConnu,
} from "./navigateur-defaut";
import { listerFenetresPilote } from "./pilote";

/**
 * Ouvre le navigateur par défaut dans une nouvelle fenêtre. Local seulement
 * (Windows, Mac) : un VPS continue d'utiliser le navigateur de KLYRA.
 * Le profil n'est pas choisi et aucun de ses fichiers n'est écrit par KLYRA.
 */

const exec = promisify(execFile);

export const OUTIL_FENETRE_NAVIGATEUR = {
  name: "ordinateur_fenetre_navigateur",
  description:
    "Ouvre le navigateur par défaut de la personne dans une nouvelle fenêtre (Windows ou Mac : Chrome, Edge, Firefox, Safari ou Brave), avec son profil habituel, sans rien y modifier et sans ajouter d'onglet à une fenêtre déjà ouverte. À utiliser avant de piloter ce navigateur avec Computer Use. Si le navigateur n'est pas pris en charge, rien n'est ouvert : répète le message à la personne.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Facultatif : une adresse http ou https. Sans elle, la fenêtre est vide." },
    },
    additionalProperties: false,
  },
};

const APP_PATH: Record<NavigateurConnu, string | null> = {
  chrome: "chrome.exe",
  edge: "msedge.exe",
  firefox: "firefox.exe",
  brave: "brave.exe",
  safari: null,
};

export async function ouvrirFenetreNavigateurDefaut(url: unknown, chatId: string): Promise<string> {
  const adresse = adresseHttp(typeof url === "string" ? url : undefined);
  if (adresse === "refus") return "Adresse refusée : seulement http ou https. Rien n'a été ouvert.";
  const lecture = await lireSysteme(process.platform);
  const detection = detectionDe(lecture);
  if (detection.etat !== "connu" || !detection.navigateur) return detection.message;
  const plan = planDeLancement(detection, lecture.plateforme, adresse);
  if ("erreur" in plan) return plan.erreur;
  try {
    await lancer(plan.fichier, plan.args, plan.attendre);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "erreur";
    return `${detection.nom} n'a pas pu s'ouvrir (${detail.slice(0, 300)}). Rien d'autre n'a été lancé.`;
  }
  await new Promise((r) => setTimeout(r, 400));
  try {
    const trouvee = fenetreDuNavigateur(await listerFenetresPilote(), detection.navigateur);
    if (trouvee && chatId) voirOutil(chatId, "mcp__ordinateur__get_window_state", { window_id: trouvee.windowId, pid: trouvee.pid, app: detection.nom });
  } catch {
    /* Le panneau s'attachera à la fenêtre au prochain outil de Computer Use. */
  }
  return `Nouvelle fenêtre de ${detection.nom}, profil habituel, aucun fichier du profil modifié. Pilote cette fenêtre, pas une autre.`;
}

async function lireSysteme(plateforme: NodeJS.Platform): Promise<{ plateforme: string; indice: string | null; commande: string | null }> {
  if (plateforme === "win32") return lireWindows();
  if (plateforme === "darwin") return lireMac();
  return { plateforme, indice: null, commande: null };
}

async function lireWindows(): Promise<{ plateforme: string; indice: string | null; commande: string | null }> {
  const https = await texte("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", "/v", "ProgId"]);
  const http = https ? null : await texte("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice", "/v", "ProgId"]);
  const indice = progIdDepuisReg(https ?? http ?? "");
  if (!indice) return { plateforme: "win32", indice: null, commande: null };
  return { plateforme: "win32", indice, commande: await commandeWindows(indice) };
}

async function commandeWindows(progId: string): Promise<string | null> {
  if (!progIdSur(progId)) return null;
  const cle = `${progId}\\shell\\open\\command`;
  const hkcu = await texte("reg", ["query", `HKCU\\Software\\Classes\\${cle}`, "/ve"]);
  const hklm = hkcu ?? (await texte("reg", ["query", `HKLM\\SOFTWARE\\Classes\\${cle}`, "/ve"]));
  const ligne = hklm ? valeurReg(hklm) : null;
  if (ligne && executableDepuisCommande(ligne)) return ligne;
  const reconnu = reconnaitre(progId).navigateur;
  const exe = reconnu ? APP_PATH[reconnu] : null;
  if (!exe) return ligne;
  const chemin = await texte("reg", ["query", `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, "/ve"]);
  return (chemin && valeurReg(chemin)) || ligne;
}

async function lireMac(): Promise<{ plateforme: string; indice: string | null; commande: string | null }> {
  const plist = `${os.homedir()}/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist`;
  const json = await texte("plutil", ["-convert", "json", "-o", "-", plist]);
  if (!json) return { plateforme: "darwin", indice: null, commande: null };
  try {
    return { plateforme: "darwin", indice: bundleDepuisHandlers(JSON.parse(json) as unknown), commande: null };
  } catch {
    return { plateforme: "darwin", indice: null, commande: null };
  }
}

function texte(fichier: string, args: string[]): Promise<string | null> {
  return exec(fichier, args, { timeout: 4_000, windowsHide: true, maxBuffer: 1_000_000 }).then(
    (r) => r.stdout,
    () => null,
  );
}

function lancer(fichier: string, args: string[], attendre: boolean): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const enfant = spawn(fichier, args, attendre ? { stdio: ["ignore", "ignore", "pipe"] } : { detached: true, stdio: "ignore", windowsHide: true });
    let erreur = "";
    enfant.stderr?.on("data", (d: Buffer) => {
      if (erreur.length < 400) erreur += d.toString("utf8");
    });
    enfant.once("error", rejeter);
    if (!attendre) {
      enfant.once("spawn", () => {
        enfant.unref();
        resoudre();
      });
      return;
    }
    enfant.once("exit", (code) => (code === 0 ? resoudre() : rejeter(new Error(erreur.trim() || `code ${code ?? "inconnu"}`))));
  });
}
