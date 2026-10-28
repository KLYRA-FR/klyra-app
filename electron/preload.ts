import { contextBridge, ipcRenderer, webUtils } from "electron";

/**
 * Pont entre l'interface et le système : uniquement ces fonctions, rien
 * d'autre (contextIsolation + sandbox). Les types côté interface sont dans
 * `src/lib/bridge.ts`.
 */
contextBridge.exposeInMainWorld("klyra", {
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    write: (name: string, content: string, expectedModifiedAt: number | null) =>
      ipcRenderer.invoke("agents:write", name, content, expectedModifiedAt),
    create: (name: string, content: string) => ipcRenderer.invoke("agents:create", name, content),
    installTeam: (templates: { name: string; content: string }[]) => ipcRenderer.invoke("agents:install", templates),
    history: (name: string) => ipcRenderer.invoke("agents:history", name),
    readVersion: (name: string, id: string) => ipcRenderer.invoke("agents:version", name, id),
    readMeta: () => ipcRenderer.invoke("agents:meta:read"),
    writeMeta: (meta: unknown) => ipcRenderer.invoke("agents:meta:write", meta),
    reveal: (name: string) => ipcRenderer.invoke("agents:reveal", name),
    onChange: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("agents:changed", listener);
      return () => ipcRenderer.removeListener("agents:changed", listener);
    },
  },
  claude: {
    status: () => ipcRenderer.invoke("claude:status"),
    run: (requestId: string, agent: string, prompt: string) => ipcRenderer.invoke("claude:run", requestId, agent, prompt),
    cancel: (requestId: string) => ipcRenderer.invoke("claude:cancel", requestId),
    autoriser: (requestId: string, demandeId: string, decision: string) =>
      ipcRenderer.invoke("claude:autoriser", requestId, demandeId, decision),
    stream: (requestId: string, options: unknown) => ipcRenderer.invoke("claude:stream", requestId, options),
    onEvent: (callback: (requestId: string, event: unknown) => void) => {
      const listener = (_e: unknown, requestId: string, event: unknown) => callback(requestId, event);
      ipcRenderer.on("claude:event", listener);
      return () => ipcRenderer.removeListener("claude:event", listener);
    },
    utilisation: () => ipcRenderer.invoke("claude:utilisation"),
    compte: () => ipcRenderer.invoke("claude:compte"),
    connexion: () => ipcRenderer.invoke("claude:connexion"),
    deconnexion: () => ipcRenderer.invoke("claude:deconnexion"),
    actualiserUtilisation: () => ipcRenderer.invoke("claude:utilisation:actualiser"),
    onUtilisation: (callback: (u: unknown) => void) => {
      const listener = (_e: unknown, u: unknown) => callback(u);
      ipcRenderer.on("claude:utilisation", listener);
      return () => ipcRenderer.removeListener("claude:utilisation", listener);
    },
  },
  projets: {
    dossierExiste: (dossier: string) => ipcRenderer.invoke("projets:dossier-existe", dossier),
    choisirDossier: () => ipcRenderer.invoke("projets:choisir-dossier"),
    arbre: (dossier: string) => ipcRenderer.invoke("projets:arbre", dossier),
    lireFichier: (dossier: string, relatif: string) => ipcRenderer.invoke("projets:lire-fichier", dossier, relatif),
    ouvrirFichier: (dossier: string, relatif: string) => ipcRenderer.invoke("projets:ouvrir-fichier", dossier, relatif),
    montrerFichier: (dossier: string, relatif: string) => ipcRenderer.invoke("projets:montrer-fichier", dossier, relatif),
  },
  artefacts: {
    lister: () => ipcRenderer.invoke("artefacts:lister"),
    vignette: (url: string, forcer: boolean) => ipcRenderer.invoke("artefacts:vignette", url, forcer),
    ouvrir: (url: string, titre: string) => ipcRenderer.invoke("artefacts:ouvrir", url, titre),
    etatSession: () => ipcRenderer.invoke("claude-ai:etat"),
    connecter: () => ipcRenderer.invoke("claude-ai:connexion"),
    deconnecter: () => ipcRenderer.invoke("claude-ai:deconnexion"),
  },
  fenetres: {
    ouvrir: (url: string) => ipcRenderer.invoke("fenetres:ouvrir", url),
  },
  git: {
    etat: (dossier: string) => ipcRenderer.invoke("git:etat", dossier),
    publier: (dossier: string, message: string) => ipcRenderer.invoke("git:publier", dossier, message),
  },
  systeme: {
    utilisateur: () => ipcRenderer.invoke("systeme:utilisateur"),
  },
  fichiers: {
    choisir: () => ipcRenderer.invoke("fichiers:choisir"),
    montrer: (chemin: string) => ipcRenderer.invoke("fichiers:montrer", chemin),
    ecrire: (chemin: string, texte: string) => ipcRenderer.invoke("fichiers:ecrire", chemin, texte),
    /** Chemin sur le disque d'un fichier glissé dans la fenêtre. */
    cheminDe: (file: File) => webUtils.getPathForFile(file),
  },
  webhooks: {
    adresse: (secret: string) => ipcRenderer.invoke("webhooks:adresse", secret),
    onAppel: (callback: (secret: string, corps: string) => void) => {
      const listener = (_e: unknown, secret: string, corps: string) => callback(secret, corps);
      ipcRenderer.on("webhooks:appel", listener);
      return () => ipcRenderer.removeListener("webhooks:appel", listener);
    },
  },
  apercu: {
    /** L'aperçu (iframe) a changé de page : son adresse, pour la barre. */
    onAdresse: (callback: (url: string) => void) => {
      const listener = (_e: unknown, url: string) => callback(url);
      ipcRenderer.on("apercu:adresse", listener);
      return () => ipcRenderer.removeListener("apercu:adresse", listener);
    },
  },
  conversations: {
    /** L'app va se fermer : c'est le moment d'envoyer le dernier état. */
    avantFermeture: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("app:avant-fermeture", listener);
      return () => ipcRenderer.removeListener("app:avant-fermeture", listener);
    },
    read: () => ipcRenderer.invoke("conversations:read"),
    write: (data: unknown) => ipcRenderer.invoke("conversations:write", data),
  },
});
