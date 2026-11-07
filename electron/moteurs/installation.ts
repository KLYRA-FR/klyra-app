import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import type { Progression } from "./types";

/** Les moteurs que l'app installe elle-même, rangés par version : `~/.klyra/moteurs/<moteur>/<version>/`. */
export const dossierMoteurs = () => path.join(os.homedir(), ".klyra", "moteurs");

/** Compare deux versions « 0.164.0 » ; négatif si a est plus ancienne. */
export function comparerVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Les versions installées par l'app, la plus récente d'abord. */
export function versionsGerees(moteur: string): string[] {
  const dossier = path.join(dossierMoteurs(), moteur);
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((v) => /^\d+\.\d+\.\d+/.test(v))
    .sort((a, b) => comparerVersions(b, a));
}

/** Le programme installé par l'app pour ce moteur (sa version la plus récente), ou null. */
export function binaireGere(moteur: string, executable: string): string | null {
  for (const version of versionsGerees(moteur)) {
    const chemin = path.join(dossierMoteurs(), moteur, version, "bin", executable);
    if (existsSync(chemin)) return chemin;
  }
  return null;
}

/** Ce programme a été installé par l'app (et c'est donc elle qui le met à jour). */
export const estGere = (chemin: string | null) => !!chemin && path.resolve(chemin).startsWith(path.resolve(dossierMoteurs()) + path.sep);

/* ─── npm ──────────────────────────────────────────────────────── */

/** Le registre npm ; les tests en donnent un faux. */
const registre = () => (process.env.KLYRA_REGISTRE_NPM ?? "https://registry.npmjs.org").replace(/\/$/, "");
const urlPaquet = (paquet: string, version: string) => `${registre()}/${paquet.replace("/", "%2F")}/${version}`;

/** La cible npm de ce poste : « win32-x64 », « darwin-arm64 »… */
export const plateformeNpm = () => `${process.platform}-${process.arch}`;

async function lireJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`npm a répondu ${r.status} pour ${url}.`);
  return (await r.json()) as Record<string, unknown>;
}

/** La dernière version publiée d'un paquet ; null si npm ne répond pas. */
export async function derniereVersionNpm(paquet: string): Promise<string | null> {
  try {
    const meta = await lireJson(urlPaquet(paquet, "latest"));
    return typeof meta.version === "string" ? meta.version : null;
  } catch {
    return null;
  }
}

/** Lance une commande et rend son code et sa sortie (stdout et stderr mêlés). */
export function commande(bin: string, args: string[], delai: number, cwd = os.homedir()): Promise<{ code: number | null; sortie: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    let sortie = "";
    child.stdout?.on("data", (d: Buffer) => (sortie += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (sortie += d.toString()));
    const minuterie = setTimeout(() => child.kill("SIGTERM"), delai);
    child.on("error", (error) => {
      clearTimeout(minuterie);
      resolve({ code: null, sortie: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(minuterie);
      resolve({ code, sortie });
    });
  });
}

/** `tar` du système : sous Windows, celui de System32 (présent depuis Windows 10). */
function tar(): string {
  const windows = process.env.SystemRoot && path.join(process.env.SystemRoot, "System32", "tar.exe");
  return windows && existsSync(windows) ? windows : "tar";
}

/** Télécharge en comptant et en calculant l'empreinte sha512 au passage ; rend l'empreinte au format npm. */
async function telecharger(url: string, fichier: string, progression: (p: Progression) => void): Promise<string> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Téléchargement refusé (${r.status}).`);
  const total = Number(r.headers.get("content-length")) || null;
  const empreinte = createHash("sha512");
  const sortie = createWriteStream(fichier);
  let recu = 0;
  let annonce = 0;
  try {
    for await (const morceau of r.body as unknown as AsyncIterable<Uint8Array>) {
      empreinte.update(morceau);
      recu += morceau.length;
      if (!sortie.write(morceau)) await new Promise<void>((ok) => sortie.once("drain", () => ok()));
      if (recu - annonce > 1_000_000) {
        annonce = recu;
        progression({ etape: "telechargement", recu, total });
      }
    }
  } finally {
    await new Promise<void>((ok) => sortie.end(ok));
  }
  progression({ etape: "telechargement", recu, total: total ?? recu });
  return `sha512-${empreinte.digest("base64")}`;
}

/**
 * Le dossier à ranger, avec le programme dans son `bin/` : `package/vendor/<cible>` (Codex), ou
 * `package/bin/<programme>` éventuellement compressé en brotli (`<programme>.br`, Grok Build), décompressé ici.
 */
function dossierDuProgramme(extrait: string, executable: string): string {
  const vendor = path.join(extrait, "package", "vendor");
  const cible = (existsSync(vendor) ? readdirSync(vendor) : []).find((c) => existsSync(path.join(vendor, c, "bin", executable)));
  if (cible) return path.join(vendor, cible);
  const bin = path.join(extrait, "package", "bin");
  const sortie = path.join(extrait, "programme");
  mkdirSync(path.join(sortie, "bin"), { recursive: true });
  if (existsSync(path.join(bin, `${executable}.br`))) writeFileSync(path.join(sortie, "bin", executable), brotliDecompressSync(readFileSync(path.join(bin, `${executable}.br`))));
  else if (existsSync(path.join(bin, executable))) renameSync(path.join(bin, executable), path.join(sortie, "bin", executable));
  // Claude Code peut livrer son binaire directement à la racine du paquet de plateforme.
  else if (existsSync(path.join(extrait, "package", executable))) renameSync(path.join(extrait, "package", executable), path.join(sortie, "bin", executable));
  else throw new Error(`Le paquet ne contient pas ${executable}.`);
  return sortie;
}

/**
 * Installe un moteur publié sur npm avec un paquet par plateforme (Codex : `@openai/codex@<v>-win32-x64` ;
 * Grok Build : `@xai-official/grok-win32-x64@<v>`) :
 * téléchargé, empreinte sha512 comparée à celle de npm, décompressé avec `tar`, et rangé dans
 * `~/.klyra/moteurs/<moteur>/<version>/` (le dossier `vendor/<cible>` du paquet). Rend le chemin du programme.
 * Les anciennes versions de l'app sont retirées ; celle du poste n'est jamais touchée.
 */
export async function installerDepuisNpm(o: { moteur: string; paquet: string; executable: string; version?: string; progression?: (p: Progression) => void }): Promise<string> {
  const progression = o.progression ?? (() => {});
  const version = o.version ?? (await derniereVersionNpm(o.paquet));
  if (!version) throw new Error(`Impossible de lire la dernière version de ${o.paquet} sur npm.`);
  const meta = await lireJson(urlPaquet(o.paquet, version));
  const nomPlateforme = `${o.paquet}-${plateformeNpm()}`;
  const alias = (meta.optionalDependencies as Record<string, string> | undefined)?.[nomPlateforme];
  if (!alias) throw new Error(`${o.paquet} ${version} n’existe pas pour ce système (${plateformeNpm()}).`);
  // Codex : « npm:@openai/codex@0.166.0-win32-x64 » ; Grok Build : « 1.0.70 », le paquet `@xai-official/grok-linux-x64`.
  const spec = alias.startsWith("npm:") ? alias.slice(4) : `${nomPlateforme}@${alias}`;
  const arobase = spec.lastIndexOf("@");
  const dist = (await lireJson(urlPaquet(spec.slice(0, arobase), spec.slice(arobase + 1)))).dist as { tarball?: string; integrity?: string } | undefined;
  if (!dist?.tarball || !dist.integrity?.startsWith("sha512-")) throw new Error("npm ne donne pas d’empreinte pour ce paquet : installation refusée.");

  const racine = dossierMoteurs();
  const travail = path.join(racine, `.installation-${randomBytes(6).toString("hex")}`);
  mkdirSync(travail, { recursive: true });
  try {
    const archive = path.join(travail, "paquet.tgz");
    const empreinte = await telecharger(dist.tarball, archive, progression);
    progression({ etape: "verification", recu: 0, total: null });
    if (empreinte !== dist.integrity) throw new Error("L’empreinte du téléchargement ne correspond pas à celle de npm : installation refusée.");

    progression({ etape: "installation", recu: 0, total: null });
    const extrait = path.join(travail, "extrait");
    mkdirSync(extrait);
    const r = await commande(tar(), ["-xzf", archive, "-C", extrait], 10 * 60_000);
    if (r.code !== 0) throw new Error(`Décompression impossible : ${r.sortie.trim().slice(0, 300)}`);
    const destination = path.join(racine, o.moteur, version);
    const source = dossierDuProgramme(extrait, o.executable);
    mkdirSync(path.dirname(destination), { recursive: true });
    rmSync(destination, { recursive: true, force: true });
    renameSync(source, destination);
    if (process.platform !== "win32") {
      for (const nom of readdirSync(path.join(destination, "bin"))) chmodSync(path.join(destination, "bin", nom), 0o755);
    }
    writeFileSync(path.join(destination, "klyra-installation.json"), JSON.stringify({ paquet: o.paquet, version, integrite: dist.integrity, installeLe: new Date().toISOString() }, null, 2));
    // Les versions précédentes : retirées, sauf si un programme les tient encore (Windows).
    for (const ancienne of versionsGerees(o.moteur).filter((v) => v !== version)) {
      try {
        rmSync(path.join(racine, o.moteur, ancienne), { recursive: true, force: true });
      } catch {
        /* encore ouverte : elle partira à la prochaine installation */
      }
    }
    return path.join(destination, "bin", o.executable);
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}
