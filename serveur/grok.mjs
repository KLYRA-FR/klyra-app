/**
 * Grok par Grok Build, sur le VPS : comme dans l'app (electron/moteurs/grok.ts), un `grok agent stdio`
 * gardé ouvert et une session de Grok par conversation, par le même client ACP (acp.mjs, généré depuis
 * l'app). Les événements partent dans le journal du serveur. Sans navigateur ici : on se connecte à
 * l'abonnement par code d'appareil (`grok login --device-auth` : lien + code à saisir sur le PC), ou
 * avec une clé API de console.x.ai, gardée sur ce serveur (`donnees/grok.json`, 600) et donnée au
 * processus seulement.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { creerClientAcp, emailDeAuth, lireCodeAppareil, mcpPourAcp } from "./acp.mjs";
import { avecReperesCerveau } from "./cerveau-outils.mjs";
import { consigneSkillsCodex, filtreSkills, promptAvecSkillCodex } from "./connaissances-agent.mjs";
import { corpsDeFiche } from "./codex-protocole.mjs";
import { binaireGere, commande } from "./installation.mjs";
import { lireUtilisationGrok } from "./utilisation.mjs";

const CONNEXION_MAX_MS = 15 * 60 * 1000;
const CODE_MAX_MS = 30_000;

/**
 * @param {{ home: string, donnees: string, version: string, publier: (requestId: string, event: object, sessionId: string | null) => void,
 *   consigne: (agent: string | null) => string, consignesKlyra?: () => string | null, mcp: (demande: object) => string | null,
 *   generation: () => string, skillsParAgent?: () => object | null, grok?: string | null }} options
 */
export function creerGrok(options) {
  const { home, donnees, publier } = options;
  const grokHome = () => process.env.GROK_HOME || path.join(home, ".grok");
  const fichierCle = path.join(donnees, "grok.json");

  function trouver() {
    if (options.grok !== undefined) return options.grok;
    const candidats = [path.join(grokHome(), "bin", "grok"), path.join(home, ".local", "bin", "grok"), "/usr/local/bin/grok", "/usr/bin/grok", binaireGere(home, "grok", "grok")];
    return candidats.find((c) => !!c && existsSync(c)) ?? null;
  }

  const lireCle = () => {
    try {
      const { cle } = JSON.parse(readFileSync(fichierCle, "utf8"));
      return typeof cle === "string" && cle ? cle : null;
    } catch {
      return null;
    }
  };

  const environnement = () => {
    const env = { ...process.env, HOME: home };
    const cle = lireCle();
    if (cle) env.XAI_API_KEY = cle;
    return env;
  };

  const client = creerClientAcp({ trouver, env: environnement, cwd: () => home, client: { name: "klyra-serveur", title: "KLYRA (VPS)", version: options.version } });

  /* ─── Une réponse ──────────────────────────────────────────────── */

  const ficheBrute = (agent) => {
    const fichier = path.join(home, ".claude", "agents", `${agent}.md`);
    return existsSync(fichier) ? readFileSync(fichier, "utf8") : null;
  };
  const CONSIGNE_GROK = "Dans cette session, tu travailles avec Grok et tu ne peux confier aucun travail à un autre agent : fais ta part seul et dis ce qui reste.";

  /** Fait répondre l'agent avec Grok. `demande` est déjà vérifiée par agents.mjs. Se termine toujours par `fin`. */
  function envoyer(requestId, demande, cwd) {
    const echec = (erreur) => publier(requestId, { type: "fin", ok: false, texte: "", erreur }, null);
    if (!trouver()) return echec("Grok n’est pas installé sur ce VPS : installe Grok Build dans Réglages du serveur › Fournisseurs.");
    const configClaude = path.join(home, ".claude");
    const filtre = filtreSkills(options.skillsParAgent?.() ?? null, demande.agent ?? null, configClaude, cwd);
    const skills = consigneSkillsCodex(demande.agent ? ficheBrute(demande.agent) : null, configClaude, cwd, filtre.garder);
    const consignesKlyra = options.consignesKlyra?.() ?? null;
    const fiche = demande.agent ? ficheBrute(demande.agent) : null;
    const regles = [fiche ? corpsDeFiche(fiche) : null, options.consigne(demande.agent ?? null), consignesKlyra, skills.texte, CONSIGNE_GROK].filter(Boolean).join("\n\n");
    let sessionId = demande.sessionId ?? null;
    client.lancer(
      requestId,
      {
        sessionId,
        cwd,
        prompt: avecReperesCerveau(promptAvecSkillCodex(demande.prompt, demande.skill ?? null, configClaude, cwd, filtre.garder), donnees, demande.agent ?? "principal", demande.conversation ?? "", true),
        regles,
        mcp: mcpPourAcp(options.mcp(demande)),
        acces: demande.acces ?? "projet",
        modele: demande.modele ?? null,
        effort: demande.effort ?? null,
        signature: JSON.stringify([demande.agent ?? null, options.generation(), consignesKlyra, skills.noms, filtre.coupes, cwd]),
      },
      (event) => {
        if (event.type === "session") sessionId = event.sessionId;
        publier(requestId, event, sessionId);
        /* Les crédits ont bougé : relus après chaque réponse (une lecture du compte, sans modèle). */
        if (event.type === "fin") void utilisation(true);
      },
    );
  }

  /* ─── Compte et modèles ────────────────────────────────────────── */

  let versionLue = null;
  async function lireVersion(bin) {
    if (versionLue?.bin === bin) return versionLue.version;
    const r = await commande(bin, ["--version"], 20_000, { env: environnement() });
    versionLue = { bin, version: /(\d+\.\d+\.\d+)/.exec(r.sortie)?.[1] ?? null };
    return versionLue.version;
  }

  /** Le compte, dans la forme de `CompteMoteur` de l'app. */
  async function compte() {
    const chemin = trouver();
    const vide = { installe: !!chemin, chemin, version: null, connecte: false, methode: null, email: null, organisation: null, abonnement: null, verifieLe: Date.now() };
    if (!chemin) return vide;
    const auth = path.join(grokHome(), "auth.json");
    const session = existsSync(auth);
    const methode = session ? "grok.com" : lireCle() ? "cle-api" : process.env.XAI_API_KEY ? "env" : null;
    let email = null;
    try {
      email = session ? emailDeAuth(readFileSync(auth, "utf8")) : null;
    } catch {
      /* illisible : connecté quand même */
    }
    return { ...vide, version: await lireVersion(chemin), connecte: !!methode, methode, email };
  }

  let connexion = null;

  /**
   * Connexion à l'abonnement par code d'appareil : `grok login --device-auth` écrit un lien et un code,
   * rendus à l'app (qui ouvre le lien sur le PC et montre le code), puis attend que la connexion soit
   * validée (15 min au plus). L'app relit le compte jusqu'à ce qu'il soit connecté.
   */
  function connecter() {
    const chemin = trouver();
    if (!chemin) throw new Error("Grok n’est pas installé sur ce VPS : installe Grok Build dans Réglages du serveur › Fournisseurs.");
    connexion?.child.kill("SIGTERM");
    return new Promise((resolve, reject) => {
      const child = spawn(chemin, ["login", "--device-auth"], { cwd: home, env: { ...environnement(), GROK_DISABLE_AUTOUPDATER: "1" }, stdio: ["ignore", "pipe", "pipe"] });
      const etat = { child, fini: false, erreur: null, code: null };
      connexion = etat;
      let sortie = "";
      const lu = () => {
        if (etat.code) return;
        etat.code = lireCodeAppareil(sortie);
        if (etat.code) {
          clearTimeout(attente);
          resolve(etat.code);
        }
      };
      child.stdout.on("data", (d) => ((sortie = (sortie + d.toString()).slice(-8000)), lu()));
      child.stderr.on("data", (d) => ((sortie = (sortie + d.toString()).slice(-8000)), lu()));
      const attente = setTimeout(() => {
        if (etat.code) return;
        child.kill("SIGTERM");
        reject(new Error("Grok n’a pas donné de code de connexion sur ce VPS."));
      }, CODE_MAX_MS);
      const limite = setTimeout(() => child.kill("SIGTERM"), CONNEXION_MAX_MS);
      child.on("error", (error) => {
        clearTimeout(attente);
        clearTimeout(limite);
        etat.fini = true;
        etat.erreur = error.message;
        reject(new Error(`Impossible de lancer Grok sur le VPS : ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(attente);
        clearTimeout(limite);
        etat.fini = true;
        if (code !== 0) etat.erreur = sortie.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim().split("\n").slice(-2).join(" ").slice(0, 400) || "La connexion à Grok n’a pas abouti.";
        // Le processus ouvert garde l'ancienne connexion en mémoire : le prochain appel relance Grok.
        client.fermer();
        if (!etat.code) reject(new Error(etat.erreur ?? "Grok n’a pas donné de code de connexion sur ce VPS."));
      });
    });
  }

  /** Où en est la connexion : `erreur` si elle a échoué. */
  const etatConnexion = () => (connexion ? { fini: connexion.fini, erreur: connexion.erreur } : null);

  async function connecterAvecCle(cle) {
    if (typeof cle !== "string" || !/^\S{10,400}$/.test(cle)) throw new Error("Cette clé ne ressemble pas à une clé API.");
    writeFileSync(fichierCle, JSON.stringify({ cle }), { encoding: "utf8", mode: 0o600 });
    client.fermer();
    return compte();
  }

  async function deconnecter() {
    derniereUtilisation = null;
    rmSync(fichierCle, { force: true });
    const chemin = trouver();
    if (chemin && existsSync(path.join(grokHome(), "auth.json"))) await commande(chemin, ["logout"], 30_000, { env: environnement() });
    client.fermer();
    return compte();
  }

  /* ─── Utilisation de l'abonnement ─────────────────────────────── */

  let derniereUtilisation = null;

  /** La dernière connue ; `actualiser` : relue par `_x.ai/billing` (crédits restants, ne consomme rien). Seulement connecté par l'abonnement. */
  async function utilisation(actualiser) {
    if (!actualiser && derniereUtilisation) return derniereUtilisation;
    if (!trouver() || !existsSync(path.join(grokHome(), "auth.json"))) return derniereUtilisation;
    try {
      derniereUtilisation = lireUtilisationGrok(await client.facturation(), derniereUtilisation) ?? derniereUtilisation;
    } catch {
      /* Cette version de Grok ne donne pas sa facturation : pas d'anneau, rien d'inventé. */
    }
    return derniereUtilisation;
  }

  async function modeles() {
    if (!trouver()) return [];
    const vide = mkdtempSync(path.join(os.tmpdir(), "klyra-grok-modeles-"));
    try {
      return await client.modeles(vide);
    } finally {
      rmSync(vide, { recursive: true, force: true });
    }
  }

  function fermer() {
    connexion?.child.kill("SIGTERM");
    client.fermer();
  }

  return {
    trouver,
    compte,
    connecter,
    etatConnexion,
    connecterAvecCle,
    deconnecter,
    modeles,
    utilisation,
    envoyer,
    autoriser: (requestId, demandeId, decision) => client.autoriser(requestId, demandeId, decision),
    annuler: (requestId) => client.arreter(requestId),
    fermer,
    /** Le programme a changé (installation, mise à jour) : le prochain appel relance Grok. */
    relancer: () => {
      versionLue = null;
      client.fermer();
    },
  };
}
