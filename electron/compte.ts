import { app, safeStorage } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { lienRejoindre } from "./lien-rejoindre";

/**
 * Le compte d'équipe (Convex, cf. `docs/CONVEX-PLAN.md`) côté système :
 * - l'adresse du déploiement Convex, que la CSP autorise ;
 * - les jetons de session de Convex Auth, chiffrés par le trousseau du système (safeStorage) ;
 * - les liens `klyra://connexion?code=…` ouverts depuis l'e-mail de connexion.
 */

/** Les adresses ne sont pas secrètes : seuls les jetons de session le sont. */
const DEPLOIEMENTS = {
  production: "https://calculating-cuttlefish-710.eu-west-1.convex.cloud",
  developpement: "https://coordinated-ox-134.eu-west-1.convex.cloud",
} as const;

/** L'app installée parle à la production, `pnpm desktop` au déploiement de développement. */
export function adresseConvex(): string {
  const forcee = process.env.KLYRA_CONVEX_URL;
  if (forcee && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.convex\.cloud$/.test(forcee)) return forcee;
  // Tests (`pnpm test:profil`) : un backend Convex local et jetable, jamais dans l'app installée.
  if (forcee && !app.isPackaged && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(forcee)) return forcee;
  return app.isPackaged ? DEPLOIEMENTS.production : DEPLOIEMENTS.developpement;
}

/** `connect-src` : le client Convex passe par https et par un WebSocket. */
export function sourcesConvex(): string[] {
  const adresse = adresseConvex();
  return [adresse, adresse.replace(/^http(s?):/, "ws$1:")];
}

/* ─── Jetons de session ───────────────────────────────────────── */

/** Les clés que Convex Auth écrit : son préfixe, puis l'espace de noms du déploiement. */
const CLE_JETON = /^__convexAuth[A-Za-z]+_[A-Za-z0-9]{1,200}$/;
const TAILLE_MAX = 16 * 1024;

const fichierJetons = () => path.join(app.getPath("userData"), "compte.json");

/**
 * En mémoire, en clair ; sur le disque, chiffrées. Sans trousseau, rien n'est écrit.
 * Convex Auth fait tourner le jeton de rafraîchissement : le serveur n'accepte que le dernier
 * (ou celui juste avant). Le disque doit donc toujours finir par avoir le dernier : une écriture
 * ratée est réessayée, et ne bloque jamais les suivantes. Sinon, au redémarrage suivant (souvent
 * celui d'une mise à jour), le jeton relu est refusé et la session est perdue.
 */
const jetons = new Map<string, string>();
/** Les entrées que le trousseau n'a pas su déchiffrer : gardées telles quelles, jamais effacées en silence. */
const illisibles = new Map<string, string>();
/** Le fichier n'est relu qu'une fois le trousseau disponible : un trousseau pas encore prêt ne vaut pas « aucune session ». */
let fichierLu = false;
let ecriture: Promise<void> = Promise.resolve();
let reprise: NodeJS.Timeout | null = null;
let echecsDeSuite = 0;
let revisionSession = 0;
/** Monotone : local → équipe → local ne réactive jamais une ancienne capacité d'outil. */
export const revisionCompte = () => revisionSession;

function charger(): Map<string, string> {
  if (fichierLu || !safeStorage.isEncryptionAvailable()) return jetons;
  fichierLu = true;
  if (!existsSync(fichierJetons())) return jetons;
  let brut: Record<string, unknown>;
  try {
    brut = JSON.parse(readFileSync(fichierJetons(), "utf8")) as Record<string, unknown>;
  } catch {
    console.warn("[compte] compte.json est illisible : pas de session à reprendre.");
    return jetons;
  }
  for (const [cle, valeur] of Object.entries(brut)) {
    // Une valeur écrite en mémoire avant que le trousseau soit prêt est plus récente que le fichier.
    if (!CLE_JETON.test(cle) || typeof valeur !== "string" || jetons.has(cle)) continue;
    try {
      jetons.set(cle, safeStorage.decryptString(Buffer.from(valeur, "base64")));
    } catch {
      illisibles.set(cle, valeur);
    }
  }
  if (illisibles.size > 0) console.warn(`[compte] ${illisibles.size} jeton(s) que le trousseau ne déchiffre pas : gardés sur le disque.`);
  return jetons;
}

/** Fichier tenu un instant par un autre programme (antivirus, indexation sous Windows) : on réessaie. */
const VERROU = new Set(["EPERM", "EBUSY", "EACCES"]);
const ATTENTES_RENOMMAGE_MS = [100, 400, 1500];

async function ecrireFichier(): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) return;
  charger();
  // Toujours l'état en mémoire au moment d'écrire : une écriture ratée est rattrapée par la suivante.
  const chiffre = Object.fromEntries([
    ...illisibles,
    ...[...jetons].map(([cle, valeur]) => [cle, safeStorage.encryptString(valeur).toString("base64")]),
  ]);
  const temporaire = `${fichierJetons()}.tmp`;
  await writeFile(temporaire, JSON.stringify(chiffre), { encoding: "utf8", mode: 0o600 });
  for (let essai = 0; ; essai++) {
    try {
      await rename(temporaire, fichierJetons());
      return;
    } catch (erreur) {
      const code = (erreur as NodeJS.ErrnoException).code ?? "";
      if (essai >= ATTENTES_RENOMMAGE_MS.length || !VERROU.has(code)) throw erreur;
      await new Promise((r) => setTimeout(r, ATTENTES_RENOMMAGE_MS[essai]));
    }
  }
}

/** Une écriture ratée est réessayée un peu plus tard (au plus 5 fois de suite), sans attendre le prochain jeton. */
function planifierReprise() {
  if (reprise || echecsDeSuite > 5) return;
  reprise = setTimeout(() => {
    reprise = null;
    void enregistrer();
  }, 2000 * echecsDeSuite);
  reprise.unref?.();
}

/** Ne rejette jamais : la session reste valable en mémoire, et le disque est rattrapé dès que possible. */
function enregistrer(): Promise<void> {
  ecriture = ecriture.then(ecrireFichier).then(
    () => {
      echecsDeSuite = 0;
    },
    (erreur: unknown) => {
      echecsDeSuite++;
      console.error(`[compte] jetons de session pas écrits sur le disque (${erreur instanceof Error ? erreur.message : String(erreur)}) : nouvel essai.`);
      planifierReprise();
    },
  );
  return ecriture;
}

/** Pour la fermeture de l'app (une mise à jour, par exemple) : les jetons en cours d'écriture. */
export function jetonsEcrits(): Promise<void> {
  return ecriture;
}

function verifierCle(cle: unknown): string {
  if (typeof cle !== "string" || !CLE_JETON.test(cle)) throw new Error("Clé de session invalide.");
  return cle;
}

export function lireJeton(cle: unknown): string | null {
  return charger().get(verifierCle(cle)) ?? null;
}

export async function ecrireJeton(cle: unknown, valeur: unknown): Promise<void> {
  const nom = verifierCle(cle);
  if (typeof valeur !== "string" || valeur.length > TAILLE_MAX) throw new Error("Jeton de session invalide.");
  if (nom.startsWith("__convexAuthJWT_") && charger().get(nom) !== valeur) revisionSession++;
  charger().set(nom, valeur);
  illisibles.delete(nom);
  await enregistrer();
}

export async function retirerJeton(cle: unknown): Promise<void> {
  const nom = verifierCle(cle);
  const illisible = illisibles.delete(nom);
  if (charger().delete(nom)) {
    if (nom.startsWith("__convexAuthJWT_")) revisionSession++;
    await enregistrer();
  } else if (illisible) await enregistrer();
}

/* ─── Liens de connexion ──────────────────────────────────────── */

export const PROTOCOLE = "klyra";

/** Le code généré par Convex Auth : 32 caractères alphanumériques (comme `convex/model/contenus.ts`). */
const CODE = /^[A-Za-z0-9]{16,128}$/;

/** Le code d'un lien `klyra://connexion?code=…`, ou null. */
export function codeDuLien(lien: unknown): string | null {
  if (typeof lien !== "string" || lien.length > 512) return null;
  try {
    const url = new URL(lien);
    if (url.protocol !== `${PROTOCOLE}:` || url.hostname !== "connexion") return null;
    const code = url.searchParams.get("code");
    return code && CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** Le dernier code reçu, que l'interface vient prendre (une seule fois). */
let codeEnAttente: string | null = null;

export function recevoirLien(lien: unknown): boolean {
  const code = codeDuLien(lien);
  if (code === null) return false;
  codeEnAttente = code;
  return true;
}

export function prendreCode(): string | null {
  const code = codeEnAttente;
  codeEnAttente = null;
  return code;
}

/** Le dernier lien `klyra://rejoindre`, que l’écran Serveurs vient prendre (une seule fois). */
let lienServeurEnAttente: string | null = null;

export function recevoirLienRejoindre(lien: unknown): boolean {
  const recu = lienRejoindre(lien);
  if (recu === null) return false;
  lienServeurEnAttente = recu;
  return true;
}

export function prendreLienRejoindre(): string | null {
  const lien = lienServeurEnAttente;
  lienServeurEnAttente = null;
  return lien;
}

/**
 * L'app installée ouvre les liens `klyra://`. Pas en développement : la version de
 * développement prendrait les liens de l'app installée sur le même poste.
 */
export function enregistrerProtocole(): void {
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOLE);
}
