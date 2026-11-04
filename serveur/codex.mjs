/**
 * ChatGPT par Codex, sur le VPS : comme dans l'app (electron/moteurs/codex.ts), un `codex app-server`
 * pour toute la machine, gardé ouvert, et un fil de Codex par conversation. Ses messages sont traduits
 * par codex-protocole.mjs (généré depuis l'app) ; les événements partent dans le journal du serveur.
 * Sans navigateur ici : on se connecte avec un code d'appareil (lien + code à saisir sur le PC) ou une clé.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { accesCodex, autorisationDe, corpsDeFiche, mcpPourCodex, reponseAutorisation, reponseDOffice, TourCodex } from "./codex-protocole.mjs";
import { consigneSkillsCodex, filtreSkills, promptAvecSkillCodex } from "./connaissances-agent.mjs";
import { binaireGere } from "./installation.mjs";

const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const ARRET_MAX_MS = 5000;
const CONNEXION_MAX_MS = 15 * 60 * 1000;

/**
 * @param {{ home: string, version: string, publier: (requestId: string, event: object, sessionId: string | null) => void,
 *   consigne: (agent: string | null) => string, consignesKlyra?: () => string | null, estActif: (id: string) => boolean, mcp: () => string | null, generation: () => string,
 *   skillsParAgent?: () => object | null,
 *   codex?: string | null }} options
 */
export function creerCodex(options) {
  const { home, publier } = options;

  function trouver() {
    if (options.codex !== undefined) return options.codex;
    const candidats = [path.join(home, ".local", "bin", "codex"), "/usr/local/bin/codex", "/usr/bin/codex", binaireGere(home, "codex", "codex")];
    return candidats.find((c) => !!c && existsSync(c)) ?? null;
  }

  /* ─── Le serveur de Codex ──────────────────────────────────────── */

  let child = null;
  let bin = null;
  let demarrage = null;
  let suivant = 0;
  let stderr = "";
  let version = null;
  const attentes = new Map();
  const ecouteurs = new Set();
  /** Les fils chargés, avec ce qui les a configurés (agent, Mes agents, IA à consulter). */
  const fils = new Map();
  const jetons = new Map();
  /** Les réponses en cours, par fil ; et le fil de chaque réponse. */
  const enCours = new Map();
  const parRequete = new Map();

  const ecrire = (message) => child?.stdin?.write(`${JSON.stringify(message)}\n`);

  function requete(method, params) {
    if (!child) return Promise.reject(new Error("Codex n’est pas lancé."));
    const id = ++suivant;
    return new Promise((resolve, reject) => {
      attentes.set(id, { resolve, reject });
      ecrire({ id, method, params });
    });
  }

  function arret(processus, erreur) {
    if (child !== processus) return;
    child = null;
    demarrage = null;
    fils.clear();
    for (const attente of attentes.values()) attente.reject(new Error(erreur));
    attentes.clear();
    for (const r of enCours.values()) r.emit({ type: "fin", ok: false, texte: "", erreur: r.tour.arrete ? "Arrêté par toi." : erreur });
    enCours.clear();
    parRequete.clear();
  }

  function fermer() {
    const processus = child;
    if (!processus) return;
    arret(processus, "Codex a été fermé.");
    processus.stdin?.end();
    processus.kill("SIGTERM");
  }

  function finir(r) {
    if (enCours.get(r.threadId) !== r) return;
    enCours.delete(r.threadId);
    parRequete.delete(r.requestId);
    jetons.set(r.threadId, r.tour.jetonsDuFil);
  }

  function notification(method, params) {
    const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
    const r = threadId ? enCours.get(threadId) : undefined;
    if (r && !(typeof params.turnId === "string" && r.tour.turnId && params.turnId !== r.tour.turnId)) {
      if (method === "serverRequest/resolved") {
        const id = String(params.requestId);
        if (r.demandes.delete(id)) r.emit({ type: "autorisation-fin", id, accepte: false });
      } else if (r.tour.notification(method, params)) finir(r);
    }
    for (const ecouteur of ecouteurs) ecouteur(method, params);
  }

  function demande(rpcId, method, params) {
    const r = typeof params.threadId === "string" ? enCours.get(params.threadId) : undefined;
    const carte = autorisationDe(method, params);
    if (carte && r) {
      const id = String(rpcId);
      r.demandes.set(id, { rpcId, method, params });
      /* Accès complet : accordé d'office, comme pour Claude Code sur le VPS. */
      if (r.acces === "tout") {
        ecrire({ id: rpcId, result: reponseAutorisation(method, params, "oui") });
        r.demandes.delete(id);
        return;
      }
      r.emit({ type: "autorisation", id, ...carte });
      return;
    }
    ecrire({ id: rpcId, ...(carte ? { result: reponseAutorisation(method, params, "non") } : reponseDOffice(method)) });
  }

  function lire(ligne) {
    let msg;
    try {
      msg = JSON.parse(ligne);
    } catch {
      return;
    }
    if (msg.method && msg.id !== undefined) return demande(msg.id, msg.method, msg.params ?? {});
    if (msg.method) return notification(msg.method, msg.params ?? {});
    if (typeof msg.id !== "number") return;
    const attente = attentes.get(msg.id);
    if (!attente) return;
    attentes.delete(msg.id);
    if (msg.error) attente.reject(new Error(msg.error.message || "Codex a refusé la demande."));
    else attente.resolve(msg.result);
  }

  function demarrer(chemin) {
    if (demarrage && bin === chemin && child) return demarrage;
    fermer();
    bin = chemin;
    stderr = "";
    const processus = spawn(chemin, ["app-server"], { cwd: home, env: { ...process.env, HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
    child = processus;
    let tampon = "";
    processus.stdout.on("data", (d) => {
      tampon += d.toString();
      let fin;
      while ((fin = tampon.indexOf("\n")) >= 0) {
        const ligne = tampon.slice(0, fin).trim();
        tampon = tampon.slice(fin + 1);
        if (ligne) lire(ligne);
      }
    });
    processus.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-2000)));
    processus.on("error", (error) => arret(processus, `Impossible de lancer Codex sur le VPS : ${error.message}`));
    processus.on("close", (code) =>
      arret(processus, stderr.trim().split("\n").filter((l) => !/^WARNING/.test(l)).slice(-3).join(" ").slice(0, 600) || `Codex s’est arrêté sur le VPS (code ${code}).`),
    );
    demarrage = requete("initialize", {
      clientInfo: { name: "klyra-serveur", title: "KLYRA (VPS)", version: options.version },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }).then((r) => {
      version = /\/(\d+\.\d+\.\d+)/.exec(r?.userAgent ?? "")?.[1] ?? null;
      ecrire({ method: "initialized" });
    });
    demarrage.catch(() => fermer());
    return demarrage;
  }

  async function pret() {
    const chemin = trouver();
    if (!chemin) throw new Error("ChatGPT n’est pas installé sur ce VPS : installe Codex dans Réglages du serveur › Fournisseurs.");
    await demarrer(chemin);
  }

  /* ─── Consignes ────────────────────────────────────────────────── */

  /** La fiche de l'agent (`~/.claude/agents/<nom>.md`, envoyée par l'app), sans son en-tête. */
  function ficheDe(agent) {
    const brute = ficheBrute(agent);
    return brute ? corpsDeFiche(brute) : null;
  }
  /** La fiche entière, en-tête compris (ses `skills`). */
  function ficheBrute(agent) {
    const fichier = path.join(home, ".claude", "agents", `${agent}.md`);
    return existsSync(fichier) ? readFileSync(fichier, "utf8") : null;
  }

  const CONSIGNE_CODEX = "Dans cette session, tu travailles avec ChatGPT (Codex) et tu ne peux confier aucun travail à un autre agent : fais ta part seul et dis ce qui reste.";

  /* ─── Une réponse ──────────────────────────────────────────────── */

  /** Fait répondre l'agent avec Codex. `demande` est déjà vérifiée par agents.mjs. Se termine toujours par `fin`. */
  function envoyer(requestId, demande, cwd) {
    const echec = (erreur) => publier(requestId, { type: "fin", ok: false, texte: "", erreur }, null);
    if (demande.modele && !/^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,63}$/.test(demande.modele)) return echec("Modèle invalide.");
    if (demande.effort && !EFFORTS.includes(demande.effort)) return echec("Effort invalide.");
    demarrerTour(requestId, demande, cwd).catch((error) => echec(error instanceof Error ? error.message : String(error)));
  }

  async function demarrerTour(requestId, demande, cwd) {
    await pret();
    const acces = demande.acces ?? "projet";
    const politique = accesCodex(acces);
    /* Les consignes KLYRA adoptées sur le PC (reçues avec l'équipe), données aussi à Codex, comme `consignesApp` dans l'app. */
    const consignesKlyra = options.consignesKlyra?.() ?? null;
    /* Les skills de Claude sur ce VPS, que Codex ne lit pas de lui-même (cf. electron/connaissances-agent.ts). */
    const filtre = filtreSkills(options.skillsParAgent?.() ?? null, demande.agent ?? null, path.join(home, ".claude"), cwd);
    const skills = consigneSkillsCodex(demande.agent ? ficheBrute(demande.agent) : null, path.join(home, ".claude"), cwd, filtre.garder);
    const signature = JSON.stringify([demande.agent, options.generation(), consignesKlyra, skills.noms, filtre.coupes]);
    const reglages = () => {
      const mcp = options.mcp(demande);
      return {
        cwd,
        approvalPolicy: politique.approvalPolicy,
        sandbox: politique.sandbox,
        developerInstructions: [demande.agent ? ficheDe(demande.agent) : null, options.consigne(demande.agent), consignesKlyra, skills.texte, CONSIGNE_CODEX].filter(Boolean).join("\n\n"),
        config: { mcp_servers: mcpPourCodex(mcp) },
        ...(demande.modele ? { model: demande.modele } : {}),
      };
    };
    let emitSession = null;
    const nouveauFil = async () => {
      const r = await requete("thread/start", { ...reglages(), serviceName: "KLYRA" });
      fils.set(r.thread.id, signature);
      emitSession = r.thread.id;
      return r.thread.id;
    };

    let threadId = demande.sessionId;
    if (!threadId) threadId = await nouveauFil();
    else if (fils.get(threadId) !== signature) {
      if (fils.has(threadId)) await requete("thread/unsubscribe", { threadId }).catch(() => undefined);
      try {
        await requete("thread/resume", { threadId, ...reglages(), excludeTurns: true });
        fils.set(threadId, signature);
      } catch {
        /* Une session d'un autre moteur, ou un fil effacé : la conversation repart sur un nouveau fil. */
        threadId = await nouveauFil();
      }
    }
    if (enCours.has(threadId)) throw new Error("Une réponse est déjà en cours dans cette conversation.");

    const emit = (event) => publier(requestId, event, threadId);
    if (emitSession) emit({ type: "session", sessionId: emitSession });
    const reponse = { requestId, threadId, acces, tour: new TourCodex(threadId, emit, jetons.get(threadId) ?? 0), emit, demandes: new Map() };
    enCours.set(threadId, reponse);
    parRequete.set(requestId, threadId);
    try {
      const r = await requete("turn/start", {
        threadId,
        input: [{ type: "text", text: promptAvecSkillCodex(demande.prompt, demande.skill ?? null, path.join(home, ".claude"), cwd, filtre.garder), text_elements: [] }],
        cwd,
        approvalPolicy: politique.approvalPolicy,
        sandboxPolicy: politique.sandboxPolicy,
        ...(demande.modele ? { model: demande.modele } : {}),
        ...(demande.effort ? { effort: demande.effort } : {}),
      });
      reponse.tour.turnId ??= r.turn.id;
      if (reponse.tour.arrete) annuler(requestId);
    } catch (error) {
      finir(reponse);
      throw error;
    }
  }

  function annuler(requestId) {
    const threadId = parRequete.get(requestId);
    const r = threadId ? enCours.get(threadId) : undefined;
    if (!r) return false;
    r.tour.arrete = true;
    if (!r.tour.turnId) return true;
    void requete("turn/interrupt", { threadId: r.threadId, turnId: r.tour.turnId }).catch(() => undefined);
    setTimeout(() => {
      if (enCours.get(r.threadId) !== r) return;
      finir(r);
      r.emit({ type: "fin", ok: false, texte: "", erreur: "Arrêté par toi.", sessionId: r.threadId });
    }, ARRET_MAX_MS);
    return true;
  }

  function autoriser(requestId, demandeId, decision) {
    const threadId = parRequete.get(requestId);
    const r = threadId ? enCours.get(threadId) : undefined;
    const attente = r?.demandes.get(demandeId);
    if (!r || !attente || !["oui", "toujours", "non"].includes(decision)) return false;
    ecrire({ id: attente.rpcId, result: reponseAutorisation(attente.method, attente.params, decision) });
    r.demandes.delete(demandeId);
    r.emit({ type: "autorisation-fin", id: demandeId, accepte: decision !== "non" });
    return true;
  }

  /* ─── Compte et modèles ────────────────────────────────────────── */

  /** Le compte, dans la forme de `CompteMoteur` de l'app. */
  async function compte() {
    const chemin = trouver();
    const vide = { installe: !!chemin, chemin, version: null, connecte: false, methode: null, email: null, organisation: null, abonnement: null, verifieLe: Date.now() };
    if (!chemin) return vide;
    await demarrer(chemin);
    const { account, requiresOpenaiAuth } = await requete("account/read", { refreshToken: false });
    return {
      ...vide,
      version,
      connecte: !!account || !requiresOpenaiAuth,
      methode: account?.type === "chatgpt" ? "chatgpt" : account?.type === "apiKey" ? "cle-api" : account ? account.type : requiresOpenaiAuth ? null : "config",
      email: account?.email ?? null,
      abonnement: account?.planType ?? null,
    };
  }

  let connexion = null;

  /**
   * Connexion avec le compte ChatGPT, comme sur le PC : Codex donne la page d'OpenAI (`url`), qui renvoie
   * le navigateur vers `retour` (127.0.0.1:1455 de cette machine). L'app écoute ce port sur le PC le temps
   * de la connexion et transmet le retour ici (`relayerRetour`). `mode: "code"` : par code d'appareil
   * (lien + code à saisir), quand l'app ne peut pas écouter ce port. Codex attend 15 min au plus ;
   * l'app relit le compte jusqu'à ce qu'il soit connecté.
   */
  async function connecter(mode = "navigateur") {
    await pret();
    if (connexion) void requete("account/login/cancel", { loginId: connexion.loginId }).catch(() => undefined);
    connexion = null;
    const parCode = mode === "code";
    const r = await requete("account/login/start", { type: parCode ? "chatgptDeviceCode" : "chatgpt" });
    if (r?.type !== (parCode ? "chatgptDeviceCode" : "chatgpt")) throw new Error("Codex ne propose pas cette connexion sur ce VPS.");
    const loginId = r.loginId;
    const delai = setTimeout(() => {
      arreterDEcouter();
      if (connexion?.loginId === loginId) connexion = null;
      void requete("account/login/cancel", { loginId }).catch(() => undefined);
    }, CONNEXION_MAX_MS);
    const arreterDEcouter = (() => {
      const ecouteur = (method, params) => {
        if (method !== "account/login/completed" || (params.loginId && params.loginId !== loginId)) return;
        clearTimeout(delai);
        ecouteurs.delete(ecouteur);
        if (connexion?.loginId === loginId) connexion = { ...connexion, fini: true, erreur: params.success ? null : params.error || "La connexion a échoué." };
      };
      ecouteurs.add(ecouteur);
      return () => ecouteurs.delete(ecouteur);
    })();
    if (parCode) {
      connexion = { loginId, retour: null, fini: false, erreur: null };
      return { url: r.verificationUrl, code: r.userCode };
    }
    const retour = new URL(r.authUrl).searchParams.get("redirect_uri") ?? "";
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(retour)) throw new Error("Codex a donné une adresse de retour inattendue.");
    connexion = { loginId, retour: new URL(retour), fini: false, erreur: null };
    return { url: r.authUrl, retour };
  }

  /**
   * Le retour de la page d'OpenAI, reçu par l'app sur le PC (`chemin` : « /auth/callback?code=…&state=… »),
   * rejoué vers Codex sur cette machine. Rend le code HTTP de Codex.
   */
  async function relayerRetour(chemin) {
    const retour = connexion?.retour;
    if (!retour || connexion.fini) throw new Error("Aucune connexion de ChatGPT en cours sur ce VPS.");
    if (typeof chemin !== "string" || chemin.length > 8000 || !chemin.startsWith(`${retour.pathname}?`)) throw new Error("Retour de connexion invalide.");
    const r = await fetch(`${retour.origin}${chemin}`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    return r.status;
  }

  /** Où en est la connexion : `erreur` si elle a échoué. */
  const etatConnexion = () => (connexion ? { fini: connexion.fini, erreur: connexion.erreur } : null);

  async function connecterAvecCle(cle) {
    if (typeof cle !== "string" || !/^\S{10,400}$/.test(cle)) throw new Error("Cette clé ne ressemble pas à une clé API.");
    await pret();
    await requete("account/login/start", { type: "apiKey", apiKey: cle });
    return compte();
  }

  async function deconnecter() {
    await pret();
    await requete("account/logout", {});
    return compte();
  }

  async function modeles() {
    await pret();
    const liste = [];
    let cursor = null;
    do {
      const page = await requete("model/list", cursor ? { cursor } : {});
      for (const m of page.data) {
        if (m.hidden) continue;
        liste.push({ id: m.id, nom: m.displayName, efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort), effortParDefaut: m.defaultReasoningEffort, parDefaut: m.isDefault });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return liste;
  }

  return { trouver, compte, connecter, relayerRetour, etatConnexion, connecterAvecCle, deconnecter, modeles, envoyer, autoriser, annuler, fermer };
}
