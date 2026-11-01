/**
 * Programme qui répond sur le VPS. L’app l’appelle en GET /klyra/v1/serveur, avec son jeton d’appareil.
 * On ne l’installe pas depuis l’app : `serveur/lancer.sh` le pose sur la machine (Node 22 ou plus récent).
 * Le chemin est le même que CHEMIN_SERVEUR dans electron/lecture-serveur.ts.
 *
 * Appairage : `node klyra-serveur.mjs appairer` écrit un code à usage unique (10 min) et l’affiche
 * dans le terminal. L’app l’échange contre un jeton d’appareil (POST /klyra/v1/appairer).
 * Le serveur ne garde que l’empreinte des codes et des jetons. Aucun secret sur la page publique.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer as creerHttp } from "node:http";
import { createServer as creerHttps } from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CHEMIN = "/klyra/v1/serveur";
export const CHEMIN_APPAIRER = "/klyra/v1/appairer";
export const CHEMIN_APPAREIL = "/klyra/v1/appareil";
export const PROTOCOLE = 1;

export const DUREE_CODE_MS = 10 * 60_000;
/** Au-delà, tous les codes en attente tombent : il faut relancer `appairer`. */
const ECHECS_MAX = 5;
const CORPS_MAX = 2048;
const APPAREILS_MAX = 20;

const empreinte = (secret) => createHash("sha256").update(secret, "utf8").digest("hex");

function egal(a, b) {
  const gauche = Buffer.from(a, "hex");
  const droite = Buffer.from(b, "hex");
  return gauche.length === droite.length && gauche.length > 0 && timingSafeEqual(gauche, droite);
}

/* ─── Ce que le serveur garde, dans son dossier de données ─────────── */

function lireJson(fichier, defaut) {
  try {
    return JSON.parse(readFileSync(fichier, "utf8"));
  } catch {
    return defaut;
  }
}

function ecrireJson(fichier, valeur) {
  mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 });
  const temporaire = `${fichier}.tmp`;
  writeFileSync(temporaire, JSON.stringify(valeur, null, 2), { mode: 0o600 });
  renameSync(temporaire, fichier);
}

const fichierCodes = (dossier) => path.join(dossier, "codes.json");
const fichierAppareils = (dossier) => path.join(dossier, "appareils.json");

function lireCodes(dossier, maintenant) {
  const codes = lireJson(fichierCodes(dossier), []);
  return Array.isArray(codes) ? codes.filter((c) => c && typeof c.empreinte === "string" && typeof c.expire === "number" && c.expire > maintenant) : [];
}

export function lireAppareils(dossier) {
  const appareils = lireJson(fichierAppareils(dossier), []);
  return Array.isArray(appareils) ? appareils.filter((a) => a && typeof a.id === "string" && typeof a.empreinte === "string") : [];
}

/** Un code à usage unique, lisible au téléphone : 10 caractères sans 0/O ni 1/I. */
export function creerCode(dossier, maintenant = Date.now()) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const octets = randomBytes(10);
  let code = "";
  for (const octet of octets) code += alphabet[octet % alphabet.length];
  const codes = lireCodes(dossier, maintenant);
  codes.push({ empreinte: empreinte(code), expire: maintenant + DUREE_CODE_MS });
  ecrireJson(fichierCodes(dossier), codes.slice(-5));
  return code;
}

export function revoquerTout(dossier) {
  ecrireJson(fichierAppareils(dossier), []);
  ecrireJson(fichierCodes(dossier), []);
}

/* ─── HTTP ─────────────────────────────────────────────────────────── */

const ENTETES_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function repondre(res, statut, corps) {
  const texte = JSON.stringify(corps);
  res.writeHead(statut, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(texte),
    "Cache-Control": "no-store",
    ...ENTETES_CORS,
  });
  res.end(texte);
}

function echapper(texte) {
  return texte.replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractere]);
}

/** Ne montre ni lien ni code : ils ne s’affichent que dans le terminal du VPS. */
function pageAccueil(nom) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Serveur KLYRA</title><style>
body{margin:0;background:#fff;color:#111;font-family:system-ui,sans-serif}
main{max-width:420px;min-height:100dvh;margin:0 auto;padding:20px 16px 32px;display:flex;flex-direction:column;gap:12px}
h1{font-size:22px;margin:0}
p{margin:0;font-size:15px;line-height:1.35}
</style></head><body><main>
<h1>${echapper(nom)}</h1>
<p>Ce serveur KLYRA est en marche.</p>
<p>Pour y relier l’app, relance la commande d’installation sur le VPS : elle affiche un lien et un QR valables 10 minutes.</p>
</main></body></html>`;
}

function lireCorpsRequete(req) {
  return new Promise((resolve) => {
    let texte = "";
    let trop = false;
    req.setEncoding("utf8");
    req.on("data", (morceau) => {
      if (trop) return;
      texte += morceau;
      if (texte.length > CORPS_MAX) trop = true;
    });
    req.on("end", () => {
      if (trop) return resolve(null);
      try {
        resolve(JSON.parse(texte));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function jetonDe(req) {
  const valeur = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const trouve = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(valeur.trim());
  return trouve ? trouve[1] : null;
}

/** @param {{ nom?: string, dossier: string, maintenant?: () => number }} options */
export function creerGestionnaire(options) {
  const nom = (options.nom ?? "").trim() || "KLYRA";
  const dossier = options.dossier;
  const maintenant = options.maintenant ?? Date.now;
  let echecs = 0;

  const appareilDe = (req) => {
    const jeton = jetonDe(req);
    if (!jeton) return null;
    const cherche = empreinte(jeton);
    return lireAppareils(dossier).find((a) => egal(a.empreinte, cherche)) ?? null;
  };
  const corpsServeur = () => ({ produit: "klyra-serveur", protocole: PROTOCOLE, nom, version: String(PROTOCOLE) });

  return async function gestionnaire(req, res) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...ENTETES_CORS, "Access-Control-Max-Age": "600" });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/") {
      if (req.method !== "GET") return repondre(res, 405, { erreur: "methode" });
      const html = pageAccueil(nom);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(html);
      return;
    }

    if (url.pathname === CHEMIN_APPAIRER) {
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode" });
      const corps = await lireCorpsRequete(req);
      const code = typeof corps?.code === "string" ? corps.code.trim().toUpperCase() : "";
      const appareil = typeof corps?.appareil === "string" ? corps.appareil.trim().slice(0, 80) : "";
      const codes = lireCodes(dossier, maintenant());
      const cherche = code ? empreinte(code) : "";
      const index = cherche ? codes.findIndex((c) => egal(c.empreinte, cherche)) : -1;
      if (index < 0) {
        echecs += 1;
        // Trop d’essais : plus aucun code ne vaut, il faut en redemander un sur le VPS.
        if (echecs >= ECHECS_MAX) {
          ecrireJson(fichierCodes(dossier), []);
          echecs = 0;
        }
        return repondre(res, 401, { erreur: "code" });
      }
      const appareils = lireAppareils(dossier);
      if (appareils.length >= APPAREILS_MAX) return repondre(res, 409, { erreur: "appareils" });
      codes.splice(index, 1);
      ecrireJson(fichierCodes(dossier), codes);
      const jeton = randomBytes(32).toString("base64url");
      const date = new Date(maintenant()).toISOString();
      appareils.push({ id: randomBytes(8).toString("hex"), nom: appareil || "Appareil", empreinte: empreinte(jeton), cree: date, vu: date });
      ecrireJson(fichierAppareils(dossier), appareils);
      return repondre(res, 200, { ...corpsServeur(), jeton });
    }

    if (url.pathname === CHEMIN_APPAREIL) {
      if (req.method !== "DELETE") return repondre(res, 405, { erreur: "methode" });
      const appareil = appareilDe(req);
      if (!appareil) return repondre(res, 401, { erreur: "appareil" });
      ecrireJson(fichierAppareils(dossier), lireAppareils(dossier).filter((a) => a.id !== appareil.id));
      res.writeHead(204, ENTETES_CORS);
      res.end();
      return;
    }

    if (url.pathname !== CHEMIN) return repondre(res, 404, { erreur: "introuvable" });
    if (req.method !== "GET") return repondre(res, 405, { erreur: "methode" });
    const appareil = appareilDe(req);
    if (!appareil) return repondre(res, 401, { erreur: "appareil" });
    // Dernière visite, à la minute près : pas une écriture par appel.
    const date = new Date(maintenant()).toISOString();
    if (appareil.vu?.slice(0, 16) !== date.slice(0, 16)) {
      ecrireJson(fichierAppareils(dossier), lireAppareils(dossier).map((a) => (a.id === appareil.id ? { ...a, vu: date } : a)));
    }
    return repondre(res, 200, corpsServeur());
  };
}

/** @param {{ nom?: string, dossier: string, port?: number, hote?: string, cert?: Buffer, cle?: Buffer, maintenant?: () => number }} options */
export function ecouter(options) {
  const gestionnaire = creerGestionnaire(options);
  const appel = (req, res) => {
    gestionnaire(req, res).catch(() => {
      if (!res.headersSent) repondre(res, 500, { erreur: "serveur" });
    });
  };
  const serveur = options.cert && options.cle ? creerHttps({ cert: options.cert, key: options.cle }, appel) : creerHttp(appel);
  const port = options.port ?? 0;
  const hote = options.hote ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    serveur.once("error", reject);
    serveur.listen(port, hote, () => {
      const adresse = serveur.address();
      resolve({
        serveur,
        port: typeof adresse === "object" && adresse ? adresse.port : port,
        fermer: () => new Promise((fini, echec) => serveur.close((err) => (err ? echec(err) : fini()))),
      });
    });
  });
}

function lireFichier(chemin, etiquette) {
  try {
    return readFileSync(chemin);
  } catch {
    process.stderr.write(`${etiquette} illisible.\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dossier = path.resolve(process.env.KLYRA_SERVEUR_DONNEES || path.join(path.dirname(process.argv[1]), "donnees"));
  const commande = process.argv[2] ?? "";
  if (commande === "appairer") {
    process.stdout.write(`${creerCode(dossier)}\n`);
    process.exit(0);
  }
  if (commande === "revoquer-tout") {
    revoquerTout(dossier);
    process.stdout.write("Plus aucun appareil n’est relié à ce serveur.\n");
    process.exit(0);
  }
  if (commande) {
    process.stderr.write("Commandes : appairer, revoquer-tout, ou rien pour lancer le serveur.\n");
    process.exit(1);
  }
  if (!existsSync(dossier)) mkdirSync(dossier, { recursive: true, mode: 0o700 });

  const certChemin = process.env.KLYRA_SERVEUR_CERT ?? "";
  const cleChemin = process.env.KLYRA_SERVEUR_CLE ?? "";
  if (Boolean(certChemin) !== Boolean(cleChemin)) {
    process.stderr.write("Le certificat et la clé vont ensemble.\n");
    process.exit(1);
  }
  const port = Number(process.env.KLYRA_SERVEUR_PORT ?? "8791");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write("KLYRA_SERVEUR_PORT n’est pas un port.\n");
    process.exit(1);
  }
  const ecoute = await ecouter({
    nom: process.env.KLYRA_SERVEUR_NOM,
    dossier,
    port,
    hote: process.env.KLYRA_SERVEUR_HOTE ?? "127.0.0.1",
    cert: certChemin ? lireFichier(certChemin, "Certificat") : undefined,
    cle: cleChemin ? lireFichier(cleChemin, "Clé") : undefined,
  });
  process.stdout.write(`klyra-serveur ${ecoute.port}\n`);
}
