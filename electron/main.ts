import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, safeStorage, shell, systemPreferences } from "electron";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os, { hostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appliquerConsignesProjet, etatConsignesProjet } from "./consignes-projet";
import { consigneKlyra } from "./configuration-klyra";
import { dossierHorsProjet } from "./atelier";
import {
  creerSouvenir,
  dossierMemoire,
  ecrireSouvenir,
  ErreurConnaissances,
  lireCompetences,
  lireMemoire,
  lireSouvenir,
  cheminSouvenir,
  porteeDeLaFiche,
  type PorteeMemoire,
} from "./connaissances-agent";
import { diagnostiquerPoste, existe } from "./diagnostic-poste";
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
  dossierAgents,
  generation,
  garderDefinitionRecue,
  lireDefinitionRecue,
  mesAgents,
  MODELES_KLYRA,
  nommerAssistant,
  origineValide,
  presentationActifs,
} from "./mes-agents";
import { readFile, writeFile } from "node:fs/promises";
import {
  chercherTravaux,
  etatFil,
  lirePreuves,
  lireProjection,
  marquerFil,
  noterGithub,
  noterMessage,
  noterOuverture,
  ouvrirJournal,
  passageWatchdog,
  peutOuvrir,
  preparerFil,
} from "./superagent/session";
import {
  actualiserUtilisation,
  compteClaude,
  connecterClaude,
  deconnecterClaude,
  derniereUtilisation,
  dossierExiste,
  findClaude,
  restaurerUtilisation,
  runAgent,
  essayerBrouillon,
  surUtilisation,
  titrerDemande,
  type Utilisation,
} from "./claude";
import { moteurs } from "./moteurs";
import { estGere } from "./moteurs/installation";
import type { AgentEvent, Decision, Progression, StreamOptions } from "./moteurs/types";
import { ecrituresTerminees, readConversations, writeConversations } from "./conversations";
import { echecExport, exporterConversation, verifierFenetreExport } from "./export-conversation";
import { arreterRoutines, brancherRoutines, commencerRoutine, demarrerRoutines, synchroniserToutesRoutinesVps } from "./routines";
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
import { ajouterMcpDirect, APPS_MCP, chargerMcpDirects, listerMcpDirects, retirerMcpDirect } from "./mcp-direct";
import { ajouterIa, brancherRelaisFils, demarrerServeurMcp, FOURNISSEURS, listerIa, retirerIa, testerIa, type Fournisseur } from "./ia";
import { composioConnect, espaceComposio, etatAvecLogos, importerCleComposio, saisirCleComposio, verifierFenetreComposio } from "./composio";
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
import { arreterPilote, etatPilote, prechaufferPilote, surEtatPilote } from "./ordinateur/pilote";
import { absolu, arbreDossier, cheminDansProjet, lireFichier, pagesDuSite, utilisateurSysteme } from "./projets";
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
import { copierRenduVps } from "./rendus-vps";
import { copierRendu, enregistrerRenduDans, montrerRendu, ouvrirDossierAgent, ouvrirRendu, supprimerCopieRendu, vignetteRendu } from "./rendus";
import { appairerServeur, appelerServeur, politiqueContenu, retirerAppareil, type DemandeHttp } from "./appel-serveur";
import { arbreVps, consignesVps, creerDossierVps, lireFichierVps } from "./projets-vps";
import { garderJetonServeur, jetonServeur, oublierJetonServeur, originesServeurs } from "./jetons-serveurs";
import {
  ajouterIaVps,
  catalogueIaVps,
  compteVps,
  connecterCleVps,
  connecterVps,
  deconnecterVps,
  listerIaVps,
  modelesVps,
  moteursVps,
  retirerIaVps,
  testerIaVps,
  travailVps,
  versionDisponibleVps,
} from "./fournisseurs-vps";
import { competencesVps, creerSouvenirVps, diagnosticVps, ecrireSouvenirVps, memoireVps, souvenirVps } from "./connaissances-vps";
import type { AjoutFiche } from "./atelier-agent";
import { essayerVps } from "./epreuve-vps";
import { annulerDistant, autoriserDistant, brancherAgentsDistants, oublierServeur, relierServeur, streamDistant, synchroniserEquipe, type Equipe } from "./agents-distants";
import { brancherRoutinesVps } from "./routines-vps";
import { adresseConvex, ecrireJeton, enregistrerProtocole, lireJeton, prendreLienRejoindre, PROTOCOLE, prendreCode, recevoirLien, recevoirLienRejoindre, retirerJeton, sourcesConvex } from "./compte";
import { enregistrerCollage } from "./collages";
import { recevoirPiece } from "./pieces-telephone";

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

/* L'export Next injecte des scripts inline : 'unsafe-inline' reste nécessaire.
   Le compte Convex est la seule origine nommée. L'appel au VPS ne part pas du rendu. */
const CONTENT_SECURITY_POLICY = politiqueContenu(sourcesConvex());

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
    if (error instanceof AgentError || error instanceof ErreurDictee || error instanceof ErreurConnaissances) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "erreur", message: error instanceof Error ? error.message : String(error) };
  }
}

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, (_event, ...args: unknown[]) => repondre(() => fn(...(args as A))));
}

function registerBridge() {
  // Pont limité : ni URL arbitraire, ni clé, ni user_id fournis par le renderer.
  const composio = (channel: string, fn: (...args: unknown[]) => unknown) => ipcMain.handle(channel, (event, ...args: unknown[]) => repondre(async () => {
    verifierFenetreComposio(event, fenetrePrincipale, DEV_URL);
    return fn(...args);
  }));
  composio("composio:etat", () => etatAvecLogos());
  composio("composio:importer", (contexte) => importerCleComposio(fenetrePrincipale!, contexte));
  composio("composio:saisir", (contexte, cle) => saisirCleComposio(contexte, cle));
  composio("composio:connect:etat", () => composioConnect.etat());
  composio("composio:connect:connecter", () => composioConnect.connecter());
  composio("composio:connect:annuler", () => composioConnect.annuler());
  composio("composio:connect:deconnecter", () => composioConnect.deconnecter());
  composio("composio:retirer", (contexte) => espaceComposio.retirerConfiguration(contexte));
  composio("composio:selectionner", (contexte, service, compte) => espaceComposio.selectionner(contexte, service, compte));
  composio("composio:connecter", (contexte, service, configuration) => espaceComposio.connecter(contexte, service, configuration));
  composio("composio:deconnecter", (contexte, compte) => espaceComposio.deconnecter(contexte, compte));
  composio("composio:console", () => shell.openExternal("https://dashboard.composio.dev"));
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
  /*
   * Ce que sait un agent (cf. connaissances-agent.ts) : sa mémoire dans le dossier de la conversation, ses
   * compétences. L'écran donne l'agent et la conversation (dossier du projet, session) ; la portée vient de
   * sa fiche et le chemin est calculé ici. Rien n'est supprimé.
   */
  const configClaude = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  /** La conversation : le dossier de son projet et la session ; `lieu` : son VPS, où tout se lit et s'écrit. */
  type Contexte = { dossier?: string | null; sessionId?: string | null; lieu?: string | null } | null;
  const surVps = (contexte: Contexte) => {
    const lieu = typeof contexte?.lieu === "string" && contexte.lieu ? contexte.lieu : null;
    if (!lieu) return null;
    const dossier = typeof contexte?.dossier === "string" && contexte.dossier ? contexte.dossier : null;
    const sessionId = typeof contexte?.sessionId === "string" && /^[0-9a-f-]{36}$/.test(contexte.sessionId) ? contexte.sessionId : null;
    return { lieu, jeton: jetonServeur(lieu), contexte: { dossier, sessionId } };
  };
  const dossierConversation = (agent: string, contexte: { dossier?: string | null; sessionId?: string | null } | null) => {
    const dossier = typeof contexte?.dossier === "string" && contexte.dossier ? contexte.dossier : null;
    if (dossier) return dossier.startsWith("~") ? path.join(os.homedir(), dossier.slice(1)) : dossier;
    const sessionId = typeof contexte?.sessionId === "string" ? contexte.sessionId : null;
    return dossierHorsProjet(path.join(os.homedir(), ".klyra", "atelier"), agent === "principal" ? null : agent, sessionId, configClaude(), existsSync);
  };
  const porteeDe = async (agent: string): Promise<PorteeMemoire | null> => (agent === "principal" ? "auto" : porteeDeLaFiche((await lireFiche(agent))?.content ?? ""));
  const memoireDe = async (agent: string, contexte: { dossier?: string | null; sessionId?: string | null } | null) => {
    const portee = await porteeDe(String(agent));
    return portee ? { portee, dossier: dossierMemoire(String(agent), portee, dossierConversation(String(agent), contexte), configClaude()) } : null;
  };
  const exigerMemoire = async (agent: string, contexte: { dossier?: string | null; sessionId?: string | null } | null) => {
    const m = await memoireDe(agent, contexte);
    if (!m) throw new ErreurConnaissances("introuvable", "Cet agent n’a pas de mémoire.");
    return m;
  };
  handle("agents:memoire", async (agent: string, contexte: Contexte) => {
    const vps = surVps(contexte);
    if (vps) {
      // La fiche du VPS (sa portée) est la copie de celle de ce PC : envoyée d'abord.
      await synchroniserEquipe(vps.lieu).catch(() => undefined);
      return memoireVps(vps.lieu, vps.jeton, String(agent), vps.contexte);
    }
    const m = await memoireDe(agent, contexte);
    return m ? lireMemoire(m.portee, m.dossier) : null;
  });
  handle("agents:souvenir", async (agent: string, contexte: Contexte, id: string) => {
    const vps = surVps(contexte);
    if (vps) return souvenirVps(vps.lieu, vps.jeton, String(agent), vps.contexte, String(id));
    return lireSouvenir((await exigerMemoire(agent, contexte)).dossier, String(id));
  });
  handle("agents:souvenir:ecrire", async (agent: string, contexte: Contexte, id: string, contenu: string, attendu: number | null) => {
    const vps = surVps(contexte);
    const quand = typeof attendu === "number" ? attendu : null;
    if (vps) return ecrireSouvenirVps(vps.lieu, vps.jeton, String(agent), vps.contexte, String(id), String(contenu ?? ""), quand);
    return ecrireSouvenir((await exigerMemoire(agent, contexte)).dossier, String(id), String(contenu ?? ""), quand);
  });
  handle("agents:souvenir:creer", async (agent: string, contexte: Contexte, titre: string, contenu: string) => {
    const vps = surVps(contexte);
    if (vps) return creerSouvenirVps(vps.lieu, vps.jeton, String(agent), vps.contexte, String(titre ?? ""), String(contenu ?? ""));
    return creerSouvenir((await exigerMemoire(agent, contexte)).dossier, String(titre ?? ""), String(contenu ?? ""));
  });
  handle("agents:souvenir:montrer", async (agent: string, contexte: Contexte, id: string | null) => {
    if (surVps(contexte)) throw new ErreurConnaissances("introuvable", "Sa mémoire est sur le serveur : elle ne s’ouvre pas sur ce poste.");
    const { dossier } = await exigerMemoire(agent, contexte);
    if (id) {
      const fichier = cheminSouvenir(dossier, String(id));
      if (!existsSync(fichier)) throw new ErreurConnaissances("introuvable", "Ce souvenir n’existe plus.");
      shell.showItemInFolder(fichier);
    } else {
      if (!existsSync(dossier)) throw new ErreurConnaissances("introuvable", "Sa mémoire est encore vide : le dossier n’existe pas.");
      const erreur = await shell.openPath(dossier);
      if (erreur) throw new Error(erreur);
    }
  });
  handle("agents:competences", async (agent: string, contexte: Contexte) => {
    /* Un agent d'une conversation sur un VPS : ses compétences sont celles du serveur, lues là-bas, avec sa
       fiche copiée depuis ce PC (envoyée d'abord, pour qu'une compétence cochée à l'instant y soit). */
    const vps = surVps(contexte);
    if (vps) {
      await synchroniserEquipe(vps.lieu).catch(() => undefined);
      return competencesVps(vps.lieu, vps.jeton, String(agent), vps.contexte.dossier);
    }
    const fiche = agent === "principal" ? null : await lireFiche(String(agent));
    const dossier = typeof contexte?.dossier === "string" && contexte.dossier ? dossierConversation(String(agent), contexte) : null;
    return lireCompetences(fiche?.content ?? null, configClaude(), dossier);
  });
  handle("agents:competence:montrer", async (agent: string, contexte: Contexte, nom: string) => {
    if (surVps(contexte)) throw new ErreurConnaissances("introuvable", "Cette compétence est sur le serveur : elle ne s’ouvre pas sur ce poste.");
    const fiche = agent === "principal" ? null : await lireFiche(String(agent));
    const dossier = typeof contexte?.dossier === "string" && contexte.dossier ? dossierConversation(String(agent), contexte) : null;
    const c = lireCompetences(fiche?.content ?? null, configClaude(), dossier);
    // Seulement le dossier d'une skill que la lecture vient de trouver.
    const trouvee = [...c.fiche, ...c.projet, ...c.poste].find((s) => s.nom === nom && s.dossier);
    if (!trouvee?.dossier) throw new ErreurConnaissances("introuvable", "Cette compétence n’est pas sur ce poste.");
    shell.showItemInFolder(path.join(trouvee.dossier, "SKILL.md"));
  });
  handle("claude:status", () => ({ path: findClaude() }));
  handle("claude:run", (requestId: string, agent: string, prompt: string) => runAgent(requestId, agent, prompt));
  handle("claude:titre", (texte: string) => titrerDemande(String(texte ?? "")));
  /* L'épreuve d'un agent pas encore créé (atelier) : un essai sans outil, puis un avis. */
  /* Dans une conversation sur un VPS, l'essai tourne sur le serveur (son Claude Code) ; sinon sur ce PC. */
  handle("claude:essayer", (requestId: string, brouillon: unknown, cas: unknown, contexte: unknown) => {
    const b = (brouillon ?? {}) as Record<string, unknown>;
    const c = (cas ?? {}) as Record<string, unknown>;
    const x = (contexte ?? {}) as Record<string, unknown>;
    const texte = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    const type = c.type === "floue" || c.type === "hors-metier" ? c.type : "normal";
    const fiche = { id: texte(b.id, 64), description: texte(b.description, 1200), corps: texte(b.corps, 40_000), modele: texte(b.modele, 10), fiche: texte(b.fiche, 50_000) };
    const demande = { type, demande: texte(c.demande, 2000) } as const;
    const vps = surVps({ lieu: typeof x.lieu === "string" ? x.lieu : null });
    if (vps) {
      const ajouts = Array.isArray(x.ajouts) ? x.ajouts.filter((a): a is AjoutFiche => !!a && typeof a === "object" && typeof (a as AjoutFiche).texte === "string").slice(0, 20) : [];
      return essayerVps(vps.lieu, vps.jeton, fiche, demande, typeof x.conversation === "string" ? x.conversation.slice(0, 160) : null, ajouts);
    }
    return essayerBrouillon(String(requestId), fiche, demande);
  });
  handle("claude:cancel", (requestId: string) => (annulerDistant(requestId) ? undefined : moteurs.arreter(requestId)));
  handle("claude:autoriser", (requestId: string, demandeId: string, decision: Decision) => {
    if (!["oui", "toujours", "non"].includes(decision)) throw new Error("Réponse invalide.");
    return autoriserDistant(requestId, demandeId, decision) ?? moteurs.autoriser(requestId, demandeId, decision);
  });
  /* Réponse en direct : les événements arrivent sur `claude:event`, jusqu'à `fin`. */
  handle("claude:stream", (requestId: string, options: StreamOptions) => {
    /* Une conversation sur un VPS relié : l'agent tourne là-bas. Les routines restent sur ce PC. */
    if (typeof options.lieu === "string" && options.lieu && !options.routineRun) {
      void streamDistant(options.lieu, requestId, options);
      return null;
    }
    const suivreRoutine = options.routineRun
      ? commencerRoutine(options.routineRun, options.chatId ?? "", requestId, options.agent ?? "principal")
      : null;
    const sender = BrowserWindow.getAllWindows()[0]?.webContents;
    const envoyer = (id: string) => (agentEvent: AgentEvent) => {
      if (id === requestId && suivreRoutine) agentEvent = suivreRoutine(agentEvent);
      if (sender && !sender.isDestroyed()) sender.send("claude:event", id, agentEvent);
    };
    // Quand une tâche de fond se termine, l'agent reprend la parole : une nouvelle réponse s'ouvre.
    try {
      moteurs.lancer(requestId, options, envoyer(requestId), (sessionId) => {
        if (!sender || sender.isDestroyed()) return null;
        const id = randomUUID();
        sender.send("claude:spontane", id, sessionId);
        return { requestId: id, emit: envoyer(id) };
      });
    } catch (error) {
      if (!suivreRoutine) throw error;
      envoyer(requestId)({ type: "fin", ok: false, texte: "", erreur: error instanceof Error ? error.message : String(error) });
    }
    return null;
  });
  /* Les moteurs des agents (Claude Code, Codex pour ChatGPT) : présence, compte, modèles.
     `lieu` : ceux d'un VPS relié (electron/fournisseurs-vps.ts) ; absent : ceux de ce PC. */
  const moteurConnu = (id: string) => {
    const m = moteurs.moteur(id);
    if (!m || !id) throw new Error(`Fournisseur inconnu : ${id}.`);
    return m;
  };
  const vps = (lieu: unknown): string | null => (typeof lieu === "string" && lieu ? lieu : null);
  handle("moteurs:liste", (lieu?: string | null) => {
    const origine = vps(lieu);
    if (origine) return moteursVps(origine, jetonServeur(origine));
    return moteurs.liste().map((m) => {
      const chemin = m.trouver();
      return { id: m.id, nom: m.nom, fournisseur: m.fournisseur, chemin, gere: estGere(chemin), installable: !!m.installer };
    });
  });
  handle("moteurs:compte", (id: string, lieu?: string | null) => {
    const origine = vps(lieu);
    return origine ? compteVps(origine, jetonServeur(origine), id) : moteurConnu(id).compte();
  });
  handle("moteurs:connecter", (id: string, lieu?: string | null) => {
    const origine = vps(lieu);
    if (!origine) return moteurConnu(id).connecter();
    /* Sur le VPS, par code d'appareil : l'écran montre le code pendant qu'on attend la connexion. */
    return connecterVps(origine, jetonServeur(origine), id, (code) => {
      const sender = BrowserWindow.getAllWindows()[0]?.webContents;
      if (sender && !sender.isDestroyed()) sender.send("moteurs:code", id, origine, code);
    });
  });
  handle("moteurs:connecter-cle", (id: string, cle: string, lieu?: string | null) => {
    if (typeof cle !== "string") throw new Error("Clé invalide.");
    const origine = vps(lieu);
    if (origine) return connecterCleVps(origine, jetonServeur(origine), id, cle);
    const m = moteurConnu(id);
    if (!m.connecterAvecCle) throw new Error("Ce fournisseur ne se connecte pas avec une clé ici.");
    return m.connecterAvecCle(cle);
  });
  handle("moteurs:deconnecter", (id: string, lieu?: string | null) => {
    const origine = vps(lieu);
    return origine ? deconnecterVps(origine, jetonServeur(origine), id) : moteurConnu(id).deconnecter();
  });
  handle("moteurs:modeles", (id: string, lieu?: string | null) => {
    const origine = vps(lieu);
    return origine ? modelesVps(origine, jetonServeur(origine), id) : (moteurConnu(id).modeles?.() ?? []);
  });
  handle("moteurs:version-disponible", (id: string, lieu?: string | null) => {
    const origine = vps(lieu);
    return origine ? versionDisponibleVps(origine, jetonServeur(origine), id) : (moteurConnu(id).versionDisponible?.() ?? null);
  });
  /* Installer ou mettre à jour : l'avancée arrive sur `moteurs:progression`, jusqu'à la réponse. */
  const progression = (id: string, lieu: string | null) => (p: Progression) => {
    const sender = BrowserWindow.getAllWindows()[0]?.webContents;
    if (sender && !sender.isDestroyed()) sender.send("moteurs:progression", id, p, lieu);
  };
  handle("moteurs:installer", (id: string, lieu?: string | null) => {
    const origine = vps(lieu);
    if (origine) return travailVps(origine, jetonServeur(origine), id, "installer", progression(id, origine));
    const m = moteurConnu(id);
    if (!m.installer) throw new Error(`L’app ne sait pas installer ${m.nom}.`);
    return m.installer(progression(id, null));
  });
  handle("moteurs:mettre-a-jour", (id: string, lieu?: string | null) => {
    const origine = vps(lieu);
    if (origine) return travailVps(origine, jetonServeur(origine), id, "mettre-a-jour", progression(id, origine));
    const m = moteurConnu(id);
    if (!m.mettreAJour) throw new Error(`L’app ne sait pas mettre à jour ${m.nom}.`);
    return m.mettreAJour(progression(id, null));
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
  /* `lieu` : un projet sur un VPS relié (son origine) ; absent, un dossier de ce PC. */
  handle("projets:arbre", (dossier: string, relatif?: string, lieu?: string | null) => {
    if (typeof dossier !== "string" || !dossier) throw new Error("Dossier invalide.");
    const rel = typeof relatif === "string" ? relatif : "";
    if (typeof lieu === "string" && lieu) return arbreVps(lieu, jetonServeur(lieu), dossier, rel);
    return arbreDossier(dossier, rel);
  });
  handle("projets:creer-dossier-vps", (lieu: string, dossier: string) => {
    if (typeof lieu !== "string" || typeof dossier !== "string") throw new Error("Dossier invalide.");
    return creerDossierVps(lieu, jetonServeur(lieu), dossier);
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
  handle("projets:lire-fichier", (dossier: string, relatif: string, lieu?: string | null) =>
    typeof lieu === "string" && lieu ? lireFichierVps(lieu, jetonServeur(lieu), dossier, relatif) : lireFichier(dossier, relatif),
  );
  handle("projets:ouvrir-fichier", async (dossier: string, relatif: string) => {
    const erreur = await shell.openPath(cheminDansProjet(dossier, relatif));
    if (erreur) throw new Error(erreur);
  });
  handle("projets:montrer-fichier", (dossier: string, relatif: string) => shell.showItemInFolder(cheminDansProjet(dossier, relatif)));
  /* Les consignes du projet pour ses agents (AGENTS.md, import dans CLAUDE.md) : rien n'est écrasé. */
  /* Un projet d'un VPS : ses consignes se lisent et s'écrivent là-bas, avec le même module. */
  handle("projets:consignes", (dossier: string, nom: string, lieu?: string | null) =>
    typeof lieu === "string" && lieu ? consignesVps(lieu, jetonServeur(lieu), String(dossier), String(nom)) : etatConsignesProjet(absolu(dossier), String(nom)),
  );
  handle("projets:consignes:ecrire", (dossier: string, nom: string, lieu?: string | null) =>
    typeof lieu === "string" && lieu ? consignesVps(lieu, jetonServeur(lieu), String(dossier), String(nom), true) : appliquerConsignesProjet(absolu(dossier), String(nom)),
  );
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
  handle("rendus:vignette", (chemin: string, forcer: boolean) => vignetteRendu(chemin, !!forcer));
  handle("rendus:ouvrir", (chemin: string) => ouvrirRendu(chemin));
  handle("rendus:montrer", (chemin: string) => montrerRendu(chemin));
  handle("rendus:copier", (origine: string, agent: string, remplace: string | null) => copierRendu(origine, agent, remplace));
  /* Un livrable d'un agent du VPS : recopié depuis le serveur dans l'espace de l'agent, comme un livrable local. */
  handle("rendus:copier-vps", (lieu: string, id: string, agent: string, nom: string, dossier: boolean, remplace: string | null) =>
    copierRenduVps(String(lieu), jetonServeur(String(lieu)), id, agent, nom, dossier === true, remplace),
  );
  handle("rendus:supprimer", (chemin: string) => supprimerCopieRendu(chemin));
  handle("rendus:enregistrer", (chemin: string, dossier: string | null) => enregistrerRenduDans(chemin, dossier));
  handle("rendus:dossier-agent", (agent: string, quoi: string) => ouvrirDossierAgent(agent, quoi));
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
  handle("fichiers:recevoir", (octets: unknown, nom: unknown) => recevoirPiece(octets, nom));
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
  /* Les IA à consulter de ce PC, ou d'un VPS relié (`lieu`) : la clé reste là où elle est ajoutée. */
  handle("ia:fournisseurs", (lieu?: string | null) => {
    const origine = typeof lieu === "string" && lieu ? lieu : null;
    return origine ? catalogueIaVps(origine, jetonServeur(origine)) : FOURNISSEURS;
  });
  handle("ia:lister", (lieu?: string | null) => (typeof lieu === "string" && lieu ? listerIaVps(lieu, jetonServeur(lieu)) : listerIa()));
  handle("ia:ajouter", (entree: { nom: string; fournisseur: Fournisseur; url: string; modele: string; cle: string }, lieu?: string | null) =>
    typeof lieu === "string" && lieu ? ajouterIaVps(lieu, jetonServeur(lieu), entree) : ajouterIa(entree),
  );
  handle("ia:retirer", (id: string, lieu?: string | null) => (typeof lieu === "string" && lieu ? retirerIaVps(lieu, jetonServeur(lieu), String(id)) : retirerIa(String(id))));
  handle("ia:tester", (id: string, lieu?: string | null) => (typeof lieu === "string" && lieu ? testerIaVps(lieu, jetonServeur(lieu), String(id)) : testerIa(String(id))));
  /* Les MCP directs de la Marketplace (electron/mcp-direct.ts) : le jeton ne revient jamais vers l'écran. */
  handle("mcp:apps", () => APPS_MCP);
  handle("mcp:lister", () => listerMcpDirects());
  handle("mcp:ajouter", (entree: { app: string | null; nom?: string; url?: string; jeton?: string }) => ajouterMcpDirect(entree));
  handle("mcp:retirer", (id: string) => retirerMcpDirect(String(id)));
  handle("planning:ecrire", (markdown: string) => {
    if (typeof markdown !== "string" || markdown.length > 2 * 1024 * 1024) throw new Error("Planning invalide.");
    return ecrirePlanning(markdown);
  });
  /* Le compte d'équipe (electron/compte.ts) : les jetons ne quittent le process que vers l'interface. */
  handle("compte:jeton:lire", (cle: string) => lireJeton(cle));
  handle("compte:jeton:ecrire", (cle: string, valeur: string) => ecrireJeton(cle, valeur));
  handle("compte:jeton:retirer", (cle: string) => retirerJeton(cle));
  handle("compte:code", () => prendreCode());
  handle("serveur:lien", () => prendreLienRejoindre());
  /* Le rendu ne fetch pas le VPS : la politique de la fenêtre le couperait. Il ne voit jamais le jeton. */
  const demanderVps: DemandeHttp = async (url, requete, signal) => {
    const headers: Record<string, string> = {};
    if (requete.jeton) headers.Authorization = `Bearer ${requete.jeton}`;
    if (requete.corps !== undefined) headers["Content-Type"] = "application/json";
    const reponse = await net.fetch(url, {
      method: requete.methode,
      headers,
      body: requete.corps === undefined ? undefined : JSON.stringify(requete.corps),
      signal,
      redirect: "error",
      cache: "no-store",
    });
    const json: unknown = await reponse.json().catch(() => null);
    return { status: reponse.status, json };
  };
  /* Les agents actifs de Mes agents, tels quels, pour le VPS de la personne (cf. agents-distants.ts). */
  const equipePourVps = (): Equipe => {
    const fiches = presentationActifs().flatMap(({ id, nom }) => {
      try {
        return [{ id, nom, contenu: readFileSync(path.join(dossierAgents(), `${id}.md`), "utf8") }];
      } catch {
        return [];
      }
    });
    const assistant = mesAgents().assistant.nom ?? null;
    /* La configuration KLYRA de ce PC, comme `environnementAgent` et `consignesApp` la donnent aux sessions locales. */
    const { configuration: reglage } = lireReglages();
    const configuration = { memoireAgents: reglage.memoireAgents, consignes: consigneKlyra(reglage.consignes) };
    const empreinte = createHash("sha256").update(JSON.stringify([generation(), assistant, fiches, configuration])).digest("hex").slice(0, 16);
    return { fiches, assistant, configuration, empreinte };
  };
  const depuisFenetre = (event: Electron.IpcMainInvokeEvent) => {
    const win = fenetrePrincipale;
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error("Accès au serveur refusé.");
    }
  };
  const origineVps = (adresse: unknown) => (typeof adresse === "string" ? adresse : "");
  ipcMain.handle("serveur:interroger", (event, adresse: unknown) => repondre(() => {
    depuisFenetre(event);
    return appelerServeur(adresse, jetonServeur(origineVps(adresse)), demanderVps);
  }));
  ipcMain.handle("serveur:appairer", (event, adresse: unknown, code: unknown) => repondre(async () => {
    depuisFenetre(event);
    const lu = await appairerServeur(adresse, code, hostname(), demanderVps);
    if (!lu.ok) return lu;
    await garderJetonServeur(lu.adresse ?? origineVps(adresse), lu.jeton);
    relierServeur(lu.adresse ?? origineVps(adresse));
    return { ok: true as const, nom: lu.nom, version: lu.version };
  }));
  /* Retirer : le serveur oublie cet appareil s’il répond ; ce PC oublie le jeton dans tous les cas. */
  /* L'interface a chargé ses conversations : les réponses arrivées des VPS pendant l'absence de l'app peuvent s'ouvrir. */
  let vpsBranches = false;
  ipcMain.handle("serveur:pret", (event) => repondre(() => {
    depuisFenetre(event);
    if (vpsBranches) return;
    vpsBranches = true;
    brancherAgentsDistants(
      {
        fenetre: () => {
          const sender = fenetrePrincipale?.webContents;
          if (!sender || sender.isDestroyed()) return null;
          return {
            evenement: (id, agentEvent) => sender.send("claude:event", id, agentEvent),
            spontane: (id, sessionId, contexte) => sender.send("claude:spontane", id, sessionId, contexte),
            rendu: (origine, rendu) => sender.send("rendus:vps", origine, rendu),
          };
        },
        equipe: equipePourVps,
        jeton: jetonServeur,
      },
      originesServeurs(),
    );
    brancherRoutinesVps({ jeton: jetonServeur, equipe: synchroniserEquipe });
    void synchroniserToutesRoutinesVps();
  }));
  ipcMain.handle("serveur:retirer", (event, adresse: unknown) => repondre(async () => {
    depuisFenetre(event);
    const origine = origineVps(adresse);
    const confirme = await retirerAppareil(origine, jetonServeur(origine), demanderVps);
    oublierServeur(origine);
    await oublierJetonServeur(origine);
    return confirme;
  }));
  ouvrirJournal(app.getPath("userData"));
  const veilleTravaux = setInterval(() => {
    try {
      passageWatchdog();
    } catch {
      // Couverture dégradée : le passage suivant le dira. On n'écrit pas dans les fils.
    }
  }, 15 * 60_000);
  veilleTravaux.unref();
  handle("superagent:peut-ouvrir", () => peutOuvrir());
  handle("superagent:ouvrir", (brut: unknown) => noterOuverture(brut));
  handle("superagent:message", (brut: unknown) => noterMessage(brut));
  handle("superagent:etat", (filId: unknown) => etatFil(typeof filId === "string" ? filId : ""));
  handle("superagent:marquer", (filId: unknown, status: unknown, controle: unknown) => {
    const statut = status === "active" || status === "suspended" || status === "blocked" || status === "done" || status === "cancelled" || status === "waiting" ? status : "blocked";
    return marquerFil(typeof filId === "string" ? filId : "", statut, typeof controle === "string" ? controle : null);
  });
  handle("superagent:projection", (projectId: unknown) => lireProjection(typeof projectId === "string" && projectId ? projectId : null));
  handle("superagent:preuves", (workId: unknown) => lirePreuves(typeof workId === "string" ? workId : ""));
  handle("superagent:chercher", (requete: unknown, compte: unknown, projectId: unknown) =>
    chercherTravaux(typeof requete === "string" ? requete : "", typeof compte === "string" ? compte : "local", typeof projectId === "string" && projectId ? projectId : null),
  );
  handle("superagent:preparer", (filId: unknown) => preparerFil(typeof filId === "string" ? filId : ""));
  // Le même passage que le minuteur de 15 minutes. Il écrit une alerte, jamais dans le fil.
  handle("superagent:passage", () => passageWatchdog());
  handle("superagent:github", (brut: unknown) => noterGithub(brut));
  handle("conversations:read", () => readConversations());
  handle("conversations:write", (data: unknown) => writeConversations(data));
  ipcMain.handle("conversations:exporter", async (event, demande: unknown) => {
    try {
      verifierFenetreExport(event, fenetrePrincipale, DEV_URL);
      return { ok: true, data: await exporterConversation(fenetrePrincipale, demande) };
    } catch (erreur) { return echecExport(erreur); }
  });
  /* Routines : le moteur et son minuteur vivent ici (electron/routines/), l'interface poste les exécutions. */
  brancherRoutines();

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
  handle("reglages:ecrire", async (reglages: unknown) => {
    const avant = lireReglages().computerUse.actif;
    const ecrits = await ecrireReglages(reglages);
    /* Computer Use allumé : le pilote démarre ; coupé : il s'arrête tout de suite, et ses outils disparaissent. */
    if (lireReglages().computerUse.actif !== avant) void etatPilote();
    return ecrits;
  });
  handle("reglages:lancement", () => lancementAuDemarrage());
  handle("reglages:lancement:changer", (actif: boolean) => changerLancement(actif));
  handle("reglages:infos", () => infosApp());
  handle("reglages:ouvrir-dossier", (nom: DossierApp) => ouvrirDossier(nom));
  /* Ce que le poste ajoute à chaque appel (configuration KLYRA), et le fichier à ouvrir pour agir. */
  const diagnostic = () => diagnostiquerPoste(os.homedir(), presentationActifs().map((a) => a.id), process.env.CLAUDE_CONFIG_DIR || undefined);
  handle("reglages:diagnostic-poste", async (lieu?: string | null) => {
    // Un VPS relié : la configuration de Claude Code de ce serveur, avec ses agents actifs (l'équipe envoyée d'abord).
    if (typeof lieu === "string" && lieu) {
      await synchroniserEquipe(lieu).catch(() => undefined);
      return diagnosticVps(lieu, jetonServeur(lieu));
    }
    return diagnostic();
  });
  handle("reglages:diagnostic-poste:montrer", (chemin: string) => {
    // Seulement un chemin que le diagnostic vient de trouver.
    if (!diagnostic().elements.some((e) => e.chemin === chemin) || !existe(chemin)) throw new Error("Ce fichier n’est plus là.");
    shell.showItemInFolder(chemin);
  });
  /* Un essai depuis les Réglages : la notification telle qu'elle s'afficherait. */
  handle("reglages:essai-notification", () => {
    if (!Notification.isSupported()) throw new Error("Ce système n’affiche pas les notifications de l’app.");
    new Notification({ title: "KLYRA", body: "Les notifications arrivent bien.", silent: !lireReglages().notifications.son }).show();
  });
  handle("reglages:computer-use:autorisations", () => autorisationsComputerUse());
  /* L'état du pilote (cua-driver), relu à la demande : démarré si l'interrupteur est allumé. */
  handle("reglages:computer-use:etat", () => etatPilote());
  surEtatPilote((etat) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send("computer-use:etat", etat);
  });
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

/* klyra://connexion ouvre le compte. klyra://rejoindre ouvre l’écran Serveurs. */
function ouvrirLienKlyra(lien: unknown) {
  if (recevoirLien(lien)) {
    premierPlan();
    fenetrePrincipale?.webContents.send("compte:lien");
    return;
  }
  if (recevoirLienRejoindre(lien)) {
    premierPlan();
    fenetrePrincipale?.webContents.send("serveur:lien");
  }
}
/* Mac : le système passe le lien à l'app, ouverte ou non. */
app.on("open-url", (event, lien) => {
  event.preventDefault();
  ouvrirLienKlyra(lien);
});
/* Windows : le lien arrive dans les arguments, d'une seconde instance ou au lancement. */
const lienDans = (argv: string[]) => argv.find((a) => a.startsWith(`${PROTOCOLE}://`));
app.on("second-instance", (_event, argv) => {
  premierPlan();
  ouvrirLienKlyra(lienDans(argv));
});
ouvrirLienKlyra(lienDans(process.argv));

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
  void demarrerRoutines();

  void demarrerServeurMcp();
  void chargerMcpDirects();
  /* Computer Use : le pilote reste prêt si l'interrupteur est allumé et les autorisations déjà données. */
  void prechaufferPilote();
  /* Composio Connect : jetons relus, puis renouvelés avant leur expiration. */
  void composioConnect.charger();
  setInterval(() => void composioConnect.renouvelerSiBesoin(), 60_000);
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
app.on("will-quit", () => {
  arreterDictee();
  arreterRoutines();
  moteurs.fermer();
  arreterPilote();
});
process.on("exit", () => arreterDictee());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
