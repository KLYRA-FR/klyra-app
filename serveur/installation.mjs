/**
 * Installer un moteur publié sur npm, sur le VPS : la même méthode que l'app (electron/moteurs/installation.ts).
 * Le paquet de la plateforme (Codex : `@openai/codex@<v>-linux-x64`) est téléchargé, son empreinte sha512
 * comparée à celle de npm, décompressé avec `tar` et rangé dans `~/.klyra/moteurs/<moteur>/<version>/`.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";

/**
 * Le dossier à ranger, avec le programme dans son `bin/` : `package/vendor/<cible>` (Codex), ou
 * `package/bin/<programme>` éventuellement compressé en brotli (`<programme>.br`, Grok Build), décompressé ici.
 */
function dossierDuProgramme(extrait, executable) {
  const vendor = path.join(extrait, "package", "vendor");
  const cible = (existsSync(vendor) ? readdirSync(vendor) : []).find((c) => existsSync(path.join(vendor, c, "bin", executable)));
  if (cible) return path.join(vendor, cible);
  const bin = path.join(extrait, "package", "bin");
  const sortie = path.join(extrait, "programme");
  mkdirSync(path.join(sortie, "bin"), { recursive: true });
  if (existsSync(path.join(bin, `${executable}.br`))) writeFileSync(path.join(sortie, "bin", executable), brotliDecompressSync(readFileSync(path.join(bin, `${executable}.br`))));
  else if (existsSync(path.join(bin, executable))) renameSync(path.join(bin, executable), path.join(sortie, "bin", executable));
  else throw new Error(`Le paquet ne contient pas ${executable}.`);
  return sortie;
}

/** Le registre npm ; les tests en donnent un faux. */
const registre = () => (process.env.KLYRA_REGISTRE_NPM ?? "https://registry.npmjs.org").replace(/\/$/, "");
const urlPaquet = (paquet, version) => `${registre()}/${paquet.replace("/", "%2F")}/${version}`;

export const dossierMoteurs = (home) => path.join(home, ".klyra", "moteurs");

/** Compare deux versions « 0.164.0 » ; négatif si a est plus ancienne. */
export function comparerVersions(a, b) {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function versionsGerees(home, moteur) {
  const dossier = path.join(dossierMoteurs(home), moteur);
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((v) => /^\d+\.\d+\.\d+/.test(v))
    .sort((a, b) => comparerVersions(b, a));
}

/** Le programme installé par KLYRA pour ce moteur (sa version la plus récente), ou null. */
export function binaireGere(home, moteur, executable) {
  for (const version of versionsGerees(home, moteur)) {
    const chemin = path.join(dossierMoteurs(home), moteur, version, "bin", executable);
    if (existsSync(chemin)) return chemin;
  }
  return null;
}

export const estGere = (home, chemin) => !!chemin && path.resolve(chemin).startsWith(path.resolve(dossierMoteurs(home)) + path.sep);

async function lireJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`npm a répondu ${r.status} pour ${url}.`);
  return r.json();
}

/** La dernière version publiée d'un paquet ; null si npm ne répond pas. */
export async function derniereVersionNpm(paquet) {
  try {
    const meta = await lireJson(urlPaquet(paquet, "latest"));
    return typeof meta.version === "string" ? meta.version : null;
  } catch {
    return null;
  }
}

/** Lance une commande et rend son code et sa sortie (stdout et stderr mêlés). */
export function commande(bin, args, delai, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: options.cwd, env: options.env ?? process.env });
    let sortie = "";
    child.stdout?.on("data", (d) => (sortie += d.toString()));
    child.stderr?.on("data", (d) => (sortie += d.toString()));
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

/** La cible npm de cette machine : « linux-x64 », « linux-arm64 ». */
const plateformeNpm = () => `${process.platform}-${process.arch}`;

async function telecharger(url, fichier, progression) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Téléchargement refusé (${r.status}).`);
  const total = Number(r.headers.get("content-length")) || null;
  const empreinte = createHash("sha512");
  const sortie = createWriteStream(fichier);
  let recu = 0;
  let annonce = 0;
  try {
    for await (const morceau of r.body) {
      empreinte.update(morceau);
      recu += morceau.length;
      if (!sortie.write(morceau)) await new Promise((ok) => sortie.once("drain", ok));
      if (recu - annonce > 1_000_000) {
        annonce = recu;
        progression({ etape: "telechargement", recu, total });
      }
    }
  } finally {
    await new Promise((ok) => sortie.end(ok));
  }
  progression({ etape: "telechargement", recu, total: total ?? recu });
  return `sha512-${empreinte.digest("base64")}`;
}

/** Installe le moteur et rend le chemin de son programme. Les anciennes versions installées par KLYRA sont retirées. */
export async function installerDepuisNpm({ home, moteur, paquet, executable, progression = () => {} }) {
  const version = await derniereVersionNpm(paquet);
  if (!version) throw new Error(`Impossible de lire la dernière version de ${paquet} sur npm.`);
  const meta = await lireJson(urlPaquet(paquet, version));
  const nomPlateforme = `${paquet}-${plateformeNpm()}`;
  const alias = meta.optionalDependencies?.[nomPlateforme];
  if (!alias) throw new Error(`${paquet} ${version} n’existe pas pour ce système (${plateformeNpm()}).`);
  /* Codex : « npm:@openai/codex@0.166.0-linux-x64 » ; Grok Build : « 1.0.70 », le paquet `@xai-official/grok-linux-x64`. */
  const spec = alias.startsWith("npm:") ? alias.slice(4) : `${nomPlateforme}@${alias}`;
  const arobase = spec.lastIndexOf("@");
  const dist = (await lireJson(urlPaquet(spec.slice(0, arobase), spec.slice(arobase + 1)))).dist;
  if (!dist?.tarball || !dist.integrity?.startsWith("sha512-")) throw new Error("npm ne donne pas d’empreinte pour ce paquet : installation refusée.");

  const racine = dossierMoteurs(home);
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
    const r = await commande("tar", ["-xzf", archive, "-C", extrait], 10 * 60_000);
    if (r.code !== 0) throw new Error(`Décompression impossible : ${r.sortie.trim().slice(0, 300)}`);
    const destination = path.join(racine, moteur, version);
    const source = dossierDuProgramme(extrait, executable);
    mkdirSync(path.dirname(destination), { recursive: true });
    rmSync(destination, { recursive: true, force: true });
    renameSync(source, destination);
    for (const nom of readdirSync(path.join(destination, "bin"))) chmodSync(path.join(destination, "bin", nom), 0o755);
    writeFileSync(path.join(destination, "klyra-installation.json"), JSON.stringify({ paquet, version, integrite: dist.integrity, installeLe: new Date().toISOString() }, null, 2));
    for (const ancienne of versionsGerees(home, moteur).filter((v) => v !== version)) {
      rmSync(path.join(racine, moteur, ancienne), { recursive: true, force: true });
    }
    return path.join(destination, "bin", executable);
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}
