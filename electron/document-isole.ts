/**
 * Règles de la fenêtre d'un document KLYRA (HTML d'abord).
 * Origine propre (`klyra-document://`), sans le schéma `app` ni le réseau.
 * Le processus principal sert les octets ; l'écran ne reçoit pas d'adresse Convex.
 */

import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export const SCHEMA = "klyra-document";

/** Une session par document, en mémoire : pas les jetons de l'app, pas ceux de claude.ai. */
export const PARTITION_PREFIXE = "klyra-document-";

/** Schéma privilégié, enregistré une fois avant `app.ready` (cf. electron/main.ts). */
export const PRIVILEGE_SCHEMA = {
  scheme: SCHEMA,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

/**
 * La page peut afficher ses propres scripts, styles et fichiers.
 * Elle ne contacte pas une autre origine : ni Convex, ni le VPS, ni l'app.
 */
export const POLITIQUE = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Une page qu'on dessine dans la fenêtre isolée. Le reste s'ouvre avec l'app du système. */
export const PAGE_ISOLEE = /\.(html?|svg)$/i;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
};

export function typeMime(chemin: string): string {
  const ext = path.extname(chemin).slice(1).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
}

/**
 * Chemin demandé par la page (`/`, `/index.html`, `/css/site.css`).
 * `null` si le chemin sort du document (`..`, absolu, octet nul).
 */
export function relatifDemande(pathname: string): string | null {
  if (typeof pathname !== "string" || pathname.includes("\0") || pathname.includes("\\")) return null;
  const brut = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (brut === "" || brut === "index.html") return "index.html";
  const propres: string[] = [];
  for (const segment of brut.split("/")) {
    if (!segment || segment === "." || segment === "..") return null;
    let decode: string;
    try {
      decode = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (!decode || decode === "." || decode === ".." || decode.includes("/") || decode.includes("\\") || decode.includes("\0")) return null;
    propres.push(decode);
  }
  return propres.join("/");
}

/** Le fichier sous `racine`, ou null s'il n'existe pas, n'est pas un fichier, ou sort de la racine (lien inclus). */
export function fichierSous(racine: string, relatif: string): string | null {
  if (!racine || !relatif || racine.includes("\0") || relatif.includes("\0") || path.isAbsolute(relatif)) return null;
  if (relatif.split(/[/\\]/).some((s) => !s || s === "." || s === "..")) return null;
  const cible = path.resolve(racine, relatif);
  let reelRacine: string;
  let reelCible: string;
  try {
    reelRacine = realpathSync(racine);
    reelCible = realpathSync(cible);
  } catch {
    return null;
  }
  const rel = path.relative(reelRacine, reelCible);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  try {
    if (!statSync(reelCible).isFile()) return null;
  } catch {
    return null;
  }
  return reelCible;
}
