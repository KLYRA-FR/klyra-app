/**
 * Programme qui répond sur le VPS. Le téléphone l’appelle en GET /klyra/v1/serveur.
 * On ne l’installe pas depuis l’app : il se lance sur la machine, avec Node 22 ou plus récent.
 * Le chemin est le même que CHEMIN_SERVEUR dans src/lib/serveur-vps.ts.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as creerHttp } from "node:http";
import { createServer as creerHttps } from "node:https";
import { pathToFileURL } from "node:url";
import { qrSvg } from "./qr.mjs";

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

export function lienInvitation(adresse, invitation) {
  const lien = new URL("klyra://rejoindre");
  lien.searchParams.set("adresse", adresse);
  if (invitation) lien.searchParams.set("invitation", invitation);
  return lien.toString();
}

function echapper(texte) {
  return texte.replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractere]);
}

function origineDemandee(req) {
  const forcee = (process.env.KLYRA_SERVEUR_PUBLIC ?? "").trim();
  if (forcee) {
    try {
      return new URL(forcee).origin;
    } catch {
      /* l'en-tête Host sert alors */
    }
  }
  const host = typeof req.headers.host === "string" ? req.headers.host.trim() : "";
  if (!host || /[\s/]/.test(host)) return "http://127.0.0.1";
  const hote = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const local = hote === "127.0.0.1" || hote === "localhost" || hote === "::1";
  return `${local ? "http" : "https"}://${host}`;
}

function pageRejoindre(nom, lien, invitation) {
  const code = JSON.stringify(invitation ?? "");
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Serveurs — KLYRA</title><style>
body{margin:0;background:#fff;color:#111;font-family:system-ui,sans-serif}
main{max-width:420px;min-height:100dvh;margin:0 auto;padding:20px 16px 32px;display:flex;flex-direction:column;gap:12px}
h1{font-size:22px;margin:0}
p{margin:0;font-size:15px;line-height:1.35}
.secondaire{color:#444}
.qr{width:min(240px,72vw)}
.qr svg{width:100%;height:auto;display:block}
.lien{font-size:13px;word-break:break-all}
button{min-height:44px;border:0;border-radius:8px;background:#111;color:#fff;font-size:16px}
#etat{min-height:1.2em}
</style></head><body><main>
<h1>Serveurs</h1>
<p>Rejoindre ${echapper(nom)}. Le QR est affiché ici, côté serveur.</p>
<div class="qr">${qrSvg(lien)}</div>
<p class="lien">${echapper(lien)}</p>
<p class="secondaire">Sur l’iPhone, ouvre cette page dans Safari et touche Rejoindre. Depuis un autre écran, scanne le QR. Un autre VPS se rejoint avec son propre lien, le même geste.</p>
<button type="button" id="rejoindre">Rejoindre</button>
<p id="etat" role="status"></p>
<script>
const invitation = ${code};
document.getElementById("rejoindre").addEventListener("click", async () => {
  const etat = document.getElementById("etat");
  etat.textContent = "Connexion…";
  try {
    const headers = invitation ? { "X-Klyra-Invitation": invitation } : {};
    const reponse = await fetch("/klyra/v1/serveur", { headers, cache: "no-store" });
    const corps = await reponse.json();
    etat.textContent = reponse.ok ? corps.nom + " répond." : "Cette invitation n’est pas la bonne.";
  } catch {
    etat.textContent = "Ce serveur ne répond pas. S’il est éteint, la connexion échoue.";
  }
});
</script>
</main></body></html>`;
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
    if (url.pathname === "/" || url.pathname === "/rejoindre") {
      if (req.method !== "GET") {
        repondre(res, 405, { erreur: "methode" });
        return;
      }
      const lien = lienInvitation(origineDemandee(req), options.invitation);
      const html = pageRejoindre(nom, lien, options.invitation);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(html);
      return;
    }
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
    invitation: process.env.KLYRA_SERVEUR_INVITATION || randomBytes(18).toString("base64url"),
    port,
    hote: process.env.KLYRA_SERVEUR_HOTE ?? "127.0.0.1",
    cert: certChemin ? lireFichier(certChemin, "Certificat") : undefined,
    cle: cleChemin ? lireFichier(cleChemin, "Clé") : undefined,
  });
  process.stdout.write(`klyra-serveur ${ecoute.port}\n`);
}
