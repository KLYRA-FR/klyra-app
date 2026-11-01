/**
 * Programme qui répond sur le VPS. Le téléphone l’appelle en GET /klyra/v1/serveur.
 * On ne l’installe pas depuis l’app : il se lance sur la machine, avec Node 22 ou plus récent.
 * Le chemin est le même que CHEMIN_SERVEUR dans src/lib/serveur-vps.ts.
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as creerHttp } from "node:http";
import { createServer as creerHttps } from "node:https";
import { pathToFileURL } from "node:url";

export const CHEMIN = "/klyra/v1/serveur";
export const PROTOCOLE = 1;

function repondre(res, statut, corps) {
  const texte = JSON.stringify(corps);
  res.writeHead(statut, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(texte),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "X-Klyra-Invitation",
  });
  res.end(texte);
}

function invitationAcceptee(attendue, recue) {
  if (!attendue) return true;
  const gauche = Buffer.from(attendue);
  const droite = Buffer.from(typeof recue === "string" ? recue : "");
  if (gauche.length !== droite.length || gauche.length === 0) return false;
  return timingSafeEqual(gauche, droite);
}

/** @param {{ nom?: string, invitation?: string }} options */
export function creerGestionnaire(options) {
  const nom = (options.nom ?? "").trim() || "KLYRA";
  return function gestionnaire(req, res) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "X-Klyra-Invitation",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== CHEMIN) {
      repondre(res, 404, { erreur: "introuvable" });
      return;
    }
    if (req.method !== "GET") {
      repondre(res, 405, { erreur: "methode" });
      return;
    }
    if (!invitationAcceptee(options.invitation, req.headers["x-klyra-invitation"])) {
      repondre(res, 401, { erreur: "invitation" });
      return;
    }
    repondre(res, 200, { produit: "klyra-serveur", protocole: PROTOCOLE, nom, version: String(PROTOCOLE) });
  };
}

/** @param {{ nom?: string, invitation?: string, port?: number, hote?: string, cert?: string, cle?: string }} options */
export function ecouter(options) {
  const gestionnaire = creerGestionnaire(options);
  const serveur = options.cert && options.cle ? creerHttps({ cert: options.cert, key: options.cle }, gestionnaire) : creerHttp(gestionnaire);
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
  const certChemin = process.env.KLYRA_SERVEUR_CERT ?? "";
  const cleChemin = process.env.KLYRA_SERVEUR_CLE ?? "";
  if (Boolean(certChemin) !== Boolean(cleChemin)) {
    process.stderr.write("Le certificat et la clé vont ensemble.\n");
    process.exit(1);
  }
  const port = Number(process.env.KLYRA_SERVEUR_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write("KLYRA_SERVEUR_PORT n’est pas un port.\n");
    process.exit(1);
  }
  const ecoute = await ecouter({
    nom: process.env.KLYRA_SERVEUR_NOM,
    invitation: process.env.KLYRA_SERVEUR_INVITATION || undefined,
    port,
    hote: process.env.KLYRA_SERVEUR_HOTE ?? "127.0.0.1",
    cert: certChemin ? lireFichier(certChemin, "Certificat") : undefined,
    cle: cleChemin ? lireFichier(cleChemin, "Clé") : undefined,
  });
  process.stdout.write(`klyra-serveur ${ecoute.port}\n`);
}
