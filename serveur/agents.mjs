/**
 * Les agents sur le VPS : Claude Code lancé comme dans l'app (electron/claude.ts, streamAgent),
 * un processus par conversation, gardé ouvert entre les messages ; ou Codex pour ChatGPT (codex.mjs),
 * quand la conversation le demande (`moteur: "codex"`). Les IA à consulter (ia.mjs) leur sont données
 * par l'outil MCP `demander_ia`.
 * Ce qui n'existe que sur le PC n'est pas là : outils de l'app (fils, proposer_agent), Composio,
 * planning, pièces jointes, consommation détaillée.
 *
 * Chaque événement part dans le journal (`journal.mjs`) avec le numéro de la réponse (requestId) :
 * l'app le lit en direct, et rattrape ce qu'elle a manqué en se reconnectant.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dossierHorsProjet } from "./atelier.mjs";
import { competencesPrechargees, promptAvecSkill, skillsConnues } from "./connaissances-agent.mjs";
import { creerCodex } from "./codex.mjs";

/** Ces outils attendent une réponse que l'app ne sait pas afficher : l'agent bloquerait. */
const OUTILS_BLOQUANTS = ["AskUserQuestion", "EnterPlanMode"];
/** Outils de Claude Code sans usage ici (~4 900 jetons à chaque appel) : les mêmes que dans l'app (electron/claude.ts). */
const OUTILS_HORS_APP = ["CronCreate", "CronDelete", "CronList", "RemoteTrigger", "ScheduleWakeup", "PushNotification", "Workflow", "DesignSync", "ReportFindings", "SendToProject", "SendToProjectContext", "ListAgents"];
const AGENTS_DE_CLAUDE = ["general-purpose", "Explore", "Plan", "statusline-setup", "claude", "claude-code-guide", "output-style-setup"];
const REGLE_AGENTS = JSON.stringify({ permissions: { ask: ["Agent"] } });
const VEILLE_MS = 30 * 60 * 1000;
const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Les mêmes que dans l'app (electron/claude.ts) : ne pas les changer d'un seul côté. */
const REGLES_COMMUNES = `L'auteur vérifie lui-même ce qu'il livre et dit ce qu'il a contrôlé ; une relecture par un agent de contrôle (QA) n'a lieu que si la personne l'a demandée pour ce livrable. L'accès que l'app donne (fichiers, commandes, accès complet) ne vaut pas accord : envoyer, publier, payer, supprimer, engager un prix ou un délai, toucher à la production ou aux données réelles demandent l'accord de la personne qui décide ; ce qu'elle a déjà autorisé ne se redemande pas. N'invente aucun fait : ni prix, ni délai, ni autorisation, ni horaire, coordonnée, chiffre ou promesse au nom de quelqu'un ; ce qui manque reste visible, marqué [à compléter], sans faux numéro ni faux lien. Ce qui se mesure (tests, liens, contrastes, rendu) se vérifie avec ce que le projet et le poste offrent déjà : trouve l'outil qu'il faut par une recherche ciblée (which, chemins habituels), n'installe rien et ne fouille pas des dossiers sans rapport sans accord, et dis ce qui n'a pas pu être vérifié.`;
const UN_RESPONSABLE = `Un livrable, un responsable : un livrable va entier à un seul agent, celui de sa partie principale, qui fait aussi les petites parties voisines (les textes d'une page qu'il intègre, par exemple). Plusieurs agents seulement pour des parties lourdes et indépendantes, menées en parallèle, jamais en relais de l'un à l'autre : chaque passage de main fait tout relire. Une tâche que tu ferais en quelques minutes, fais-la toi-même ; si la personne demande expressément son équipe, suis-la avec le moins d'agents possible.`;
const LIVRER_EN_FICHIERS = `Livre ton travail dans des fichiers ; ta réponse finale est un compte rendu court qui donne leurs chemins, sans recopier leur contenu.`;

const COMMANDES_AUTORISEES = [
  "Bash(pnpm:*)",
  "Bash(npx tsc:*)",
  "Bash(npx eslint:*)",
  "Bash(node:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git branch:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(grep:*)",
  "Bash(find:*)",
  "Bash(wc:*)",
];

const EFFORTS_CLAUDE = ["low", "medium", "high", "xhigh", "max"];
const EFFORTS_CODEX = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const OUTIL_IA = "mcp__klyra__demander_ia";

const modeDe = (acces) => (acces === "demander" ? "manual" : acces === "projet" ? "auto" : "acceptEdits");

/**
 * @param {{ home: string, donnees: string, nomServeur: string, publier: (requestId: string, event: object, sessionId: string | null) => void,
 *   spontane: (sessionId: string) => string | null, claude?: string | null, codex?: string | null, version?: string,
 *   ia?: { configMcp: () => string | null, generation: () => number } | null }} options
 */
export function creerAgents(options) {
  const { home, donnees, nomServeur, publier } = options;
  const atelier = path.join(home, "atelier");
  const dossierAgents = path.join(home, ".claude", "agents");
  const fichierEquipe = path.join(donnees, "equipe.json");

  /** Les agents actifs du PC et le nom de l'assistant, envoyés par l'app avec les fiches. */
  const lireEquipe = () => {
    try {
      const equipe = JSON.parse(readFileSync(fichierEquipe, "utf8"));
      return { assistant: typeof equipe.assistant === "string" ? equipe.assistant : null, actifs: Array.isArray(equipe.actifs) ? equipe.actifs : [], empreinte: equipe.empreinte ?? "" };
    } catch {
      return { assistant: null, actifs: [], empreinte: "" };
    }
  };

  const trouverClaude = () => {
    if (options.claude !== undefined) return options.claude;
    for (const chemin of [path.join(home, ".local", "bin", "claude"), "/usr/local/bin/claude", "/usr/bin/claude"]) {
      if (existsSync(chemin)) return chemin;
    }
    return null;
  };

  const jetonClaude = () => {
    try {
      return readFileSync(path.join(donnees, "claude-token"), "utf8").trim() || null;
    } catch {
      return null;
    }
  };

  /** Prêt si Claude Code est installé et connecté (jeton longue durée, ou connexion faite à la main). */
  function etat() {
    if (!trouverClaude()) return "absent";
    if (jetonClaude() || existsSync(path.join(home, ".claude", ".credentials.json"))) return "pret";
    return "non-connecte";
  }

  /* Sans les skills livrées avec Claude Code (~2 300 jetons à chaque appel), comme dans l'app. */
  const environnement = () => {
    const env = { ...process.env, HOME: home, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };
    const jeton = jetonClaude();
    if (jeton) env.CLAUDE_CODE_OAUTH_TOKEN = jeton;
    return env;
  };

  /* ─── Fiches ────────────────────────────────────────────────────── */

  /** Remplace les fiches du VPS par celles des agents actifs du PC. Le dossier n'a pas d'autre source. */
  function recevoirFiches(corps) {
    const fiches = Array.isArray(corps?.fiches) ? corps.fiches : null;
    if (!fiches || fiches.length > 100) throw new Error("fiches");
    const valides = fiches.filter((f) => f && typeof f.id === "string" && ID_AGENT.test(f.id) && typeof f.contenu === "string" && f.contenu.length <= 200_000);
    if (valides.length !== fiches.length) throw new Error("fiches");
    mkdirSync(dossierAgents, { recursive: true });
    const gardes = new Set(valides.map((f) => `${f.id}.md`));
    for (const nom of readdirSync(dossierAgents)) {
      if (nom.endsWith(".md") && !gardes.has(nom)) rmSync(path.join(dossierAgents, nom), { force: true });
    }
    for (const f of valides) writeFileSync(path.join(dossierAgents, `${f.id}.md`), f.contenu, { mode: 0o600 });
    const actifs = valides.map((f) => ({ id: f.id, nom: typeof f.nom === "string" && f.nom.trim() ? f.nom.trim().slice(0, 80) : f.id }));
    const assistant = typeof corps.assistant === "string" ? corps.assistant.trim().slice(0, 80) || null : null;
    writeFileSync(fichierEquipe, JSON.stringify({ assistant, actifs, empreinte: String(corps.empreinte ?? "").slice(0, 80) }), { mode: 0o600 });
  }

  /* ─── Consignes ─────────────────────────────────────────────────── */

  const listeAgents = (agents) => agents.map((a) => (a.nom === a.id ? a.id : `${a.nom} (${a.id})`)).join(", ");
  const ici = () =>
    `Tu tournes sur le VPS « ${nomServeur} » de la personne, pas sur son ordinateur : ses fichiers locaux, son calendrier, ses rappels et les outils de l'app (fils, Composio) n'existent pas ici. Tu peux travailler dans ce serveur, avec les droits de l'utilisateur klyra.`;

  function consigneAssistant() {
    const { assistant, actifs } = lireEquipe();
    const qui = `Dans cette app, tu es ${assistant ? `${assistant}, ` : ""}l'assistant personnel de la personne. Qualifie le résultat attendu et prends le chemin utile le plus court : réponds toi-même aux demandes simples, et fais toi-même, dans tes capacités et tes accès, ce qu'aucun de ses agents ne fera mieux.`;
    const equipe = actifs.length
      ? `Les agents qu'elle a choisis dans « Mes agents » : ${listeAgents(actifs)}. Tu ne confies du travail qu'à eux, en les appelant avec un brief qui se suffit (objectif, contexte et chemins, contraintes, critère de fin, le livrable attendu dans des fichiers et un compte rendu court) ; n'en invente pas d'autre. ${UN_RESPONSABLE} Ne refais pas en parallèle ce que tu as confié. Avant de dire que c'est livré, vérifie par les preuves reçues et un coup d'œil ciblé, sans relire tout le livrable ni refaire un contrôle déjà prouvé, et rends un résultat court : ce qui est livré, où le voir, ce qui a été vérifié, les limites, la décision qui reste.`
      : `Elle n'a encore choisi aucun agent dans « Mes agents » : tu fais le travail toi-même, ou tu dis précisément ce qui manque. N'invente aucun collègue.`;
    return `${qui} ${equipe} ${REGLES_COMMUNES}`;
  }

  function consigneAgent(id) {
    const { assistant, actifs } = lireEquipe();
    const autres = actifs.filter((a) => a.id !== id);
    const equipe = autres.length
      ? `Dans cette app, les agents que la personne a choisis sont : ${listeAgents(autres)}, et son assistant ${assistant ?? "l'assistant"} (principal). Ne confie du travail qu'à eux ; un collègue cité dans ta fiche mais absent ici n'est pas joignable : fais ta part et dis ce qui reste.`
      : `Dans cette app, la personne n'a pas d'autre agent que toi et son assistant ${assistant ?? "l'assistant"} (principal) : un collègue cité dans ta fiche n'est pas joignable ici. Fais ta part et dis ce qui reste.`;
    return `${equipe} Si ta fiche cite des outils d'équipe absents de ta session, ils ne valent pas ici : on confie un travail en appelant un agent actif. ${LIVRER_EN_FICHIERS} ${REGLES_COMMUNES}`;
  }

  const estActif = (id) => lireEquipe().actifs.some((a) => a.id === id);
  const mcpIa = () => options.ia?.configMcp() ?? null;

  const codex = creerCodex({
    home,
    version: options.version ?? "1",
    publier,
    consigne: (agent) => `${ici()}\n\n${agent === null ? consigneAssistant() : consigneAgent(agent)}`,
    estActif,
    mcp: mcpIa,
    generation: () => `${lireEquipe().empreinte}|${options.ia?.generation() ?? 0}`,
    ...(options.codex !== undefined ? { codex: options.codex } : {}),
  });

  const agentAutorise = (type) => typeof type !== "string" || !type || estActif(type) || AGENTS_DE_CLAUDE.includes(type);

  /* ─── Processus et réponses ─────────────────────────────────────── */

  const processus = new Map();
  const parRequete = new Map();
  const demandes = new Map();

  const vivant = (proc) => proc.child.exitCode === null && proc.child.signalCode === null && !proc.child.stdin?.writableEnded;
  const ecrire = (proc, message) => proc.child.stdin?.write(`${JSON.stringify(message)}\n`);
  const controle = (proc, request) => ecrire(proc, { type: "control_request", request_id: randomUUID(), request });

  function repondre(child, demandeId, accepte, entree, regles = [], message = "Refusé : la personne n’a pas donné son accord.") {
    const reponse = accepte ? { behavior: "allow", updatedInput: entree, ...(regles.length ? { updatedPermissions: regles } : {}) } : { behavior: "deny", message };
    child.stdin?.write(`${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: demandeId, response: reponse } })}\n`);
  }

  function nouveauTour(proc, requestId, acces) {
    let jetons = 0;
    let envoyes = 0;
    let dernier = 0;
    const tour = {
      requestId,
      acces,
      finie: false,
      arretee: false,
      activite: false,
      etapesDepuisTexte: false,
      dejaDuTexte: false,
      emit: (event) => publier(requestId, event, proc.sessionId),
      compter: (n) => {
        jetons += n;
        const maintenant = Date.now();
        if (jetons !== envoyes && maintenant - dernier > 300) {
          envoyes = jetons;
          dernier = maintenant;
          tour.emit({ type: "jetons", total: Math.round(jetons) });
        }
      },
    };
    return tour;
  }

  function ajouterTour(proc, tour) {
    if (proc.veille) clearTimeout(proc.veille);
    proc.veille = null;
    proc.tours.push(tour);
    parRequete.set(tour.requestId, { proc, tour });
  }

  function finirTour(proc, tour, event) {
    if (tour.finie) return;
    tour.finie = true;
    proc.tours = proc.tours.filter((t) => t !== tour);
    parRequete.delete(tour.requestId);
    demandes.delete(tour.requestId);
    tour.emit(event);
    if (!proc.tours.length && !proc.fond && vivant(proc)) proc.veille = setTimeout(() => proc.child.stdin?.end(), VEILLE_MS);
  }

  /** La réponse en cours ; sans elle, une tâche de fond fait reparler l'agent : une réponse spontanée s'ouvre. */
  function tourOuSpontane(proc) {
    if (proc.tours[0]) return proc.tours[0];
    if (!proc.sessionId) return null;
    proc.fond = Math.max(0, proc.fond - 1);
    const requestId = options.spontane(proc.sessionId);
    if (!requestId) return null;
    const tour = nouveauTour(proc, requestId, proc.acces);
    ajouterTour(proc, tour);
    return tour;
  }

  function lireLigne(proc, ligne) {
    if (!ligne.trim()) return;
    let msg;
    try {
      msg = JSON.parse(ligne);
    } catch {
      return;
    }
    const parent = msg.parent_tool_use_id ?? null;
    const courant = proc.tours[0] ?? null;

    if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
      proc.sessionId = msg.session_id;
      processus.set(msg.session_id, proc);
      courant?.emit({ type: "session", sessionId: msg.session_id });
      return;
    }
    if (msg.type === "system" && msg.subtype === "thinking_tokens" && typeof msg.estimated_tokens_delta === "number") {
      courant?.compter(msg.estimated_tokens_delta);
      return;
    }
    /* La conversation résumée : son résultat arrive vide, mais c'est bien la réponse à « /compact » (cf. electron/claude.ts). */
    if (msg.type === "system" && msg.subtype === "compact_boundary") {
      if (!courant) return;
      courant.activite = true;
      courant.emit({ type: "compacte", avant: msg.compact_metadata?.pre_tokens ?? 0, apres: msg.compact_metadata?.post_tokens ?? 0 });
      return;
    }
    if (msg.type === "stream_event") {
      const ev = msg.event ?? {};
      const morceau = ev.delta?.text ?? ev.delta?.partial_json ?? "";
      if (morceau) courant?.compter(morceau.length / 4);
      if (parent === null && ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        const tour = tourOuSpontane(proc);
        if (!tour) return;
        tour.emit({ type: "texte", delta: ev.delta.text, nouveauBloc: tour.dejaDuTexte && tour.etapesDepuisTexte });
        tour.etapesDepuisTexte = false;
        tour.dejaDuTexte = true;
      }
      return;
    }
    if (msg.type === "assistant") {
      const contenu = msg.message?.content ?? [];
      const outils = contenu.filter((b) => b.type === "tool_use" && b.id && b.name);
      const tour = parent === null && outils.length ? tourOuSpontane(proc) : courant;
      if (!tour) return;
      if (parent === null) {
        tour.activite = true;
        const u = msg.message?.usage;
        const jetons = u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0;
        if (jetons > 0) tour.emit({ type: "contexte", jetons });
      }
      for (const bloc of outils) {
        if (bloc.input?.run_in_background === true) proc.fond += 1;
        tour.emit({ type: "etape", id: bloc.id, outil: bloc.name, entree: bloc.input ?? {}, parent });
        if (parent === null) tour.etapesDepuisTexte = true;
      }
      return;
    }
    if (msg.type === "user") {
      if (!courant) return;
      for (const bloc of msg.message?.content ?? []) {
        if (bloc.type !== "tool_result" || !bloc.tool_use_id) continue;
        const brut = typeof bloc.content === "string" ? bloc.content : JSON.stringify(bloc.content ?? "");
        courant.emit({ type: "etape-fin", id: bloc.tool_use_id, ok: !bloc.is_error, apercu: brut.slice(0, 400) });
      }
      return;
    }
    if (msg.type === "control_request") {
      const req = msg.request ?? {};
      const demandeId = msg.request_id;
      if (req.subtype !== "can_use_tool" || typeof demandeId !== "string") return;
      const entree = req.input ?? {};
      /* Confier à un agent : seulement les agents actifs, même en accès complet. */
      if (req.tool_name === "Agent" || req.tool_name === "Task") {
        if (agentAutorise(entree.subagent_type)) return repondre(proc.child, demandeId, true, entree);
        return repondre(proc.child, demandeId, false, entree, [], `« ${String(entree.subagent_type)} » n’est pas dans Mes agents. Ne le rappelle pas ; fais le travail toi-même.`);
      }
      const tour = tourOuSpontane(proc);
      if ((tour?.acces ?? proc.acces) === "tout") return repondre(proc.child, demandeId, true, entree);
      if (!tour) return repondre(proc.child, demandeId, false, entree);
      if (!demandes.has(tour.requestId)) demandes.set(tour.requestId, new Map());
      demandes.get(tour.requestId).set(demandeId, { entree, suggestions: req.permission_suggestions ?? [] });
      tour.emit({ type: "autorisation", id: demandeId, outil: req.tool_name ?? "outil", entree, description: req.description ?? "" });
      return;
    }
    if (msg.type === "control_cancel_request" && typeof msg.request_id === "string") {
      if (!courant) return;
      demandes.get(courant.requestId)?.delete(msg.request_id);
      courant.emit({ type: "autorisation-fin", id: msg.request_id, accepte: false });
      return;
    }
    if (msg.type === "result") {
      if (!courant) return;
      if (!courant.activite && !courant.arretee && msg.subtype === "success" && !msg.is_error && !msg.result) return;
      const ok = !courant.arretee && !msg.is_error && msg.subtype === "success";
      finirTour(proc, courant, {
        type: "fin",
        ok,
        texte: typeof msg.result === "string" ? msg.result : "",
        erreur: ok ? undefined : courant.arretee ? "Arrêté par toi." : (typeof msg.result === "string" && msg.result) || "L’agent s’est arrêté sur une erreur.",
        costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
        sessionId: typeof msg.session_id === "string" ? msg.session_id : undefined,
      });
    }
  }

  function lancer(bin, args, cwd, signature, demande, acces) {
    const child = spawn(bin, args, { cwd, env: environnement(), stdio: ["pipe", "pipe", "pipe"] });
    const proc = { child, signature, modele: demande.modele ?? null, acces, tours: [], sessionId: demande.sessionId, veille: null, fond: 0 };
    if (demande.sessionId) processus.set(demande.sessionId, proc);
    let tampon = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      tampon += d.toString();
      const lignes = tampon.split("\n");
      tampon = lignes.pop() ?? "";
      for (const l of lignes) lireLigne(proc, l);
    });
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const finTout = (erreur) => {
      if (proc.veille) clearTimeout(proc.veille);
      if (proc.sessionId && processus.get(proc.sessionId) === proc) processus.delete(proc.sessionId);
      for (const tour of [...proc.tours]) finirTour(proc, tour, { type: "fin", ok: false, texte: "", erreur: erreur(tour) });
    };
    child.on("error", (error) => finTout(() => `Impossible de lancer Claude Code sur le VPS : ${error.message}`));
    child.on("close", (code, signal) => {
      lireLigne(proc, tampon);
      finTout((tour) => (tour.arretee ? "Arrêté par toi." : signal ? "Arrêté." : stderr.trim().slice(0, 600) || `Claude Code s’est arrêté sur le VPS (code ${code}).`));
    });
    return proc;
  }

  /** Lit et vérifie une demande de l'app. Renvoie un message d'erreur, ou null. */
  function verifier(demande) {
    if (!demande || typeof demande !== "object") return "Demande invalide.";
    if (typeof demande.prompt !== "string" || !demande.prompt || demande.prompt.length > 500_000) return "Message invalide.";
    if (demande.agent !== null && (typeof demande.agent !== "string" || !ID_AGENT.test(demande.agent))) return "Nom d’agent invalide.";
    if (demande.moteur !== undefined && demande.moteur !== null && !["claude", "codex"].includes(demande.moteur)) return `Fournisseur inconnu : ${String(demande.moteur)}.`;
    const codexDemande = demande.moteur === "codex";
    if (demande.sessionId !== null && (typeof demande.sessionId !== "string" || !/^[0-9a-f-]{36}$/.test(demande.sessionId))) return "Session invalide.";
    if (demande.modele && !(codexDemande ? /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,63}$/ : /^[a-z0-9][a-z0-9.\-]{0,63}$/).test(demande.modele)) return "Modèle invalide.";
    if (demande.effort && !(codexDemande ? EFFORTS_CODEX : EFFORTS_CLAUDE).includes(demande.effort)) return "Effort invalide.";
    if (demande.acces && !["demander", "projet", "tout"].includes(demande.acces)) return "Accès invalide.";
    if (demande.dossier !== null && demande.dossier !== undefined && (typeof demande.dossier !== "string" || !path.isAbsolute(demande.dossier))) return "Dossier invalide.";
    if (demande.skill !== undefined && demande.skill !== null && (typeof demande.skill !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(demande.skill))) return "Compétence invalide.";
    return null;
  }

  /** Fait répondre un agent. Se termine toujours par un événement `fin` dans le journal. */
  function envoyer(requestId, demande) {
    const echec = (erreur) => publier(requestId, { type: "fin", ok: false, texte: "", erreur }, null);
    const invalide = verifier(demande);
    if (invalide) return echec(invalide);
    if (demande.agent !== null && !estActif(demande.agent)) return echec(`« ${demande.agent} » n’est pas dans Mes agents sur ce VPS.`);

    let cwd = atelier;
    if (demande.dossier) {
      const rel = path.relative(path.resolve(home), path.resolve(demande.dossier));
      if (rel.startsWith("..") || path.isAbsolute(rel)) return echec(`Un projet du VPS doit être sous ${home}.`);
      if (!existsSync(demande.dossier)) return echec(`Le dossier du projet est introuvable sur le VPS : ${demande.dossier}`);
      cwd = demande.dossier;
    } else mkdirSync(atelier, { recursive: true });

    if (demande.moteur === "codex") return codex.envoyer(requestId, demande, cwd);
    // Claude Code hors projet : le dossier de l'agent dans l'atelier (cf. electron/atelier.ts).
    if (!demande.dossier) {
      cwd = dossierHorsProjet(atelier, demande.agent ?? null, demande.sessionId ?? null, path.join(home, ".claude"), existsSync);
      mkdirSync(cwd, { recursive: true });
    }
    const bin = trouverClaude();
    if (!bin) return echec("Claude Code n’est pas installé sur le VPS. Relance la commande d’installation.");
    if (etat() !== "pret") return echec("Claude Code n’est pas connecté sur le VPS. Lance « connecter-claude » avec la commande d’installation.");

    const acces = demande.acces ?? "projet";
    const mcp = mcpIa();
    /* Les skills, comme dans l'app (cf. electron/connaissances-agent.ts) : celles que la fiche précharge,
       que Claude Code ne donne pas à un agent lancé seul, et `/<skill>` remis en tête du message. */
    const configClaude = path.join(home, ".claude");
    let fiche = null;
    try {
      fiche = demande.agent ? readFileSync(path.join(dossierAgents, `${demande.agent}.md`), "utf8") : null;
    } catch {
      fiche = null;
    }
    const precharge = demande.agent ? competencesPrechargees(fiche, configClaude, cwd) : { noms: [], texte: null };
    const prompt = promptAvecSkill(demande.prompt, demande.skill ?? null, skillsConnues(configClaude, cwd));
    const signature = JSON.stringify([cwd, demande.agent, demande.effort ?? null, acces === "projet", lireEquipe().empreinte, options.ia?.generation() ?? 0, precharge.noms]);
    const ouvert = demande.sessionId ? processus.get(demande.sessionId) : undefined;
    let proc;
    if (ouvert && vivant(ouvert) && (ouvert.signature === signature || ouvert.tours.length)) {
      proc = ouvert;
      if ((demande.modele ?? null) !== proc.modele) {
        controle(proc, { subtype: "set_model", ...(demande.modele ? { model: demande.modele } : {}) });
        proc.modele = demande.modele ?? null;
      }
      if (modeDe(acces) !== modeDe(proc.acces)) controle(proc, { subtype: "set_permission_mode", mode: modeDe(acces) });
      proc.acces = acces;
    } else {
      if (ouvert && vivant(ouvert)) ouvert.child.stdin?.end();
      const args = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        // Infos du poste dans le premier message : le cache se partage entre sessions (cf. electron/claude.ts).
        "--exclude-dynamic-system-prompt-sections",
        "--permission-prompt-tool",
        "stdio",
        "--permission-prompts",
        "host",
        "--permission-mode",
        modeDe(acces),
        "--disallowedTools",
        ...OUTILS_BLOQUANTS,
        ...OUTILS_HORS_APP,
        "--settings",
        REGLE_AGENTS,
      ];
      if (acces === "projet") args.push("--allowedTools", ...COMMANDES_AUTORISEES, ...(mcp ? [OUTIL_IA] : []));
      if (mcp) args.push("--mcp-config", mcp);
      if (demande.agent) args.push("--agent", demande.agent);
      if (demande.sessionId) args.push("--resume", demande.sessionId);
      if (demande.modele) args.push("--model", demande.modele);
      if (demande.effort) args.push("--effort", demande.effort);
      const consigne = demande.agent === null ? consigneAssistant() : consigneAgent(demande.agent);
      args.push("--append-system-prompt", [ici(), consigne, ...(precharge.texte ? [precharge.texte] : [])].join("\n\n"));
      proc = lancer(bin, args, cwd, signature, demande, acces);
    }
    ajouterTour(proc, nouveauTour(proc, requestId, acces));
    ecrire(proc, { type: "user", message: { role: "user", content: prompt } });
  }

  function autoriser(requestId, demandeId, decision) {
    if (codex.autoriser(requestId, demandeId, decision)) return true;
    const enCours = parRequete.get(requestId);
    const demande = demandes.get(requestId)?.get(demandeId);
    if (!enCours || !demande || !["oui", "toujours", "non"].includes(decision)) return false;
    const regles = decision === "toujours" ? demande.suggestions.map((r) => ({ ...r, destination: "localSettings" })) : [];
    repondre(enCours.proc.child, demandeId, decision !== "non", demande.entree, regles);
    demandes.get(requestId)?.delete(demandeId);
    enCours.tour.emit({ type: "autorisation-fin", id: demandeId, accepte: decision !== "non" });
    return true;
  }

  function annuler(requestId) {
    if (codex.annuler(requestId)) return true;
    const enCours = parRequete.get(requestId);
    if (!enCours) return false;
    const { proc, tour } = enCours;
    tour.arretee = true;
    if (proc.tours[0] !== tour) return true;
    controle(proc, { subtype: "interrupt" });
    setTimeout(() => {
      if (!tour.finie) proc.child.kill("SIGTERM");
    }, 5000);
    return true;
  }

  function fermerTout() {
    for (const proc of new Set(processus.values())) proc.child.kill("SIGTERM");
    codex.fermer();
  }

  /** Ce que Réglages du serveur › Fournisseurs lit de Claude Code (cf. moteurs.mjs). */
  const claude = {
    trouver: trouverClaude,
    etat,
    methode: () => (jetonClaude() ? "jeton" : "claude.ai"),
    env: environnement,
  };

  return { etat, envoyer, autoriser, annuler, recevoirFiches, empreinteEquipe: () => lireEquipe().empreinte, fermerTout, claude, codex };
}
