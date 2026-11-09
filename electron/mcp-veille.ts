import { app, BrowserWindow, Notification } from "electron";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { demandeAgentsVps } from "./agents-distants";
import { atelierDe } from "./atelier";
import { findClaude } from "./claude";
import { terminaux } from "./ia";
import { originesServeurs } from "./jetons-serveurs";
import { alertesNouvelles, creerReconnexions, creerVeilleMcp, ID_AGENT, listerMcp, PREMIER_DELAI_MS, INTERVALLE_MS, type DossierAgent, type EntreeSante, type EtatVeille, type VueReconnexion } from "./mcp-sante";
import { estActif } from "./mes-agents";
import { lireReglages, notificationPermise } from "./reglages";
import { dossierParDefaut } from "./terminal";

/**
 * La veille des serveurs MCP des agents, côté PC (cf. mcp-sante.ts, le même module que sur un VPS) : la veille des
 * agents de ce PC, et celle de chaque VPS relié, lue par la route `agent/mcp-sante`. Au lancement puis toutes les
 * heures, elle relit tout ; un MCP qui passe en défaut prévient une seule fois (notification du système si le
 * réglage le permet, et la pastille du rail tant que le défaut dure). Les alertes déjà dites sont gardées dans
 * `mcp-alertes.json` (des clés : lieu, agent, MCP, état, date), pour ne pas les redire au lancement suivant.
 */

export interface SanteLieu {
  /** null : ce PC ; sinon l'adresse du VPS. */
  lieu: string | null;
  sante: EtatVeille | null;
  /** Le serveur n'a pas répondu, ou ne connaît pas encore la veille. */
  erreur: string | null;
}

const donnees = () => process.env.KLYRA_USER_DATA ?? app.getPath("userData");

/** Les agents actifs de ce PC qui ont un dossier préparé (ceux qu'une session a déjà lancés). */
function dossiersDuPoste(): DossierAgent[] {
  const racine = path.join(donnees(), "preparation");
  const atelier = path.join(app.getPath("home"), ".klyra", "atelier");
  let noms: string[] = [];
  try {
    noms = readdirSync(racine, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  return noms
    .filter((n) => ID_AGENT.test(n) && (n === "principal" || estActif(n)))
    .map((agent) => ({ agent, dossier: path.join(racine, agent), cwd: dossierParDefaut(atelierDe(atelier, agent === "principal" ? null : agent)) }));
}

const lireJson = (fichier: string): unknown => {
  try {
    return JSON.parse(readFileSync(fichier, "utf8"));
  } catch {
    return null;
  }
};
const ecrireJson = (fichier: string, valeur: unknown) => {
  try {
    writeFileSync(fichier, JSON.stringify(valeur), { mode: 0o600 });
  } catch {
    /* Rien d'écrit : au pire, une alerte redite au prochain lancement. */
  }
};

const veille = creerVeilleMcp({
  agents: dossiersDuPoste,
  lister: (d) => listerMcp(findClaude(), d),
  lire: () => lireJson(path.join(donnees(), "mcp-sante.json")),
  ecrire: (e) => ecrireJson(path.join(donnees(), "mcp-sante.json"), e),
});
const reconnexions = creerReconnexions({ terminaux, veille, agents: dossiersDuPoste, claude: findClaude });

let dernier: SanteLieu[] = [];
const fichierAlertes = () => path.join(donnees(), "mcp-alertes.json");

function diffuser() {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("mcp-sante:sante", dernier);
}

/** Ce qui est en défaut et n'a pas encore été dit : une notification, puis la clé gardée. */
function alerter() {
  const brut = lireJson(fichierAlertes());
  const vues = new Set(Array.isArray(brut) ? brut.filter((c): c is string => typeof c === "string") : []);
  const nouvelles: { lieu: string | null; e: EntreeSante }[] = [];
  const garder: string[] = [];
  for (const l of dernier) {
    if (!l.sante) {
      // Lieu injoignable : on garde ce qu'on savait déjà dit de lui, pour ne pas le redire à son retour.
      garder.push(...[...vues].filter((c) => c.startsWith(`${l.lieu ?? ""}|`)));
      continue;
    }
    const a = alertesNouvelles(l.lieu, l.sante.entrees, vues);
    nouvelles.push(...a.nouvelles.map((e) => ({ lieu: l.lieu, e })));
    garder.push(...a.cles);
  }
  ecrireJson(fichierAlertes(), [...new Set(garder)]);
  if (!nouvelles.length || !Notification.isSupported() || !notificationPermise("mcpDefaut")) return;
  const premier = nouvelles[0];
  const ou = premier.lieu ? ` (${new URL(premier.lieu).hostname})` : "";
  const quoi = premier.e.etat === "authentification" ? "demande de se reconnecter" : "ne répond plus";
  const titre = nouvelles.length > 1 ? `${nouvelles.length} connexions d’agents à reprendre` : `Connexion à reprendre : ${premier.e.mcp}`;
  const texte = `${premier.e.mcp} de ${premier.e.agent}${ou} ${quoi}.${nouvelles.length > 1 ? " Et d’autres." : ""} Clique pour reconnecter.`;
  const notif = new Notification({ title: titre, body: texte, silent: !lireReglages().notifications.son });
  notif.on("click", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send("mcp-sante:ouvrir");
  });
  notif.show();
}

/** Relit ce PC et chaque VPS relié. `verifier` : chacun revérifie (sinon, l'état qu'il a déjà). */
export async function santeMcp(o: { verifier?: boolean; forcer?: boolean } = {}): Promise<SanteLieu[]> {
  const local = await (o.verifier === true ? veille.verifier({ forcer: o.forcer === true }) : Promise.resolve(veille.etat())).then(
    (sante) => ({ lieu: null, sante, erreur: null }),
    (e: unknown) => ({ lieu: null, sante: null, erreur: e instanceof Error ? e.message : "Vérification impossible." }),
  );
  const distants = await Promise.all(
    originesServeurs().map(async (lieu): Promise<SanteLieu> => {
      try {
        const r = (await demandeAgentsVps(lieu, "mcp-sante", { verifier: o.verifier === true, forcer: o.forcer === true })) as { sante?: EtatVeille };
        return { lieu, sante: r.sante ?? null, erreur: r.sante ? null : "Réponse inattendue du serveur." };
      } catch (e) {
        return { lieu, sante: null, erreur: e instanceof Error ? e.message : "Serveur injoignable." };
      }
    }),
  );
  dernier = [local, ...distants];
  alerter();
  diffuser();
  return dernier;
}

/** La dernière lecture, sans rien relancer (l'écran à son ouverture). */
export const derniereSanteMcp = () => dernier;

let minuterie: ReturnType<typeof setInterval> | null = null;
/** Au lancement (après le démarrage de l'app), puis toutes les heures. */
export function demarrerVeilleMcp() {
  if (minuterie || !existsSync(donnees())) return;
  const tour = () => void santeMcp({ verifier: true, forcer: true }).catch(() => undefined);
  setTimeout(tour, PREMIER_DELAI_MS).unref?.();
  minuterie = setInterval(tour, INTERVALLE_MS);
  minuterie.unref?.();
}

export function arreterVeilleMcp() {
  if (minuterie) clearInterval(minuterie);
  minuterie = null;
  reconnexions.fermerTout();
}

/* ─── Reconnecter : ici, ou sur le VPS de l'agent ─── */

const vue = (r: unknown) => (r as { reconnexion?: VueReconnexion | null }).reconnexion ?? null;

/** Après une reconnexion finie : la lecture de ce lieu est rafraîchie pour l'écran. */
async function apres(v: VueReconnexion | null) {
  if (v && v.etat !== "attente") await santeMcp().catch(() => undefined);
  return v;
}

export async function reconnecterMcp(lieu: string | null, agent: unknown, mcp: unknown): Promise<VueReconnexion | null> {
  if (lieu) return apres(vue(await demandeAgentsVps(lieu, "mcp-reconnecter", { agent, mcp })));
  return apres(await reconnexions.demarrer(agent, mcp));
}

export async function suivreReconnexionMcp(lieu: string | null, id: unknown): Promise<VueReconnexion | null> {
  if (lieu) return apres(vue(await demandeAgentsVps(lieu, "mcp-suivre", { id })));
  return apres(await reconnexions.suivre(id));
}

/** L'adresse de retour collée : elle part droit au PTY (ici ou sur le VPS), jamais ailleurs. */
export async function retourReconnexionMcp(lieu: string | null, id: unknown, adresse: unknown): Promise<VueReconnexion | null> {
  if (lieu) return apres(vue(await demandeAgentsVps(lieu, "mcp-retour", { id, adresse })));
  return apres(await reconnexions.retour(id, adresse));
}

export async function annulerReconnexionMcp(lieu: string | null, id: unknown): Promise<boolean> {
  if (lieu) return ((await demandeAgentsVps(lieu, "mcp-annuler", { id })) as { ok?: unknown }).ok === true;
  return reconnexions.annuler(id);
}
