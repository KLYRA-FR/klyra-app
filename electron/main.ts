import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, safeStorage, shell, systemPreferences } from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentError,
  agentsDir,
  createAgent,
  listAgents,
  listHistory,
  readFile as lireFiche,
  readMeta,
  readVersion,
  watchAgents,
  writeAgent,
  writeMeta,
  type AgentsMeta,
} from "./agents";
import {
  activer,
  ajouter,
  changerOrigine,
  chargerMesAgents,
  garderDefinitionRecue,
  lireDefinitionRecue,
  mesAgents,
  MODELES_KLYRA,
  nommerAssistant,
  origineValide,
} from "./mes-agents";
import { readFile, writeFile } from "node:fs/promises";
import {
  autoriser,
  actualiserUtilisation,
  cancelAgent,
  compteClaude,
  connecterClaude,
  deconnecterClaude,
  derniereUtilisation,
  dossierExiste,
  findClaude,
  restaurerUtilisation,
  runAgent,
  streamAgent,
  surUtilisation,
  type Decision,
  type AgentEvent,
  type StreamOptions,
  type Utilisation,
} from "./claude";
import { ecrituresTerminees, readConversations, writeConversations } from "./conversations";
import {
  arreterDictee,
  choisirModele,
  enregistrerCle,
  envoyerAudio,
  ErreurDictee,
  etatDictee,
  fermerSession,
  MODELES,
  nettoyerServeurOrphelin,
  ouvrirSession,
  prechauffer,
  preparerLocal,
  retirerCle,
  telechargerModele,
  testerCle,
  transcrireSegment,
  type ModeleLocal,
} from "./dictee";
import { ecrirePlanning } from "./planning";
import { ajouterIa, brancherRelaisFils, demarrerServeurMcp, FOURNISSEURS, listerIa, retirerIa, testerIa, type Fournisseur } from "./ia";
import { demarrerMisesAJour, etatMaj, installerMaintenant, surEtatMaj, verifierMaintenant } from "./maj";
import { lireConsommation, lireJournal } from "./consommation";
import { rattraperHistorique } from "./historique";
import { definirCleAdmin, etatAdmin, rapportAdmin, retirerCleAdmin } from "./anthropic-admin";
import {
  autorisationsComputerUse,
  changerLancement,
  ecrireReglages,
  ouvrirAutorisation,
  infosApp,
  lancementAuDemarrage,
  lireReglages,
  notificationPermise,
  ouvrirDossier,
  sonsCoupesParLeSysteme,
  type DossierApp,
  type EvenementNotification,
} from "./reglages";
import { arbreDossier, cheminDansProjet, lireFichier, pagesDuSite, utilisateurSysteme } from "./projets";
import { etatGit, publier } from "./git";
import { adresseWebhook, demarrerWebhooks, ecrireFichierTexte } from "./workflows";
import {
  connecterClaudeAi,
  deconnecterClaudeAi,
  etatClaudeAi,
  listerArtefacts,
  ouvrirArtefact,
  vignetteArtefact,
} from "./artefacts";
import { adresseConvex, ecrireJeton, enregistrerProtocole, lireJeton, PROTOCOLE, prendreCode, recevoirLien, retirerJeton, sourcesConvex } from "./compte";
import { enregistrerCollage } from "./collages";

/**
 * Process principal Electron.
 * - En dev (`pnpm desktop`) : charge le serveur Next sur KLYRA_DEV_URL.
 * - En version finale (`pnpm start:desktop`) : sert l'export statique `out/`
 *   via le protocole `app://`, sans serveur.
 * - `KLYRA_SMOKE_TEST=1` : fenêtre invisible, affiche le texte rendu puis quitte
 *   (vérifie que la version finale s'affiche, sans capture d'écran).
 */

const DEV_URL = process.env.KLYRA_DEV_URL;
/* Tests : données de l'app (historique, réglages) dans un dossier à part. */
if (process.env.KLYRA_USER_DATA) app.setPath("userData", process.env.KLYRA_USER_DATA);
const SMOKE_TEST = process.env.KLYRA_SMOKE_TEST === "1";
const OUT_DIR = path.join(__dirname, "..", "out");
/** Icône de l'app : le logo-icône KLYRA (signe blanc sur K1), cf. resources/icon.png. */
const ICONE = path.join(__dirname, "..", "resources", "icon.png");

/* Ouverte depuis le Dock ou le Finder, l'app n'a pas le PATH du terminal : les agents ne
   trouveraient ni pnpm, ni git, ni node. On reprend celui du shell de la personne. */
if (app.isPackaged && process.platform === "darwin") {
  try {
    const sortie = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "\n%s" "$PATH"'], { encoding: "utf8", timeout: 5000 });
    const chemin = sortie.trim().split("\n").at(-1);
    if (chemin) process.env.PATH = chemin;
  } catch {
    /* on garde le PATH du système */
  }
}

/* Le nom de l'app dans le Dock, le menu et « À propos ». */
app.setName("KLYRA");
/* Sous Windows, les notifications s'affichent au nom de l'app installée. */
if (process.platform === "win32") app.setAppUserModelId("design.klyra.app");
/* Les données de la personne (conversations, projets, réglages) restent
   toujours dans le même dossier, quel que soit le nom affiché de l'app. */
if (!process.env.KLYRA_USER_DATA) app.setPath("userData", path.join(app.getPath("appData"), "klyra-app"));

/* L'export Next injecte des scripts inline : 'unsafe-inline' reste nécessaire. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Le compte d'équipe : le déploiement Convex de l'app, et lui seul.
  `connect-src 'self' ${sourcesConvex().join(" ")}`,
  // L'aperçu d'un projet : son serveur de dev, sur ce Mac.
  "frame-src http://localhost:* http://127.0.0.1:*",
].join("; ");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** `/chat` → `out/chat.html`, `/` → `out/index.html`, assets tels quels. */
function resolveExportedFile(pathname: string): string | null {
  let relative = decodeURIComponent(pathname);
  if (relative.endsWith("/")) relative += "index.html";
  if (!path.extname(relative)) relative += ".html";
  const file = path.normalize(path.join(OUT_DIR, relative));
  // Refuse tout chemin qui sortirait du dossier exporté.
  return file.startsWith(OUT_DIR) ? file : null;
}

async function serveExport(request: Request): Promise<Response> {
  const file = resolveExportedFile(new URL(request.url).pathname);
  if (!file) return new Response("Introuvable", { status: 404 });
  const response = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return new Response(response.body, { status: response.status, headers });
}

async function runSmokeTest(win: BrowserWindow) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const text: string = await win.webContents.executeJavaScript(
    "document.querySelector('main')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? ''",
  );
  console.log(text ? `OK — ${text}` : "ÉCHEC — rien n'est affiché");
  app.exit(text ? 0 : 1);
}

/** Un serveur de dev sur ce Mac. */
const ADRESSE_LOCALE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

/** La fenêtre de l'app, celle qu'une notification ramène au premier plan. */
let fenetrePrincipale: BrowserWindow | null = null;
/** Réponses arrivées pendant que tu étais ailleurs : la pastille du Dock. */
let enAttente = 0;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: !SMOKE_TEST,
    title: "KLYRA",
    icon: ICONE,
    // Mac : boutons de la fenêtre dans la bande de titre de 28 px, au-dessus du logo.
    // Windows : la barre de titre du système, sans barre de menus.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 8 } }
      : { autoHideMenuBar: true }),
    // fond-page, le fond de l'app sous le panneau blanc.
    backgroundColor: "#F9F9F9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // Lue par le preload dès le premier rendu : le compte d'équipe n'attend pas un aller-retour.
      additionalArguments: [`--klyra-convex=${adresseConvex()}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  fenetrePrincipale = win;
  win.on("closed", () => fenetrePrincipale === win && (fenetrePrincipale = null));
  win.on("focus", () => {
    win.flashFrame(false);
    enAttente = 0;
    app.setBadgeCount(0);
  });

  // Les liens externes s'ouvrent dans le navigateur, pas dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  /* L'aperçu affiche le serveur de dev d'un projet dans une iframe. Beaucoup de
     sites (klyra.fr compris) l'interdisent par sécurité (X-Frame-Options,
     frame-ancestors) : l'app lève ces en-têtes, pour les serveurs locaux seulement. */
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (!ADRESSE_LOCALE.test(details.url) || !details.responseHeaders) return callback({});
    const entetes = { ...details.responseHeaders };
    for (const cle of Object.keys(entetes)) {
      const nom = cle.toLowerCase();
      if (nom === "x-frame-options") delete entetes[cle];
      else if (nom === "content-security-policy") {
        entetes[cle] = entetes[cle].map((v) =>
          v
            .split(";")
            .map((d) => d.trim())
            // upgrade-insecure-requests passerait les fichiers d'un serveur http local en https.
            .filter((d) => d && !/^(frame-ancestors|upgrade-insecure-requests)\b/i.test(d))
            .join("; "),
        );
      }
    }
    callback({ responseHeaders: entetes });
  });

  /* La barre d'adresse de l'aperçu suit la page où l'on navigue. */
  const signalerAdresse = (url: string, principal: boolean) => {
    if (!principal && ADRESSE_LOCALE.test(url)) win.webContents.send("apercu:adresse", url);
  };
  win.webContents.on("did-frame-navigate", (_e, url, _code, _statut, principal) => signalerAdresse(url, principal));
  win.webContents.on("did-navigate-in-page", (_e, url, principal) => signalerAdresse(url, principal));

  const url = DEV_URL ?? "app://klyra/";
  // En dev, le cache garderait d'anciens fichiers de l'app : on le vide à chaque ouverture.
  const cache = DEV_URL ? win.webContents.session.clearCache() : Promise.resolve();
  void cache
    .then(() => win.loadURL(SMOKE_TEST ? `${url.replace(/\/$/, "")}/chat?id=hero-home` : url))
    .then(() => {
      if (SMOKE_TEST) void runSmokeTest(win);
    });
}

/* ─── Pont avec l'interface (cf. preload.ts) ───────────────────── */

type Reponse<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** Chaque appel renvoie un résultat explicite : l'interface affiche l'erreur exacte. */
async function repondre<T>(fn: () => Promise<T> | T): Promise<Reponse<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AgentError || error instanceof ErreurDictee) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "erreur", message: error instanceof Error ? error.message : String(error) };
  }
}

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, (_event, ...args: unknown[]) => repondre(() => fn(...(args as A))));
}

function registerBridge() {
  handle("agents:list", async () => {
    const listing = await listAgents();
    watchAgents();
    return listing;
  });
  handle("agents:write", async (name: string, content: string, expected: number | null) => {
    const file = await writeAgent(name, content, expected);
    /* Les consignes d'un agent reçu, modifiées ici : il devient une copie privée (l'écran l'a confirmé),
       et ne reçoit plus les mises à jour de son auteur. */
    const origine = mesAgents().agents[name]?.origine;
    if (origine?.type === "bibliotheque" && mesAgents().agents[name].empreinte !== file.empreinte) {
      await changerOrigine(
        name,
        { type: "copie", definitionId: origine.definitionId, version: origine.version, auteur: origine.auteur, compte: origine.compte },
        file.content,
      );
    }
    return file;
  });
  /* Un agent créé dans l'app entre dans Mes agents. */
  handle("agents:create", async (name: string, content: string) => {
    const file = await createAgent(name, content);
    await ajouter(name, { type: "local" }, file.content);
    watchAgents();
    return file;
  });
  /* Ajouter un modèle KLYRA ou une définition de la bibliothèque : une nouvelle fiche, jamais par-dessus une autre. */
  handle("agents:installer", async (name: string, content: string, origine: unknown, partage: string | null) => {
    const o = origineValide(origine);
    const file = await createAgent(name, content);
    if (o.type === "bibliotheque" && typeof partage === "string") await garderDefinitionRecue(name, partage);
    const mes = await ajouter(name, o, file.content);
    watchAgents();
    return { file, mes };
  });
  /*
   * Mise à jour acceptée, ou dossiers configurés : réécrit la fiche d'un agent reçu. Refusé si la fiche
   * a été modifiée depuis que l'app l'a écrite, sauf si la personne a choisi de la remplacer (`forcer`) :
   * l'ancienne version va de toute façon dans l'historique.
   */
  handle(
    "agents:appliquer",
    async (name: string, content: string, origine: unknown, partage: string | null, expected: number | null, forcer: boolean) => {
      const o = origineValide(origine);
      const entree = mesAgents().agents[name];
      if (!entree) throw new AgentError("introuvable", `« ${name} » n’est pas dans Mes agents.`);
      const actuelle = await lireFiche(name);
      if (actuelle && entree.empreinte !== null && actuelle.empreinte !== entree.empreinte && !forcer) {
        throw new AgentError("modifie-localement", "Cette fiche a été modifiée sur cet ordinateur depuis son ajout.");
      }
      const file = await writeAgent(name, content, expected);
      if (o.type === "bibliotheque" && typeof partage === "string") await garderDefinitionRecue(name, partage);
      const mes = await changerOrigine(name, o, file.content);
      return { file, mes };
    },
  );
  handle("agents:mes", () => mesAgents());
  handle("agents:mes:assistant", (nom: string, teinte: string | null) => nommerAssistant(nom, teinte));
  handle("agents:mes:activer", (name: string, actif: boolean) => activer(name, actif === true));
  handle("agents:mes:ajouter", async (name: string) => {
    const file = await lireFiche(name);
    if (!file) throw new AgentError("introuvable", `La fiche « ${name} » n’existe plus sur le disque.`);
    return ajouter(name, { type: "local" }, file.content);
  });
  handle("agents:mes:origine", (name: string, origine: unknown) => changerOrigine(name, origineValide(origine)));
  handle("agents:recue", (name: string) => lireDefinitionRecue(name));
  handle("agents:history", (name: string) => listHistory(name));
  handle("agents:version", (name: string, id: string) => readVersion(name, id));
  handle("agents:meta:read", () => readMeta());
  handle("agents:meta:write", (meta: AgentsMeta) => writeMeta(meta));
  handle("agents:reveal", (name: string) => {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new AgentError("nom-invalide", "Nom d’agent invalide.");
    shell.showItemInFolder(path.join(agentsDir(), `${name}.md`));
  });
  handle("claude:status", () => ({ path: findClaude() }));
  handle("claude:run", (requestId: string, agent: string, prompt: string) => runAgent(requestId, agent, prompt));
  handle("claude:cancel", (requestId: string) => cancelAgent(requestId));
  handle("claude:autoriser", (requestId: string, demandeId: string, decision: Decision) => {
    if (!["oui", "toujours", "non"].includes(decision)) throw new Error("Réponse invalide.");
    return autoriser(requestId, demandeId, decision);
  });
  /* Réponse en direct : les événements arrivent sur `claude:event`, jusqu'à `fin`. */
  handle("claude:stream", (requestId: string, options: StreamOptions) => {
    const sender = BrowserWindow.getAllWindows()[0]?.webContents;
    const envoyer = (id: string) => (agentEvent: AgentEvent) => {
      if (sender && !sender.isDestroyed()) sender.send("claude:event", id, agentEvent);
    };
    // Quand une tâche de fond se termine, l'agent reprend la parole : une nouvelle réponse s'ouvre.
    streamAgent(requestId, options, envoyer(requestId), (sessionId) => {
      if (!sender || sender.isDestroyed()) return null;
      const id = randomUUID();
      sender.send("claude:spontane", id, sessionId);
      return { requestId: id, emit: envoyer(id) };
    });
    return null;
  });
  handle("projets:dossier-existe", (dossier: string) => dossierExiste(dossier));
  handle("projets:choisir-dossier", async () => {
    // Tests seulement (jamais dans l'app installée) : le dossier « choisi » sans fenêtre du système.
    if (process.env.KLYRA_TEST_DOSSIER && !app.isPackaged) return process.env.KLYRA_TEST_DOSSIER;
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { properties: ["openDirectory" as const], title: "Choisir le dossier du projet" };
    const choix = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return choix.canceled ? null : (choix.filePaths[0] ?? null);
  });
  handle("projets:arbre", (dossier: string) => {
    if (typeof dossier !== "string" || !dossier) throw new Error("Dossier invalide.");
    return arbreDossier(dossier);
  });
  handle("projets:pages", (dossier: string) => {
    if (typeof dossier !== "string" || !dossier) throw new Error("Dossier invalide.");
    return pagesDuSite(dossier);
  });
  handle("systeme:utilisateur", () => utilisateurSysteme());
  /* Dictée : l'accès au micro (macOS le demande une fois), puis la transcription par Whisper. */
  handle("systeme:micro", () => (process.platform === "darwin" ? systemPreferences.askForMediaAccess("microphone") : true));
  /* Sons de l'app : se taire si le système a coupé les sons de l'interface. */
  handle("systeme:sons-coupes", () => sonsCoupesParLeSysteme());
  /* Un agent a fini pendant que tu regardais ailleurs : notification du Mac, pastille sur l'icône. */
  handle("systeme:notifier", (titre: string, texte: string, chatId: string, evenement: EvenementNotification = "agentFini") => {
    if (![titre, texte, chatId].every((v) => typeof v === "string")) throw new Error("Notification invalide.");
    if (!["agentFini", "agentErreur", "workflow"].includes(evenement)) throw new Error("Événement invalide.");
    // Les Réglages : pastille, son, et chaque type de notification se coupent à part.
    const { notifications } = lireReglages();
    if (!fenetrePrincipale?.isFocused() && notifications.pastille) {
      // Pastille sur l'icône du Dock ; sous Windows, l'icône clignote dans la barre des tâches.
      if (process.platform === "win32") fenetrePrincipale?.flashFrame(true);
      else app.setBadgeCount((enAttente += 1));
    }
    if (!Notification.isSupported() || !notificationPermise(evenement)) return;
    const notif = new Notification({ title: titre.slice(0, 120), body: texte.slice(0, 240), silent: !notifications.son });
    notif.on("click", () => {
      const win = fenetrePrincipale;
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send("systeme:ouvrir-chat", chatId);
    });
    notif.show();
  });
  /* Dictée en direct (electron/dictee.ts) : ElevenLabs avec une clé, sinon Whisper sur l'ordinateur. */
  handle("dictee:etat", () => etatDictee());
  handle("dictee:modele", (modele: ModeleLocal) => {
    if (typeof modele !== "string" || !(modele in MODELES)) throw new Error("Modèle inconnu.");
    return choisirModele(modele);
  });
  handle("dictee:cle", (cle: string) => {
    if (typeof cle !== "string" || cle.length > 200) throw new Error("Clé invalide.");
    return enregistrerCle(cle);
  });
  handle("dictee:cle-retirer", () => retirerCle());
  handle("dictee:cle-tester", () => testerCle());
  handle("dictee:prechauffer", () => prechauffer());
  ipcMain.handle("dictee:preparer", (event) =>
    repondre(() => preparerLocal((p) => !event.sender.isDestroyed() && event.sender.send("dictee:progression", p))),
  );
  ipcMain.handle("dictee:telecharger", (event) =>
    repondre(() => telechargerModele((p) => !event.sender.isDestroyed() && event.sender.send("dictee:progression", p))),
  );
  handle("dictee:transcrire", (wav: Uint8Array, precedent: string) => {
    if (!(wav instanceof Uint8Array) || wav.byteLength > 5 * 1024 * 1024) throw new Error("Segment invalide.");
    return transcrireSegment(wav, typeof precedent === "string" ? precedent : "");
  });
  ipcMain.handle("dictee:ouvrir", (event) =>
    repondre(() => ouvrirSession((id, e) => !event.sender.isDestroyed() && event.sender.send("dictee:evenement", id, e))),
  );
  ipcMain.on("dictee:audio", (_e, id: string, pcm: Uint8Array, valider: boolean) => {
    if (typeof id === "string" && pcm instanceof Uint8Array && pcm.byteLength <= 64 * 1024) envoyerAudio(id, pcm, valider === true);
  });
  handle("dictee:fermer", (id: string) => fermerSession(String(id)));
  handle("projets:lire-fichier", (dossier: string, relatif: string) => lireFichier(dossier, relatif));
  handle("projets:ouvrir-fichier", async (dossier: string, relatif: string) => {
    const erreur = await shell.openPath(cheminDansProjet(dossier, relatif));
    if (erreur) throw new Error(erreur);
  });
  handle("projets:montrer-fichier", (dossier: string, relatif: string) => shell.showItemInFolder(cheminDansProjet(dossier, relatif)));
  handle("git:etat", (dossier: string) => etatGit(dossier));
  /* Un lien local (serveur de dev d'un projet) cliqué dans une conversation : une fenêtre de l'app. */
  handle("fenetres:ouvrir", (url: string) => {
    if (typeof url !== "string" || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) {
      throw new Error("Seules les adresses locales s’ouvrent dans l’app.");
    }
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: url,
      icon: ICONE,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(({ url: lien }) => {
      void shell.openExternal(lien);
      return { action: "deny" };
    });
    void win.loadURL(url);
  });
  handle("artefacts:lister", () => listerArtefacts());
  handle("artefacts:vignette", (url: string, forcer: boolean) => vignetteArtefact(url, !!forcer));
  handle("artefacts:ouvrir", (url: string, titre: string) => ouvrirArtefact(url, String(titre ?? "Artefact")));
  handle("claude-ai:etat", () => etatClaudeAi());
  handle("claude-ai:connexion", () => connecterClaudeAi(BrowserWindow.getFocusedWindow() ?? undefined));
  handle("claude-ai:deconnexion", () => deconnecterClaudeAi());
  handle("git:publier", (dossier: string, message: string) => publier(dossier, message));
  handle("fichiers:choisir", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const choix = win
      ? await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], title: "Joindre des fichiers" })
      : await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], title: "Joindre des fichiers" });
    return choix.canceled ? [] : choix.filePaths;
  });
  handle("fichiers:montrer", (chemin: string) => {
    if (typeof chemin !== "string" || !path.isAbsolute(chemin)) throw new Error("Chemin invalide.");
    shell.showItemInFolder(chemin);
  });
  handle("fichiers:ecrire", (chemin: string, texte: string) => ecrireFichierTexte(chemin, texte));
  handle("fichiers:coller", (octets: unknown, type: unknown) => enregistrerCollage(octets, type));
  handle("webhooks:adresse", (secret: string) => adresseWebhook(secret));
  demarrerWebhooks();
  /* Les outils des fils (ouvrir, lire, écrire, arrêter, fermer) : l'interface les exécute, elle tient les conversations. */
  const attentes = new Map<string, (r: { ok: boolean; texte: string }) => void>();
  ipcMain.on("outils:reponse", (_e, id: string, ok: boolean, texte: string) => {
    attentes.get(id)?.({ ok: !!ok, texte: String(texte ?? "") });
    attentes.delete(id);
  });
  brancherRelaisFils(
    (nom, args, appelant) =>
      new Promise((resolve, reject) => {
        const win = fenetrePrincipale;
        if (!win) return reject(new Error("La fenêtre de l’app est fermée."));
        const id = randomUUID();
        const delai = setTimeout(() => {
          attentes.delete(id);
          reject(new Error("L’app n’a pas répondu."));
        }, 30_000);
        attentes.set(id, (r) => {
          clearTimeout(delai);
          if (r.ok) resolve(r.texte);
          else reject(new Error(r.texte));
        });
        win.webContents.send("outils:appel", id, nom, args, appelant);
      }),
  );
  handle("ia:fournisseurs", () => FOURNISSEURS);
  handle("ia:lister", () => listerIa());
  handle("ia:ajouter", (entree: { nom: string; fournisseur: Fournisseur; url: string; modele: string; cle: string }) => ajouterIa(entree));
  handle("ia:retirer", (id: string) => retirerIa(String(id)));
  handle("ia:tester", (id: string) => testerIa(String(id)));
  handle("planning:ecrire", (markdown: string) => {
    if (typeof markdown !== "string" || markdown.length > 2 * 1024 * 1024) throw new Error("Planning invalide.");
    return ecrirePlanning(markdown);
  });
  /* Le compte d'équipe (electron/compte.ts) : les jetons ne quittent le process que vers l'interface. */
  handle("compte:jeton:lire", (cle: string) => lireJeton(cle));
  handle("compte:jeton:ecrire", (cle: string, valeur: string) => ecrireJeton(cle, valeur));
  handle("compte:jeton:retirer", (cle: string) => retirerJeton(cle));
  handle("compte:code", () => prendreCode());
  handle("conversations:read", () => readConversations());
  handle("conversations:write", (data: unknown) => writeConversations(data));

  /* Utilisation de Claude : la dernière connue, gardée sur le disque et
     envoyée à l'interface dès qu'une réponse d'agent la met à jour. */
  const fichierUtilisation = path.join(app.getPath("userData"), "utilisation.json");
  void readFile(fichierUtilisation, "utf8")
    .then((brut) => restaurerUtilisation(JSON.parse(brut) as Utilisation))
    .catch(() => {});
  surUtilisation((u) => {
    void writeFile(fichierUtilisation, JSON.stringify(u), "utf8").catch(() => {});
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("claude:utilisation", u);
  });
  handle("claude:utilisation", () => derniereUtilisation());
  handle("claude:compte", () => compteClaude());
  handle("claude:connexion", () => connecterClaude());
  handle("claude:deconnexion", () => deconnecterClaude());
  handle("claude:utilisation:actualiser", () => actualiserUtilisation());

  /* Réglages de l'app : notifications, lancement au démarrage, dossiers, mises à jour. */
  handle("reglages:lire", () => lireReglages());
  handle("reglages:ecrire", (reglages: unknown) => ecrireReglages(reglages));
  handle("reglages:lancement", () => lancementAuDemarrage());
  handle("reglages:lancement:changer", (actif: boolean) => changerLancement(actif));
  handle("reglages:infos", () => infosApp());
  handle("reglages:ouvrir-dossier", (nom: DossierApp) => ouvrirDossier(nom));
  /* Un essai depuis les Réglages : la notification telle qu'elle s'afficherait. */
  handle("reglages:essai-notification", () => {
    if (!Notification.isSupported()) throw new Error("Ce système n’affiche pas les notifications de l’app.");
    new Notification({ title: "KLYRA", body: "Les notifications arrivent bien.", silent: !lireReglages().notifications.son }).show();
  });
  handle("reglages:computer-use:autorisations", () => autorisationsComputerUse());
  handle("reglages:computer-use:ouvrir", (type: "accessibilite" | "ecran") => {
    if (type !== "accessibilite" && type !== "ecran") throw new Error("Autorisation inconnue.");
    return ouvrirAutorisation(type);
  });
  /* La consommation (jetons, coûts) de l'année, pour le Profil. */
  handle("consommation:lire", () => lireConsommation());
  /* Facultatif : l'usage et le coût réels d'une organisation Console (clé Admin d'Anthropic). */
  handle("anthropic-admin:etat", () => etatAdmin());
  handle("anthropic-admin:definir", (cle: string) => definirCleAdmin(cle));
  handle("anthropic-admin:retirer", () => retirerCleAdmin());
  handle("anthropic-admin:rapport", () => rapportAdmin());
  handle("maj:etat", () => etatMaj());
  /* Le rail et les Réglages suivent la mise à jour en direct (téléchargement, version prête). */
  surEtatMaj((etat) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send("maj:etat", etat);
  });
  handle("maj:verifier", () => verifierMaintenant());
  handle("maj:installer", () => installerMaintenant());
}

/* Une seule KLYRA à la fois (version de développement comprise) : deux fenêtres écriraient
   le même fichier de conversations. La seconde ramène la première au premier plan. */
if (!SMOKE_TEST && !app.requestSingleInstanceLock()) app.exit(0);
function premierPlan() {
  const win = fenetrePrincipale;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* Un lien de connexion (klyra://connexion?code=…) : l'interface vient prendre le code. */
function ouvrirLienConnexion(lien: unknown) {
  if (!recevoirLien(lien)) return;
  premierPlan();
  fenetrePrincipale?.webContents.send("compte:lien");
}
/* Mac : le système passe le lien à l'app, ouverte ou non. */
app.on("open-url", (event, lien) => {
  event.preventDefault();
  ouvrirLienConnexion(lien);
});
/* Windows : le lien arrive dans les arguments, d'une seconde instance ou au lancement. */
const lienDans = (argv: string[]) => argv.find((a) => a.startsWith(`${PROTOCOLE}://`));
app.on("second-instance", (_event, argv) => {
  premierPlan();
  ouvrirLienConnexion(lienDans(argv));
});
recevoirLien(lienDans(process.argv));

void app.whenReady().then(async () => {
  /* Mes agents d'abord : sa première création décide entre reprise et nouveau profil,
     avant que l'interface écrive ses propres données. */
  await chargerMesAgents(MODELES_KLYRA).catch((e) => console.error("Mes agents illisible :", e));
  // Sans version installée, macOS prend l'icône d'Electron : on la remplace dans le Dock.
  if (process.platform === "darwin") app.dock?.setIcon(ICONE);
  app.setAboutPanelOptions({ applicationName: "KLYRA", iconPath: ICONE });
  if (!DEV_URL) protocol.handle("app", serveExport);
  /* Tests sous Linux, sans trousseau : une clé en mémoire, pour essayer les clés API
     (dictée, autres IA). Sans effet sur Mac et Windows, qui ont toujours leur trousseau. */
  if (process.env.KLYRA_TEST_TROUSSEAU === "1") safeStorage.setUsePlainTextEncryption(true);
  registerBridge();
  if (!SMOKE_TEST) enregistrerProtocole();

  void demarrerServeurMcp();
  void nettoyerServeurOrphelin();
  createWindow();
  demarrerMisesAJour();
  /* L'historique de consommation se rattrape en arrière-plan, sans retarder l'ouverture. */
  setTimeout(() => void lireJournal().then((j) => rattraperHistorique(j.depuis ?? Date.now())).catch(() => {}), 20_000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* Avant de quitter : l'interface envoie son dernier état, et on attend qu'il soit écrit. */
let quitteApresEcriture = false;
app.on("before-quit", (event) => {
  if (quitteApresEcriture) return;
  event.preventDefault();
  quitteApresEcriture = true;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("app:avant-fermeture");
  // Le temps que l'interface envoie son état, puis que le fichier soit écrit (2 s au plus).
  setTimeout(() => {
    void Promise.race([ecrituresTerminees(), new Promise((r) => setTimeout(r, 1500))]).then(() => app.quit());
  }, 300);
});

/* Le Whisper gardé en mémoire pour la dictée s'arrête avec l'app. */
app.on("will-quit", () => arreterDictee());
process.on("exit", () => arreterDictee());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
