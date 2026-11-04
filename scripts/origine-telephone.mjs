/**
 * Origine locale de l'app web du téléphone (`out/`), derrière le tunnel.
 *
 * Réglages › « Relier un téléphone » affiche l'adresse https du tunnel.
 * Cloudflare répond 502 quand ce tunnel est encore connecté et que plus
 * rien n'écoute sur le port : le navigateur et Cloudflare vont bien, l'hôte non.
 * On relance seulement l'origine. Relancer cloudflared changerait l'adresse,
 * et le QR déjà affiché pointerait vers un ancien tunnel.
 *
 *   node scripts/origine-telephone.mjs --racine out --port 8765
 */
import { createServer as creerServeurHttp, request as requeteHttp } from "node:http";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

/** Le fichier de l'export pour cette adresse, ou null. `/plus` sert `plus.html`. */
export function cheminFichier(racine, urlPath) {
  const chemin = decodeURIComponent(new URL(urlPath, "http://127.0.0.1").pathname);
  const candidats = chemin.endsWith("/") ? [`${chemin}index.html`] : [chemin, `${chemin}.html`, `${chemin}/index.html`];
  const base = path.resolve(racine);
  for (const candidat of candidats) {
    const fichier = path.resolve(base, `.${candidat}`);
    if (fichier !== base && !fichier.startsWith(base + path.sep)) continue;
    try {
      if (statSync(fichier).isFile()) return fichier;
    } catch {
      /* le candidat suivant */
    }
  }
  return null;
}

export function creerServeur(racine) {
  const base = path.resolve(racine);
  return creerServeurHttp((req, res) => {
    const fichier = cheminFichier(base, req.url ?? "/");
    if (!fichier) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("introuvable");
      return;
    }
    const entetes = { "Content-Type": TYPES[path.extname(fichier)] ?? "application/octet-stream" };
    if (path.basename(fichier) === "sw.js") entetes["Cache-Control"] = "no-cache";
    res.writeHead(200, entetes);
    res.end(readFileSync(fichier));
  });
}

function ecouter(serveur, port) {
  return new Promise((resolve, reject) => {
    const erreur = (e) => {
      serveur.off("listening", pret);
      reject(e);
    };
    const pret = () => {
      serveur.off("error", erreur);
      const adresse = serveur.address();
      resolve(typeof adresse === "object" && adresse ? adresse.port : port);
    };
    serveur.once("error", erreur);
    serveur.once("listening", pret);
    serveur.listen(port, "127.0.0.1");
  });
}

function fermer(serveur) {
  return new Promise((resolve) => {
    if (!serveur.listening) {
      resolve();
      return;
    }
    serveur.close(() => resolve());
  });
}

/** `ok` si l'accueil répond, `refuse` si rien n'écoute (le cas du 502). */
export async function sonderOrigine(port) {
  try {
    const reponse = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return reponse.ok ? "ok" : "erreur";
  } catch (e) {
    const code = e?.cause?.code ?? e?.code;
    return code === "ECONNREFUSED" ? "refuse" : "erreur";
  }
}

/**
 * Reproduit la passerelle du tunnel : une origine qui refuse la connexion
 * devient un HTTP 502, sans toucher à l'adresse publique.
 */
export async function creerPasserelle(portOrigine) {
  const serveur = creerServeurHttp((req, res) => {
    const amont = requeteHttp(
      { hostname: "127.0.0.1", port: portOrigine, path: req.url, method: req.method ?? "GET" },
      (reponse) => {
        res.writeHead(reponse.statusCode ?? 502, reponse.headers);
        reponse.pipe(res);
      },
    );
    amont.on("error", () => {
      if (res.headersSent) return;
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad gateway");
    });
    amont.end();
  });
  const port = await ecouter(serveur, 0);
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    fermer: () => fermer(serveur),
  };
}

/** L'adresse affichée dans le QR. Null tant que l'origine ne répond pas. */
export function adressePubliable(sonde, adresse) {
  if (sonde !== "ok" || typeof adresse !== "string") return null;
  try {
    const url = new URL(adresse);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Sert l'export et le remet en écoute s'il tombe. Le tunnel, lui, n'est pas relancé.
 * `simulerArret` ferme seulement la prise, comme un serveur qui a quitté.
 */
export async function garderOrigine({ racine, port, intervalleMs = 3000 }) {
  let serveur = creerServeur(racine);
  let arrete = false;
  let enRelance = false;
  await ecouter(serveur, port);

  async function relancer() {
    if (arrete || enRelance) return sonderOrigine(port);
    const etat = await sonderOrigine(port);
    if (etat === "ok") return "ok";
    enRelance = true;
    try {
      await fermer(serveur);
      serveur = creerServeur(racine);
      await ecouter(serveur, port);
    } finally {
      enRelance = false;
    }
    return sonderOrigine(port);
  }

  const minuteur = setInterval(() => {
    relancer().catch(() => {});
  }, intervalleMs);

  return {
    port,
    relancer,
    simulerArret: () => fermer(serveur),
    fermer: async () => {
      arrete = true;
      clearInterval(minuteur);
      await fermer(serveur);
    },
  };
}

function option(args, nom, defaut) {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
}

async function principale() {
  const args = process.argv.slice(2);
  const racine = path.resolve(option(args, "--racine", path.join(import.meta.dirname, "..", "out")));
  const port = Number(option(args, "--port", "8765"));
  if (!Number.isInteger(port) || port < 1) {
    process.stderr.write("Le port n'est pas un nombre.\n");
    process.exit(1);
  }
  const origine = await garderOrigine({ racine, port });
  process.stdout.write(`Origine du téléphone en écoute sur 127.0.0.1:${origine.port}\n`);
  const arret = async () => {
    await origine.fermer();
    process.exit(0);
  };
  process.on("SIGINT", () => void arret());
  process.on("SIGTERM", () => void arret());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principale().catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.message : "origine arrêtée"}\n`);
    process.exit(1);
  });
}
