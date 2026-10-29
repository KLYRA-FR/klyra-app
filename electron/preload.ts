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
    onSpontane: (callback: (requestId: string, sessionId: string) => void) => {
      const listener = (_e: unknown, requestId: string, sessionId: string) => callback(requestId, sessionId);
      ipcRenderer.on("claude:spontane", listener);
      return () => ipcRenderer.removeListener("claude:spontane", listener);
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
    pages: (dossier: string) => ipcRenderer.invoke("projets:pages", dossier),
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
    micro: () => ipcRenderer.invoke("systeme:micro"),
    transcrire: (audio: Uint8Array) => ipcRenderer.invoke("systeme:transcrire", audio),
    notifier: (titre: string, texte: string, chatId: string, evenement?: string) =>
      ipcRenderer.invoke("systeme:notifier", titre, texte, chatId, evenement),
    /** Un clic sur une notification : la conversation à ouvrir. */
    onOuvrirChat: (callback: (chatId: string) => void) => {
      const listener = (_e: unknown, chatId: string) => callback(chatId);
      ipcRenderer.on("systeme:ouvrir-chat", listener);
      return () => ipcRenderer.removeListener("systeme:ouvrir-chat", listener);
    },
  },
  outils: {
    /** Un agent appelle un outil des fils : l'interface l'exécute et répond. */
    onAppel: (callback: (id: string, nom: string, args: Record<string, unknown>, appelant: { chatId: string; roleId: string }) => void) => {
      const listener = (_e: unknown, id: string, nom: string, args: Record<string, unknown>, appelant: { chatId: string; roleId: string }) =>
        callback(id, nom, args, appelant);
      ipcRenderer.on("outils:appel", listener);
      return () => ipcRenderer.removeListener("outils:appel", listener);
    },
    repondre: (id: string, ok: boolean, texte: string) => ipcRenderer.send("outils:reponse", id, ok, texte),
  },
  ia: {
    fournisseurs: () => ipcRenderer.invoke("ia:fournisseurs"),
    lister: () => ipcRenderer.invoke("ia:lister"),
    ajouter: (entree: unknown) => ipcRenderer.invoke("ia:ajouter", entree),
    retirer: (id: string) => ipcRenderer.invoke("ia:retirer", id),
    tester: (id: string) => ipcRenderer.invoke("ia:tester", id),
  },
  planning: {
    ecrire: (markdown: string) => ipcRenderer.invoke("planning:ecrire", markdown),
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
  reglages: {
    lire: () => ipcRenderer.invoke("reglages:lire"),
    ecrire: (reglages: unknown) => ipcRenderer.invoke("reglages:ecrire", reglages),
    lancement: () => ipcRenderer.invoke("reglages:lancement"),
    changerLancement: (actif: boolean) => ipcRenderer.invoke("reglages:lancement:changer", actif),
    infos: () => ipcRenderer.invoke("reglages:infos"),
    ouvrirDossier: (nom: string) => ipcRenderer.invoke("reglages:ouvrir-dossier", nom),
    essaiNotification: () => ipcRenderer.invoke("reglages:essai-notification"),
  },
  maj: {
    etat: () => ipcRenderer.invoke("maj:etat"),
    verifier: () => ipcRenderer.invoke("maj:verifier"),
    installer: () => ipcRenderer.invoke("maj:installer"),
  },
});
