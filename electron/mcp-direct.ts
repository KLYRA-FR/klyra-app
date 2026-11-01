import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Les MCP directs de la Marketplace : une app connue (GitHub, Linear, Supabase…)
 * ou un serveur MCP saisi à la main, branché sans passer par Composio. Pour qui
 * n'a besoin que d'un ou deux outils.
 *
 * Le jeton est chiffré par le trousseau du système (safeStorage) dans
 * userData/mcp-direct.json, comme les clés des autres IA. Il ne revient jamais
 * vers l'écran : il part seulement dans la configuration MCP des agents.
 */

/** Les apps connues : leur serveur MCP distant officiel, qui accepte un jeton en Bearer. */
export const APPS_MCP = {
  github: { nom: "GitHub", url: "https://api.githubcopilot.com/mcp/", jeton: "https://github.com/settings/personal-access-tokens" },
  linear: { nom: "Linear", url: "https://mcp.linear.app/mcp", jeton: "https://linear.app/settings/account/security" },
  supabase: { nom: "Supabase", url: "https://mcp.supabase.com/mcp", jeton: "https://supabase.com/dashboard/account/tokens" },
  neon: { nom: "Neon", url: "https://mcp.neon.tech/mcp", jeton: "https://console.neon.tech/app/settings/api-keys" },
  stripe: { nom: "Stripe", url: "https://mcp.stripe.com", jeton: "https://dashboard.stripe.com/apikeys" },
} as const;
export type AppMcp = keyof typeof APPS_MCP;

interface McpStocke {
  id: string;
  /** L'app du catalogue, ou `null` pour un serveur saisi à la main. */
  app: AppMcp | null;
  nom: string;
  url: string;
  /** Le jeton, chiffré par le trousseau, en base64 ; `null` si le serveur n'en demande pas. */
  jeton: string | null;
}

/** Ce que l'interface voit d'un MCP direct : tout, sauf le jeton. */
export type McpDirect = Omit<McpStocke, "jeton"> & { avecJeton: boolean };

const fichier = () => path.join(app.getPath("userData"), "mcp-direct.json");

/** Gardée en mémoire : la configuration des agents se construit sans attendre le disque. */
let cache: McpStocke[] = [];

async function lire(): Promise<McpStocke[]> {
  try {
    const v = JSON.parse(await readFile(fichier(), "utf8")) as unknown;
    return Array.isArray(v) ? (v as McpStocke[]) : [];
  } catch {
    return [];
  }
}

async function ecrire(liste: McpStocke[]) {
  const temporaire = `${fichier()}.tmp`;
  await writeFile(temporaire, JSON.stringify(liste), { encoding: "utf8", mode: 0o600 });
  await rename(temporaire, fichier());
  cache = liste;
}

const vue = (m: McpStocke): McpDirect => ({ id: m.id, app: m.app, nom: m.nom, url: m.url, avecJeton: m.jeton !== null });

/** Lit la liste une fois, à l'ouverture de l'app. */
export async function chargerMcpDirects(): Promise<void> {
  cache = await lire();
}

export async function listerMcpDirects(): Promise<McpDirect[]> {
  return (await lire()).map(vue);
}

/** L'adresse doit être en https (sauf un serveur local). */
function verifierUrl(url: string): string {
  let u: URL;
  try { u = new URL(url.trim()); }
  catch { throw new Error("Cette adresse n’est pas valide."); }
  if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("L’adresse doit commencer par https://.");
  return u.toString();
}

export async function ajouterMcpDirect(entree: { app: string | null; nom?: string; url?: string; jeton?: string }): Promise<McpDirect[]> {
  const connue = entree.app ? APPS_MCP[entree.app as AppMcp] : null;
  if (entree.app && !connue) throw new Error("App inconnue.");
  const nom = (connue?.nom ?? String(entree.nom ?? "").trim()).slice(0, 40);
  const url = verifierUrl(connue?.url ?? String(entree.url ?? ""));
  const jeton = String(entree.jeton ?? "").trim();
  if (!nom) throw new Error("Il manque le nom du serveur.");
  if (connue && !jeton) throw new Error(`Il manque le jeton ${connue.nom}.`);
  if (jeton && !safeStorage.isEncryptionAvailable()) throw new Error("Le trousseau du système est indisponible : le jeton ne peut pas être protégé.");
  const liste = await lire();
  if (connue && liste.some((m) => m.app === entree.app)) throw new Error(`${connue.nom} est déjà connecté.`);
  if (liste.some((m) => m.nom.toLowerCase() === nom.toLowerCase())) throw new Error(`Un serveur s’appelle déjà « ${nom} ».`);
  liste.push({
    id: randomUUID(),
    app: connue ? (entree.app as AppMcp) : null,
    nom,
    url,
    jeton: jeton ? safeStorage.encryptString(jeton).toString("base64") : null,
  });
  await ecrire(liste);
  return liste.map(vue);
}

export async function retirerMcpDirect(id: string): Promise<McpDirect[]> {
  const liste = (await lire()).filter((m) => m.id !== id);
  await ecrire(liste);
  return liste.map(vue);
}

/** Le nom du serveur côté Claude Code : ses outils s'appellent `mcp__<nom>__…`. */
function nomServeur(m: McpStocke): string {
  return m.app ?? `mcp-${m.id.slice(0, 8)}`;
}

/** Les serveurs à ajouter à la configuration MCP d'un agent. Un jeton illisible écarte son serveur. */
export function serveursMcpDirects(): Record<string, { type: "http"; url: string; headers?: Record<string, string> }> {
  const serveurs: Record<string, { type: "http"; url: string; headers?: Record<string, string> }> = {};
  for (const m of cache) {
    let jeton: string | null = null;
    if (m.jeton) {
      try { jeton = safeStorage.decryptString(Buffer.from(m.jeton, "base64")); }
      catch { continue; }
    }
    serveurs[nomServeur(m)] = { type: "http", url: m.url, ...(jeton ? { headers: { Authorization: `Bearer ${jeton}` } } : {}) };
  }
  return serveurs;
}
