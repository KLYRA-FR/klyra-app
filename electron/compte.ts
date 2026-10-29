import { app, safeStorage } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

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
  return app.isPackaged ? DEPLOIEMENTS.production : DEPLOIEMENTS.developpement;
}

/** `connect-src` : le client Convex passe par https et par un WebSocket. */
export function sourcesConvex(): string[] {
  const adresse = adresseConvex();
  return [adresse, adresse.replace(/^https:/, "wss:")];
}

/* ─── Jetons de session ───────────────────────────────────────── */

/** Les clés que Convex Auth écrit : son préfixe, puis l'espace de noms du déploiement. */
const CLE_JETON = /^__convexAuth[A-Za-z]+_[A-Za-z0-9]{1,200}$/;
const TAILLE_MAX = 16 * 1024;

const fichierJetons = () => path.join(app.getPath("userData"), "compte.json");

/** En mémoire, en clair ; sur le disque, chiffrées. Sans trousseau, rien n'est écrit. */
let jetons: Map<string, string> | null = null;
let ecriture: Promise<void> = Promise.resolve();

function charger(): Map<string, string> {
  if (jetons) return jetons;
  jetons = new Map();
  if (!safeStorage.isEncryptionAvailable() || !existsSync(fichierJetons())) return jetons;
  try {
    const brut = JSON.parse(readFileSync(fichierJetons(), "utf8")) as Record<string, unknown>;
    for (const [cle, valeur] of Object.entries(brut)) {
      if (CLE_JETON.test(cle) && typeof valeur === "string") jetons.set(cle, safeStorage.decryptString(Buffer.from(valeur, "base64")));
    }
  } catch {
    /* Fichier illisible ou trousseau changé : il faudra se reconnecter. */
    jetons.clear();
  }
  return jetons;
}

function enregistrer(): Promise<void> {
  const contenu = charger();
  ecriture = ecriture.then(async () => {
    if (!safeStorage.isEncryptionAvailable()) return;
    const chiffre = Object.fromEntries([...contenu].map(([cle, valeur]) => [cle, safeStorage.encryptString(valeur).toString("base64")]));
    const temporaire = `${fichierJetons()}.tmp`;
    await writeFile(temporaire, JSON.stringify(chiffre), { encoding: "utf8", mode: 0o600 });
    await rename(temporaire, fichierJetons());
  });
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
  charger().set(nom, valeur);
  await enregistrer();
}

export async function retirerJeton(cle: unknown): Promise<void> {
  if (charger().delete(verifierCle(cle))) await enregistrer();
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

/**
 * L'app installée ouvre les liens `klyra://`. Pas en développement : la version de
 * développement prendrait les liens de l'app installée sur le même poste.
 */
export function enregistrerProtocole(): void {
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOLE);
}
