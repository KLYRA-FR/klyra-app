import { app, safeStorage } from "electron";
import path from "node:path";
import os from "node:os";
import { creerGithubProjets } from "./github-stockage";

let service: ReturnType<typeof creerGithubProjets> | null = null;
export function githubProjets() {
  return service ??= creerGithubProjets({
    donnees: app.getPath("userData"), base: os.homedir(), racine: path.join(os.homedir(), "KLYRA", "GitHub"),
    gh: app.isPackaged ? path.join(process.resourcesPath, "github", process.platform === "win32" ? "gh.exe" : "gh") : "gh",
    chiffrer: (v) => {
      if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) throw new Error("Le coffre du système est indisponible. La connexion GitHub ne peut pas être gardée.");
      return safeStorage.encryptString(v).toString("base64");
    },
    dechiffrer: (v) => safeStorage.decryptString(Buffer.from(v, "base64")),
  });
}

export function fermerGithubProjets() { service?.fermer(); }
