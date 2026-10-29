import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { app, net, safeStorage } from "electron";
import os from "node:os";
import path from "node:path";
import { ErreurDictee, TERMES } from "./dictee-commun";
import * as enLigne from "./dictee-elevenlabs";

export { ErreurDictee } from "./dictee-commun";
export { envoyerAudio, fermerSession } from "./dictee-elevenlabs";

/**
 * Dictée en direct, deux moteurs :
 * - en ligne (electron/dictee-elevenlabs.ts), si une clé ElevenLabs est
 *   enregistrée dans les Réglages : le texte revient pendant qu'on parle. La
 *   clé reste ici, chiffrée par le trousseau.
 * - Whisper (whisper.cpp) sur l'ordinateur, sans clé ni réseau : whisper-server,
 *   lancé une fois et gardé en mémoire, transcrit la parole par segments.
 *   Le modèle se télécharge au premier usage, dans ~/.klyra/whisper/.
 * L'interface découpe la parole et affiche le texte (src/lib/dictee/).
 */

/* ─── Modèles locaux ───────────────────────────────────────────── */

export const MODELES = {
  /** Le plus juste ; rapide avec la puce graphique d'un Mac. */
  precis: {
    nom: "Précis",
    fichier: "ggml-large-v3-turbo-q5_0.bin",
    taille: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    /** Contexte audio minimal (cf. contexteAudio) : en dessous, ce modèle invente. */
    plancher: 768,
  },
  /** Trois à cinq fois plus rapide sans carte graphique, presque aussi juste en français. */
  rapide: {
    nom: "Rapide",
    fichier: "ggml-small-q5_1.bin",
    taille: 190_085_487,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    plancher: 384,
  },
} as const;
export type ModeleLocal = keyof typeof MODELES;

/** Le Whisper de Windows est celui du processeur : le modèle rapide. Le Mac a sa puce graphique. */
const MODELE_PAR_DEFAUT: ModeleLocal = process.platform === "darwin" ? "precis" : "rapide";
const DOSSIER_MODELES = path.join(os.homedir(), ".klyra", "whisper");
const SOURCE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
const EXE = process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
/** Les mots du studio, en tête de chaque segment, pour que Whisper les écrive juste. */
const VOCABULAIRE = `${TERMES.join(", ")}.`;
/** Ce que Whisper invente sur un silence (génériques de sous-titres, bruits). */
const HALLUCINATIONS = /sous-titr|merci d'avoir regardé|amara\.org|abonnez-vous/i;
const BRUITS = /\[[^\]]*\]|\((?:musique|rires?|applaudissements|silence|bruit)[^)]*\)|\*[^*]*\*/gi;

const cheminModele = (m: ModeleLocal) => path.join(DOSSIER_MODELES, MODELES[m].fichier);

/* ─── Réglages : modèle choisi, clé ElevenLabs ────────────────── */

interface Reglages {
  modele?: ModeleLocal;
  /** La clé ElevenLabs, chiffrée par le trousseau, en base64. */
  cle?: string;
}

const fichierReglages = () => path.join(app.getPath("userData"), "dictee.json");

async function lireReglages(): Promise<Reglages> {
  try {
    const v = JSON.parse(await readFile(fichierReglages(), "utf8")) as Reglages;
    return { modele: v.modele && v.modele in MODELES ? v.modele : undefined, cle: typeof v.cle === "string" ? v.cle : undefined };
  } catch {
    return {};
  }
}

async function ecrireReglages(r: Reglages) {
  const temporaire = `${fichierReglages()}.tmp`;
  await writeFile(temporaire, JSON.stringify(r), "utf8");
  await rename(temporaire, fichierReglages());
}

async function cle(): Promise<string | null> {
  const r = await lireReglages();
  if (!r.cle) return null;
  try {
    return safeStorage.decryptString(Buffer.from(r.cle, "base64"));
  } catch {
    return null;
  }
}

/** Ce que l'interface sait de la dictée : jamais la clé. */
export interface EtatDictee {
  moteur: "elevenlabs" | "local";
  cleElevenLabs: boolean;
  modele: ModeleLocal;
  modeles: { id: ModeleLocal; nom: string; taille: number; present: boolean }[];
  /** Le modèle choisi est en mémoire : la dictée démarre tout de suite. */
  pret: boolean;
}

export async function etatDictee(): Promise<EtatDictee> {
  const r = await lireReglages();
  const modele = r.modele ?? MODELE_PAR_DEFAUT;
  return {
    moteur: r.cle ? "elevenlabs" : "local",
    cleElevenLabs: !!r.cle,
    modele,
    modeles: (Object.keys(MODELES) as ModeleLocal[]).map((id) => ({
      id,
      nom: MODELES[id].nom,
      taille: MODELES[id].taille,
      present: existsSync(cheminModele(id)),
    })),
    pret: serveur?.modele === modele && serveur.pret,
  };
}

export async function choisirModele(modele: ModeleLocal): Promise<EtatDictee> {
  if (!(modele in MODELES)) throw new Error("Modèle inconnu.");
  await ecrireReglages({ ...(await lireReglages()), modele });
  return etatDictee();
}

/** Vérifie la clé auprès d'ElevenLabs (un jeton, rien n'est facturé), puis la chiffre. */
export async function enregistrerCle(valeur: string): Promise<EtatDictee> {
  const brute = String(valeur ?? "").trim();
  if (!brute) throw new Error("La clé est vide.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le trousseau du système est indisponible : la clé ne peut pas être protégée.");
  await enLigne.jeton(brute);
  await ecrireReglages({ ...(await lireReglages()), cle: safeStorage.encryptString(brute).toString("base64") });
  return etatDictee();
}

export async function retirerCle(): Promise<EtatDictee> {
  const reglages = await lireReglages();
  delete reglages.cle;
  await ecrireReglages(reglages);
  return etatDictee();
}

export async function testerCle(): Promise<void> {
  const valeur = await cle();
  if (!valeur) throw new Error("Aucune clé ElevenLabs.");
  await enLigne.jeton(valeur);
}

/** Une dictée en ligne : rend son identifiant ; le texte revient par `signaler`. */
export async function ouvrirSession(signaler: (id: string, e: enLigne.EvenementDictee) => void): Promise<string> {
  const valeur = await cle();
  if (!valeur) throw new ErreurDictee("cle", "Aucune clé ElevenLabs.");
  return enLigne.ouvrirSession(valeur, signaler);
}

/* ─── Téléchargement du modèle ────────────────────────────────── */

export type Progression = { etape: "telechargement"; recu: number; total: number } | { etape: "chargement" } | { etape: "prete" };

const telechargements = new Map<ModeleLocal, Promise<void>>();

/**
 * Télécharge le modèle une seule fois, à côté puis renommé : jamais de modèle
 * à moitié écrit. Son empreinte est vérifiée avant d'être gardé.
 */
function telecharger(modele: ModeleLocal, suivre: (p: Progression) => void): Promise<void> {
  const enCours = telechargements.get(modele);
  if (enCours) return enCours;
  const promesse = (async () => {
    const { fichier, taille, sha256 } = MODELES[modele];
    await mkdir(DOSSIER_MODELES, { recursive: true });
    let reponse: Response;
    try {
      reponse = await net.fetch(SOURCE + fichier);
    } catch {
      throw new ErreurDictee("reseau", "Pas de connexion : le modèle de dictée ne peut pas se télécharger.");
    }
    if (!reponse.ok || !reponse.body) throw new ErreurDictee("service", `Téléchargement du modèle de dictée impossible (${reponse.status}).`);
    const total = Number(reponse.headers.get("content-length")) || taille;
    const partiel = `${cheminModele(modele)}.partiel`;
    const sortie = createWriteStream(partiel);
    const empreinte = createHash("sha256");
    let recu = 0;
    let signale = 0;
    try {
      const lecteur = reponse.body.getReader();
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        empreinte.update(value);
        recu += value.length;
        if (!sortie.write(value)) await new Promise<void>((r) => sortie.once("drain", () => r()));
        // Une mise à jour par pour-cent : assez pour une barre fluide, sans noyer l'interface.
        if (recu - signale >= total / 100) {
          signale = recu;
          suivre({ etape: "telechargement", recu, total });
        }
      }
      await new Promise<void>((ok, ko) => {
        sortie.once("error", ko);
        sortie.end(ok);
      });
    } catch {
      sortie.destroy();
      await rm(partiel, { force: true });
      throw new ErreurDictee("reseau", "Le téléchargement du modèle s’est interrompu. Réessaie.");
    }
    suivre({ etape: "telechargement", recu: total, total });
    if (empreinte.digest("hex") !== sha256) {
      await rm(partiel, { force: true });
      throw new ErreurDictee("service", "Le modèle téléchargé est abîmé. Réessaie.");
    }
    await rename(partiel, cheminModele(modele));
  })().finally(() => telechargements.delete(modele));
  telechargements.set(modele, promesse);
  return promesse;
}

/* ─── whisper-server, gardé en mémoire ────────────────────────── */

interface Serveur {
  modele: ModeleLocal;
  proc: ChildProcess | null;
  /** Adresse secrète, tirée au hasard : seule l'app peut appeler ce serveur. */
  base: string;
  pret: boolean;
  demarrage: Promise<void>;
}
let serveur: Serveur | null = null;

/** Le Whisper embarqué, sinon celui de Homebrew (une app ouverte depuis le Finder n'a pas le PATH du terminal). */
function trouverWhisper(): string | null {
  const dossiers = [
    path.join(process.resourcesPath ?? "", "whisper"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(path.delimiter),
  ];
  return dossiers.map((d) => path.join(d, EXE)).find((c) => existsSync(c)) ?? null;
}

function portLibre(): Promise<number> {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.once("error", ko);
    s.listen(0, "127.0.0.1", () => {
      const adresse = s.address();
      const port = typeof adresse === "object" && adresse ? adresse.port : 0;
      s.close(() => ok(port));
    });
  });
}

function demarrerServeur(modele: ModeleLocal): Serveur {
  const bin = trouverWhisper();
  if (!bin) throw new ErreurDictee("local", "Whisper est introuvable : réinstalle l’app.");
  const secret = `/${randomBytes(12).toString("hex")}`;
  const s: Serveur = { modele, proc: null, base: "", pret: false, demarrage: Promise.resolve() };
  s.demarrage = (async () => {
    const port = await portLibre();
    s.base = `http://127.0.0.1:${port}${secret}`;
    // Assez de cœurs pour aller vite, sans prendre tout l'ordinateur.
    const fils = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
    const proc = spawn(
      bin,
      ["-m", cheminModele(modele), "-l", "fr", "-nt", "-nf", "-t", fils, "--host", "127.0.0.1", "--port", String(port),
        "--request-path", secret, "--public", path.join(app.getPath("userData"), "whisper-sans-fichiers")],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    s.proc = proc;
    // Si l'app s'arrête brutalement, Whisper resterait en mémoire : la prochaine ouverture le retrouve ici.
    if (proc.pid) writeFileSync(fichierServeur(), JSON.stringify({ pid: proc.pid, base: s.base }));
    let journal = "";
    proc.stderr?.on("data", (d: Buffer) => (journal = (journal + d.toString()).slice(-2000)));
    const arrete = new Promise<never>((_ok, ko) =>
      proc.once("exit", () => {
        if (serveur === s) serveur = null;
        ko(new ErreurDictee("local", `Whisper s’est arrêté : ${journal.trim().split("\n").at(-1) || "erreur inconnue"}.`));
      }),
    );
    arrete.catch(() => {});
    const limite = Date.now() + 120_000;
    while (Date.now() < limite) {
      const sante = await Promise.race([fetch(`${s.base}/health`).then((r) => r.ok, () => false), arrete]);
      if (sante) {
        s.pret = true;
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    proc.kill();
    throw new ErreurDictee("local", "Le modèle de dictée met trop de temps à se charger.");
  })();
  return s;
}

/**
 * Prépare la dictée locale : télécharge le modèle s'il manque, puis le charge
 * en mémoire (une fois pour toute la session de l'app).
 */
export async function preparerLocal(suivre: (p: Progression) => void): Promise<void> {
  const { modele = MODELE_PAR_DEFAUT } = await lireReglages();
  if (!existsSync(cheminModele(modele))) await telecharger(modele, suivre);
  if (serveur && serveur.modele !== modele) arreterServeur();
  if (!serveur?.pret) suivre({ etape: "chargement" });
  serveur ??= demarrerServeur(modele);
  const s = serveur;
  try {
    await s.demarrage;
  } catch (e) {
    if (serveur === s) serveur = null;
    throw e;
  }
  suivre({ etape: "prete" });
}

/** Depuis les Réglages : le modèle choisi se télécharge sans être chargé (le secours hors ligne d'ElevenLabs). */
export async function telechargerModele(suivre: (p: Progression) => void): Promise<EtatDictee> {
  const { modele = MODELE_PAR_DEFAUT } = await lireReglages();
  if (!existsSync(cheminModele(modele))) await telecharger(modele, suivre);
  return etatDictee();
}

/** Le survol du micro : le modèle déjà téléchargé se charge en avance (sauf avec ElevenLabs). */
export async function prechauffer(): Promise<void> {
  const { modele = MODELE_PAR_DEFAUT, cle: avecCle } = await lireReglages();
  if (avecCle || serveur || !existsSync(cheminModele(modele))) return;
  serveur = demarrerServeur(modele);
  const s = serveur;
  s.demarrage.catch(() => serveur === s && (serveur = null));
}

/**
 * Whisper lit toujours 30 s d'audio : pour un segment court, on réduit son
 * contexte (50 trames par seconde), trois à dix fois plus rapide. Sous le
 * plancher du modèle, il invente.
 */
function contexteAudio(octetsWav: number, modele: ModeleLocal): number {
  const secondes = (octetsWav - 44) / 32_000;
  return Math.min(1500, Math.max(MODELES[modele].plancher, Math.ceil((secondes * 50 + 64) / 64) * 64));
}

/** Le texte d'un segment (WAV 16 kHz mono), par le Whisper gardé en mémoire. */
export async function transcrireSegment(wav: Uint8Array, precedent: string): Promise<string> {
  const s = serveur;
  if (!s?.pret) throw new ErreurDictee("local", "La dictée locale n’est pas prête.");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voix.wav");
  form.append("response_format", "text");
  form.append("temperature", "0");
  form.append("audio_ctx", String(contexteAudio(wav.byteLength, s.modele)));
  // La fin du texte déjà dicté, pour que la phrase continue juste (ponctuation, majuscules).
  form.append("prompt", `${VOCABULAIRE} ${precedent.slice(-200)}`.trim());
  const reponse = await fetch(`${s.base}/inference`, { method: "POST", body: form });
  if (!reponse.ok) throw new ErreurDictee("local", `Whisper n’a pas pu transcrire (${reponse.status}).`);
  const texte = (await reponse.text()).replace(BRUITS, " ").replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.test(texte) ? "" : texte;
}

/** Le Whisper en mémoire (pid et adresse secrète), tant qu'il tourne. */
const fichierServeur = () => path.join(app.getPath("userData"), "whisper-server.json");

function arreterServeur() {
  serveur?.proc?.kill();
  serveur = null;
  rmSync(fichierServeur(), { force: true });
}

/** À la fermeture de l'app : Whisper et les sessions ElevenLabs s'arrêtent. */
export function arreterDictee() {
  arreterServeur();
  enLigne.fermerSessions();
}

/**
 * À l'ouverture : un Whisper resté en mémoire après un arrêt brutal de l'app
 * est arrêté. Seulement s'il répond à son adresse secrète : c'est bien le
 * nôtre, pas un autre programme qui aurait repris son numéro.
 */
export async function nettoyerServeurOrphelin(): Promise<void> {
  let ancien: { pid?: unknown; base?: unknown };
  try {
    ancien = JSON.parse(await readFile(fichierServeur(), "utf8")) as typeof ancien;
  } catch {
    return;
  }
  const actuel = ancien.pid === serveur?.proc?.pid;
  if (!actuel && typeof ancien.pid === "number" && typeof ancien.base === "string" && ancien.base.startsWith("http://127.0.0.1:")) {
    const reponse = await fetch(`${ancien.base}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (reponse && (reponse.status === 200 || reponse.status === 503)) {
      try {
        process.kill(ancien.pid);
      } catch {
        /* déjà arrêté */
      }
    }
  }
  if (!serveur) await rm(fichierServeur(), { force: true });
}
