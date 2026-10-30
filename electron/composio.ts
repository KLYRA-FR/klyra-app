import { app, dialog, net, safeStorage, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ComposioApi } from "./composio-api";
import { EspaceComposio, type ConfigurationComposio } from "./composio-espace";
import { identiteComposio, revisionIdentiteComposio } from "./composio-identite";

function coffreDisponible(): boolean {
  return safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
}

function fichier(scope: string): string {
  if (scope !== "local" && !/^[a-f0-9]{64}$/.test(scope)) throw new Error("Profil Composio invalide.");
  return path.join(app.getPath("userData"), `composio-${scope}.json`);
}

async function lire(scope: string): Promise<ConfigurationComposio | null> {
  let brut: string;
  try { brut = await readFile(fichier(scope), "utf8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("La configuration locale de Composio ne peut pas être lue.");
  }
  if (!coffreDisponible()) throw new Error("Le coffre du système est indisponible. Aucun compte Composio n’est accessible.");
  try {
    const enveloppe = JSON.parse(brut) as { version: unknown; contenu: unknown };
    if (enveloppe.version !== 1 || typeof enveloppe.contenu !== "string" || enveloppe.contenu.length > 128_000) throw new Error();
    const config = JSON.parse(safeStorage.decryptString(Buffer.from(enveloppe.contenu, "base64"))) as ConfigurationComposio;
    if (!/^klyra_[a-f0-9-]{36}$/.test(config.userId) || (config.cle !== null && typeof config.cle !== "string")) throw new Error();
    if (!config.selections || typeof config.selections !== "object" || Array.isArray(config.selections) || !Array.isArray(config.enAttente)) throw new Error();
    for (const [service, id] of Object.entries(config.selections)) {
      if (!/^[a-z0-9_-]{1,160}$/.test(service) || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error();
    }
    if (config.enAttente.length > 20 || !config.enAttente.every((a) => typeof a.compteId === "string" && typeof a.service === "string" && (a.expireLe === null || typeof a.expireLe === "string"))) throw new Error();
    return config;
  } catch {
    throw new Error("La configuration Composio ne peut pas être déchiffrée. Le coffre ou le fichier a changé.");
  }
}

async function ecrire(scope: string, configuration: ConfigurationComposio): Promise<void> {
  if (!coffreDisponible()) throw new Error("Le coffre du système est indisponible : rien n’a été enregistré.");
  const contenu = safeStorage.encryptString(JSON.stringify(configuration)).toString("base64");
  const destination = fichier(scope);
  const temporaire = `${destination}.tmp`;
  await writeFile(temporaire, JSON.stringify({ version: 1, contenu }), { encoding: "utf8", mode: 0o600 });
  await rename(temporaire, destination);
}

export const espaceComposio = new EspaceComposio({
  identite: identiteComposio,
  revisionIdentite: revisionIdentiteComposio,
  lire, ecrire, coffreDisponible,
  api: (cle) => new ComposioApi(cle, (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)),
  ouvrir: (url) => shell.openExternal(url),
});

/** Les IPC de configuration n'acceptent que le frame principal de la fenêtre KLYRA. */
export function verifierFenetreComposio(event: IpcMainInvokeEvent, win: BrowserWindow | null, devUrl?: string): void {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("Accès Composio refusé.");
  const url = new URL(event.senderFrame.url);
  const valide = app.isPackaged || !devUrl
    ? url.protocol === "app:" && url.hostname === "klyra"
    : url.origin === new URL(devUrl).origin;
  if (!valide) throw new Error("Accès Composio refusé.");
}

/** Le chemin choisi et le contenu ne passent jamais par le renderer. Aucun fichier n'est supprimé. */
export async function importerCleComposio(win: BrowserWindow, contexte: unknown): Promise<boolean> {
  const choix = await dialog.showOpenDialog(win, { title: "Importer une clé de projet Composio", properties: ["openFile"], buttonLabel: "Importer la clé" });
  if (choix.canceled || !choix.filePaths[0]) return false;
  let cle: string;
  try {
    const fichierChoisi = await open(choix.filePaths[0], "r");
    try {
      if (!(await fichierChoisi.stat()).isFile()) throw new Error();
      const contenu = Buffer.alloc(1025);
      const { bytesRead } = await fichierChoisi.read(contenu, 0, contenu.length, 0);
      if (bytesRead > 1024) throw new Error();
      cle = contenu.subarray(0, bytesRead).toString("utf8").trim();
    } finally { await fichierChoisi.close(); }
  } catch {
    throw new Error("Ce fichier ne peut pas être lu. Choisis un fichier contenant uniquement la clé de projet Composio.");
  }
  await espaceComposio.configurer(contexte, cle);
  return true;
}

export const OUTILS_COMPOSIO = [
  {
    name: "composio_etat",
    description: "Liste les services Composio dont un compte a été choisi dans KLYRA, avec le nom de ce compte et son état relu. Aucun appel métier ni changement de connexion. Une liste vide signifie qu’il faut choisir un compte dans Réglages › Composio.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "composio_rechercher",
    description: "Cherche les outils et leurs schémas pour un service Composio (ex. gmail) dont la personne a choisi un compte dans Réglages › Composio. Ne connecte aucun compte et n’exécute aucune opération métier. Le service doit déjà être configuré ici ; une fiche d’agent ou un CLI externe ne prouve pas sa connexion.",
    inputSchema: { type: "object", properties: { service: { type: "string" }, recherche: { type: "string", description: "L’action à trouver." } }, required: ["service", "recherche"], additionalProperties: false },
  },
  {
    name: "composio_executer",
    description: "Exécute un outil obtenu avec composio_rechercher, dans sa version vérifiée et avec le compte explicitement choisi dans KLYRA pour ce service. Aucun choix de compte ou authentification ne se fait ici. Un compte absent, expiré ou modifié provoque un refus sans remplacement. Avoir une connexion n’autorise pas une action métier : respecte les demandes et accords de la personne.",
    inputSchema: { type: "object", properties: { outil: { type: "string", description: "Le slug exact trouvé." }, arguments: { type: "object", description: "Les arguments conformes au schéma trouvé, sans clé ni jeton." } }, required: ["outil", "arguments"], additionalProperties: false },
  },
] as const;
