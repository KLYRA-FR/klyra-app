import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { net } from "electron";
import os from "node:os";
import path from "node:path";

/**
 * Dictée : l'audio enregistré dans l'app est transcrit sur le Mac par Whisper
 * (whisper.cpp, `brew install whisper-cpp`), rien ne sort de l'ordinateur.
 * Le modèle est rangé dans ~/.klyra/whisper/ ; absent, il se télécharge au premier usage.
 */

const MODELE = path.join(os.homedir(), ".klyra", "whisper", "ggml-large-v3-turbo-q5_0.bin");
const SOURCE_MODELE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
/** Une app lancée depuis le Finder n'a pas le PATH du terminal : on cherche aux endroits de Homebrew. */
const DOSSIERS = ["/opt/homebrew/bin", "/usr/local/bin", ...(process.env.PATH ?? "").split(path.delimiter)];
/** Les mots du studio, pour que Whisper les écrive juste. */
const VOCABULAIRE = "KLYRA, localhost, Next.js, Figma, Vercel, Claude, Pelin, Corentin, commit, push.";
/** Ce que Whisper invente sur un silence (génériques de sous-titres). */
const HALLUCINATIONS = /sous-titr|merci d'avoir regardé|amara\.org|abonnez-vous/i;

function trouver(nom: string): string | null {
  return DOSSIERS.map((d) => path.join(d, nom)).find((c) => existsSync(c)) ?? null;
}

function lancer(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (erreur, sortie, stderr) => {
      if (erreur) reject(new Error(stderr.trim().split("\n").at(-1) || erreur.message));
      else resolve(sortie);
    });
  });
}

let telechargement: Promise<void> | null = null;

/** Télécharge le modèle (550 Mo) une seule fois, à côté puis renommé : jamais de modèle à moitié écrit. */
function telechargerModele(): Promise<void> {
  telechargement ??= (async () => {
    await mkdir(path.dirname(MODELE), { recursive: true });
    const reponse = await net.fetch(SOURCE_MODELE);
    if (!reponse.ok) throw new Error(`Téléchargement du modèle de dictée impossible (${reponse.status}).`);
    const partiel = `${MODELE}.partiel`;
    await writeFile(partiel, Buffer.from(await reponse.arrayBuffer()));
    await rename(partiel, MODELE);
  })().finally(() => {
    telechargement = null;
  });
  return telechargement;
}

/** Le texte dit dans l'enregistrement (audio WebM de l'app). */
export async function transcrire(audio: Uint8Array): Promise<string> {
  const whisper = trouver("whisper-cli");
  const ffmpeg = trouver("ffmpeg");
  if (!whisper || !ffmpeg) throw new Error("La dictée a besoin de Whisper et ffmpeg : brew install whisper-cpp ffmpeg");
  if (!existsSync(MODELE)) {
    void telechargerModele().catch(() => {});
    throw new Error("Première dictée : le modèle (550 Mo) se télécharge. Réessaie dans quelques minutes.");
  }

  const dossier = await mkdtemp(path.join(os.tmpdir(), "klyra-dictee-"));
  try {
    const source = path.join(dossier, "voix.webm");
    const wav = path.join(dossier, "voix.wav");
    await writeFile(source, audio);
    // Whisper lit du WAV 16 kHz mono.
    await lancer(ffmpeg, ["-y", "-loglevel", "error", "-i", source, "-ar", "16000", "-ac", "1", wav]);
    const sortie = await lancer(whisper, ["-m", MODELE, "-l", "fr", "-nt", "-np", "--prompt", VOCABULAIRE, "-f", wav]);
    const texte = sortie.replace(/\s+/g, " ").trim();
    return HALLUCINATIONS.test(texte) ? "" : texte;
  } finally {
    void rm(dossier, { recursive: true, force: true });
  }
}
