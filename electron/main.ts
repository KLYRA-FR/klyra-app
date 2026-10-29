import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, shell, systemPreferences } from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentError,
  agentsDir,
  createAgent,
  installTeam,
  listAgents,
  listHistory,
  readMeta,
  readVersion,
  watchAgents,
  writeAgent,
  writeMeta,
  type AgentsMeta,
} from "./agents";
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
import { transcrire } from "./dictee";
import { ecrirePlanning } from "./planning";
import { ajouterIa, brancherRelaisFils, demarrerServeurMcp, FOURNISSEURS, listerIa, retirerIa, testerIa, type Fournisseur } from "./ia";
import { demarrerMisesAJour, etatMaj, installerMaintenant, verifierMaintenant } from "./maj";
import {
  changerLancement,
  ecrireReglages,
  infosApp,
  lancementAuDemarrage,
  lireReglages,
  notificationPermise,
  ouvrirDossier,
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
  "connect-src 'self'",
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
function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Reponse<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) };
    } catch (error) {
      if (error instanceof AgentError) return { ok: false, code: error.code, message: error.message };
      return { ok: false, code: "erreur", message: error instanceof Error ? error.message : String(error) };
    }
  });
}

function registerBridge() {
  handle("agents:list", async () => {
    const listing = await listAgents();
    watchAgents();
    return listing;
  });
  handle("agents:write", (name: string, content: string, expected: number | null) => writeAgent(name, content, expected));
  handle("agents:create", async (name: string, content: string) => {
    const file = await createAgent(name, content);
    watchAgents();
    return file;
  });
  handle("agents:install", async (templates: { name: string; content: string }[]) => {
    const installed = await installTeam(templates);
    watchAgents();
    return installed;
  });
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
  handle("systeme:transcrire", (audio: Uint8Array) => {
    if (!(audio instanceof Uint8Array) || audio.byteLength > 50 * 1024 * 1024) throw new Error("Enregistrement invalide.");
    return transcrire(audio);
  });
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
  handle("maj:etat", () => etatMaj());
  handle("maj:verifier", () => verifierMaintenant());
  handle("maj:installer", () => installerMaintenant());
}

/* Une seule KLYRA à la fois (version de développement comprise) : deux fenêtres écriraient
   le même fichier de conversations. La seconde ramène la première au premier plan. */
if (!SMOKE_TEST && !app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  const win = fenetrePrincipale;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

void app.whenReady().then(() => {
  // Sans version installée, macOS prend l'icône d'Electron : on la remplace dans le Dock.
  if (process.platform === "darwin") app.dock?.setIcon(ICONE);
  app.setAboutPanelOptions({ applicationName: "KLYRA", iconPath: ICONE });
  if (!DEV_URL) protocol.handle("app", serveExport);
  registerBridge();

  void demarrerServeurMcp();
  createWindow();
  demarrerMisesAJour();

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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
