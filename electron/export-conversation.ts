import { app, dialog, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";

/** Aucune conversation n'est lue/écrite ici : le document est déjà figé au clic. */
const MAX_OCTETS = 20 * 1024 * 1024;
let occupe = false;
let dernierDossier: string | undefined;

export type ResultatExport = { statut: "annule" | "occupe" } | { statut: "enregistre"; chemin: string; nom: string };
class ErreurExport extends Error {
  constructor(readonly code: string) { super(code); }
}

export function verifierFenetreExport(event: IpcMainInvokeEvent, win: BrowserWindow | null, devUrl?: string): asserts win is BrowserWindow {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
    throw new ErreurExport("EXPORT_INTERDIT");
  }
  const url = new URL(event.senderFrame.url);
  const valide = app.isPackaged || !devUrl
    ? url.protocol === "app:" && url.hostname === "klyra"
    : url.origin === new URL(devUrl).origin;
  if (!valide) throw new ErreurExport("EXPORT_INTERDIT");
}

/** Défense côté main : le nom proposé ne peut jamais désigner un autre dossier. */
function nomSur(nom: string): string {
  const morceaux = /^(.*) - (\d{4}-\d{2}-\d{2})\.md$/s.exec(nom);
  if (!morceaux) throw new ErreurExport("EXPORT_INVALIDE");
  const propre = morceaux[1].replace(/[\u0000-\u001f\u007f-\u009f/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().replace(/^[.\s]+/, "");
  const sur = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])\./i.test(propre) ? `Conversation ${propre}` : propre;
  const segments = new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(sur);
  const base = Array.from(segments, ({ segment }) => segment).slice(0, 80).join("").replace(/[.\s]+$/, "") || "Conversation";
  return `${base} - ${morceaux[2]}.md`;
}

/** Écriture atomique : seule la destination confirmée par le sélecteur est remplacée. */
async function ecrireDocument(chemin: string, contenu: string): Promise<void> {
  const temporaire = path.join(path.dirname(chemin), `.klyra-export-${randomUUID()}.tmp`);
  let cree = false;
  try {
    const fichier = await open(temporaire, "wx", 0o600);
    cree = true;
    try {
      await fichier.writeFile(contenu, "utf8");
      await fichier.sync();
    } finally {
      await fichier.close();
    }
    await rename(temporaire, chemin);
    cree = false;
  } finally {
    if (cree) await unlink(temporaire);
  }
}

export async function exporterConversation(win: BrowserWindow, demande: unknown): Promise<ResultatExport> {
  if (occupe) return { statut: "occupe" };
  if (!demande || typeof demande !== "object") throw new ErreurExport("EXPORT_INVALIDE");
  const { contenu, nomPropose } = demande as Record<string, unknown>;
  if (typeof contenu !== "string" || !contenu.trim() || typeof nomPropose !== "string" || nomPropose.length > 1000) {
    throw new ErreurExport("EXPORT_INVALIDE");
  }
  if (Buffer.byteLength(contenu, "utf8") > MAX_OCTETS) throw new ErreurExport("EXPORT_TROP_LONG");
  const nom = nomSur(nomPropose);
  occupe = true;
  try {
    const choix = await dialog.showSaveDialog(win, {
      title: "Exporter la conversation en Markdown", buttonLabel: "Exporter",
      defaultPath: path.join(dernierDossier ?? app.getPath("documents"), nom),
      filters: [{ name: "Markdown", extensions: ["md"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (choix.canceled || !choix.filePath) return { statut: "annule" };
    // Ne pas ajouter d'extension : le système a confirmé CE chemin.
    if (!path.isAbsolute(choix.filePath)) throw new ErreurExport("EXPORT_INVALIDE");
    await ecrireDocument(choix.filePath, contenu);
    dernierDossier = path.dirname(choix.filePath);
    return { statut: "enregistre", chemin: choix.filePath, nom: path.basename(choix.filePath) };
  } finally {
    occupe = false;
  }
}

/** Les chemins et le texte brut d'une erreur disque ne sont pas renvoyés dans l'interface. */
export function echecExport(erreur: unknown) {
  const code = erreur instanceof ErreurExport ? erreur.code : (erreur as NodeJS.ErrnoException | null)?.code;
  const connu = ["EACCES", "EPERM", "EROFS", "ENOSPC", "EBUSY", "EXPORT_TROP_LONG", "EXPORT_INVALIDE", "EXPORT_INTERDIT"].includes(code ?? "");
  return { ok: false as const, code: connu ? code! : "EXPORT_ERREUR", message: "Le fichier n’a pas pu être enregistré." };
}
