/**
 * Les agents sur le VPS : Claude Code lancé comme dans l'app (electron/claude.ts, streamAgent),
 * un processus par conversation, gardé ouvert entre les messages ; ou Codex pour ChatGPT (codex.mjs),
 * quand la conversation le demande (`moteur: "codex"`). Les IA à consulter (ia.mjs) leur sont données
 * par l'outil MCP `demander_ia`, et l'atelier d'un agent à l'assistant (`proposer_agent`,
 * `proposer_choix`, son épreuve : atelier-agent.mjs et epreuve.mjs, les mêmes règles que sur le PC).
 * Ce qui n'existe que sur le PC n'est pas là : outils des fils, Composio, planning, pièces jointes,
 * consommation détaillée.
 *
 * Chaque événement part dans le journal (`journal.mjs`) avec le numéro de la réponse (requestId) :
 * l'app le lit en direct, et rattrape ce qu'elle a manqué en se reconnectant.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appelAtelier, CONSIGNE_ATELIER, OUTIL_CHOIX, OUTIL_PROPOSER, OUTILS_ATELIER, SUIVI_VIDE } from "./atelier-agent.mjs";
import { ARGS_JUGE, argsEssai, consigneEssai, consigneJuge, definitionEssai, lireSortieImprimee, PILIERS_LISTE, resultatEssai } from "./epreuve.mjs";
import { lireJsonPartiel } from "./json-partiel.mjs";
import { dossierHorsProjet } from "./atelier.mjs";
import {
  competencesPrechargees,
  creerSouvenir as creerSouvenirDans,
  dossierMemoire,
  ecrireSouvenir as ecrireSouvenirDans,
  lireCompetences,
  lireMemoire,
  lireSouvenir,
  porteeDeLaFiche,
  promptAvecSkill,
  skillsConnues,
} from "./connaissances-agent.mjs";
import { ecartModelUsage } from "./consommation-ecart.mjs";
import { diagnostiquerPoste } from "./diagnostic-poste.mjs";
import { creerRendus } from "./rendus.mjs";
import { creerCodex } from "./codex.mjs";

/** Ces outils attendent une réponse que l'app ne sait pas afficher : l'agent bloquerait. */
const OUTILS_BLOQUANTS = ["AskUserQuestion", "EnterPlanMode"];
/** Outils de Claude Code sans usage ici (~4 900 jetons à chaque appel) : les mêmes que dans l'app (electron/claude.ts). */
const OUTILS_HORS_APP = ["CronCreate", "CronDelete", "CronList", "RemoteTrigger", "ScheduleWakeup", "PushNotification", "Workflow", "DesignSync", "ReportFindings", "SendToProject", "SendToProjectContext", "ListAgents"];
const AGENTS_DE_CLAUDE = ["general-purpose", "Explore", "Plan", "statusline-setup", "claude", "claude-code-guide", "output-style-setup"];
const REGLE_AGENTS = JSON.stringify({ permissions: { ask: ["Agent"] } });
const VEILLE_MS = 30 * 60 * 1000;
const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** La configuration KLYRA reçue du PC, vérifiée : mémoire coupée ou non, consignes (texte court). */
function configurationValide(c) {
  return {
    memoireAgents: c?.memoireAgents !== false,
    consignes: typeof c?.consignes === "string" && c.consignes.trim() && c.consignes.length <= 20_000 ? c.consignes.trim() : null,
  };
}

/** Les mêmes que dans l'app (electron/claude.ts) : ne pas les changer d'un seul côté. */
const REGLES_COMMUNES = `L'auteur vérifie lui-même ce qu'il livre et dit ce qu'il a contrôlé ; une relecture par un agent de contrôle (QA) n'a lieu que si la personne l'a demandée pour ce livrable. L'accès que l'app donne (fichiers, commandes, accès complet) ne vaut pas accord : envoyer, publier, payer, supprimer, engager un prix ou un délai, toucher à la production ou aux données réelles demandent l'accord de la personne qui décide ; ce qu'elle a déjà autorisé ne se redemande pas. N'invente aucun fait : ni prix, ni délai, ni autorisation, ni horaire, coordonnée, chiffre ou promesse au nom de quelqu'un ; ce qui manque reste visible, marqué [à compléter], sans faux numéro ni faux lien. Ce qui se mesure (tests, liens, contrastes, rendu) se vérifie avec ce que le projet et le poste offrent déjà : trouve l'outil qu'il faut par une recherche ciblée (which, chemins habituels), n'installe rien et ne fouille pas des dossiers sans rapport sans accord, et dis ce qui n'a pas pu être vérifié.`;
const UN_RESPONSABLE = `Un livrable, un responsable : un livrable va entier à un seul agent, celui de sa partie principale, qui fait aussi les petites parties voisines (les textes d'une page qu'il intègre, par exemple). Plusieurs agents seulement pour des parties lourdes et indépendantes, menées en parallèle, jamais en relais de l'un à l'autre : chaque passage de main fait tout relire. Une tâche que tu ferais en quelques minutes, fais-la toi-même ; si la personne demande expressément son équipe, suis-la avec le moins d'agents possible.`;
const LIVRER_EN_FICHIERS = `Livre ton travail dans des fichiers ; ta réponse finale est un compte rendu court qui donne leurs chemins, sans recopier leur contenu.`;
/** Comme CONSIGNE_ARTEFACTS de l'app (electron/claude.ts) : tout fichier demandé se publie avant « livré ». */
const CONSIGNE_ARTEFACTS = `Publie avec publier_artefact (chemin complet sur ce VPS, ou dossier d'une page avec index.html ; un titre court ; à quoi il sert) chaque fichier qu'on t'a demandé de produire, quel que soit son format, que la demande vienne de la personne ou de l'agent qui t'a confié le travail, et tout rendu qu'elle doit voir : l'app en garde une copie sur son ordinateur et elle le retrouve dans l'écran Artefacts. Publie-le avant de dire que c'est livré. Pas pour un fichier de travail intermédiaire ni pour du code source d'un projet.`;
const OUTIL_PUBLIER = "mcp__klyra__publier_artefact";

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
/** La conversation d'une session, pour suivre son atelier (cf. klyra-serveur.mjs, `cleConversation`). */
const CONVERSATION = /^[A-Za-z0-9_.:@|-]{1,160}$/;
/** L'entrée de cet outil est montrée pendant que le modèle l'écrit : la carte de l'atelier (cf. electron/claude.ts). */
const OUTIL_EN_DIRECT = `mcp__klyra__${OUTIL_PROPOSER.name}`;

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
      return {
        assistant: typeof equipe.assistant === "string" ? equipe.assistant : null,
        actifs: Array.isArray(equipe.actifs) ? equipe.actifs : [],
        configuration: configurationValide(equipe.configuration),
        empreinte: equipe.empreinte ?? "",
      };
    } catch {
      return { assistant: null, actifs: [], configuration: configurationValide(null), empreinte: "" };
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
  /** Comme `environnementAgent` de l'app : sans les skills livrées, et sans mémoire si la configuration KLYRA la coupe. */
  const environnement = (configuration = { memoireAgents: true }) => {
    const env = { ...process.env, HOME: home, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };
    if (!configuration.memoireAgents) env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
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
    writeFileSync(fichierEquipe, JSON.stringify({ assistant, actifs, configuration: configurationValide(corps.configuration), empreinte: String(corps.empreinte ?? "").slice(0, 80) }), { mode: 0o600 });
  }

  /**
   * Les compétences d'un agent sur ce VPS, pour le panneau de l'app (cf. electron/connaissances-agent.ts) :
   * celles que sa fiche précharge (la fiche copiée depuis le PC), celles du projet et de l'utilisateur
   * klyra. Mêmes gardes que pour un message : un agent valide, un projet sous le dossier personnel.
   */
  function competences(agent, dossier) {
    return lireCompetences(ficheDe(agentValide(agent)), path.join(home, ".claude"), projetValide(dossier));
  }

  /** Un agent de la demande : son identifiant, ou « principal » pour l'assistant. */
  function agentValide(agent) {
    if (agent !== "principal" && (typeof agent !== "string" || !ID_AGENT.test(agent))) throw new Error("Nom d’agent invalide.");
    return agent;
  }

  /** Le dossier d'un projet du VPS (sous le dossier de klyra, existant), ou null hors projet. */
  function projetValide(dossier) {
    if (typeof dossier !== "string" || !dossier) return null;
    const rel = path.relative(path.resolve(home), path.resolve(dossier));
    if (!path.isAbsolute(dossier) || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Un projet du VPS doit être sous ${home}.`);
    if (!existsSync(dossier)) throw new Error(`Le dossier du projet est introuvable sur le VPS : ${dossier}`);
    return dossier;
  }

  /** La fiche d'un agent sur le VPS (copiée depuis le PC), ou null. */
  function ficheDe(agent) {
    if (agent === "principal") return null;
    try {
      return readFileSync(path.join(dossierAgents, `${agent}.md`), "utf8");
    } catch {
      return null;
    }
  }

  /**
   * La mémoire d'un agent sur ce VPS, comme sur le PC (cf. electron/connaissances-agent.ts et main.ts) :
   * la portée vient de sa fiche, le dossier de la conversation (son projet, sinon son atelier retrouvé avec
   * la session). Null : l'agent n'a pas de mémoire.
   */
  function memoireDe(agent, contexte) {
    const id = agentValide(agent);
    const portee = id === "principal" ? "auto" : porteeDeLaFiche(ficheDe(id) ?? "");
    if (!portee) return null;
    const projet = projetValide(contexte?.dossier);
    const sessionId = typeof contexte?.sessionId === "string" && /^[0-9a-f-]{36}$/.test(contexte.sessionId) ? contexte.sessionId : null;
    const travail = projet ?? dossierHorsProjet(atelier, id === "principal" ? null : id, sessionId, path.join(home, ".claude"), existsSync);
    return { portee, dossier: dossierMemoire(id, portee, travail, path.join(home, ".claude")) };
  }
  const exigerMemoire = (agent, contexte) => {
    const m = memoireDe(agent, contexte);
    if (!m) throw new Error("Cet agent n’a pas de mémoire.");
    return m;
  };
  const memoire = {
    lire: (agent, contexte) => {
      const m = memoireDe(agent, contexte);
      return m ? lireMemoire(m.portee, m.dossier) : null;
    },
    souvenir: (agent, contexte, id) => lireSouvenir(exigerMemoire(agent, contexte).dossier, String(id ?? "")),
    ecrire: (agent, contexte, id, contenu, attendu) =>
      ecrireSouvenirDans(exigerMemoire(agent, contexte).dossier, String(id ?? ""), String(contenu ?? ""), typeof attendu === "number" ? attendu : null),
    creer: (agent, contexte, titre, contenu) => creerSouvenirDans(exigerMemoire(agent, contexte).dossier, String(titre ?? ""), String(contenu ?? "")),
  };

  /**
   * La configuration KLYRA adoptée sur le PC (cf. electron/configuration-klyra.ts), reçue avec l'équipe et
   * appliquée à chaque session de ce VPS, d'où qu'elle vienne (PC, téléphone, routine) ; avant la première
   * synchronisation, celle de Claude Code : mémoire gardée, sans consignes.
   */
  function configurationDe() {
    return lireEquipe().configuration;
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
    return `${qui} ${equipe} ${CONSIGNE_ARTEFACTS} ${REGLES_COMMUNES}${options.ia ? ` ${CONSIGNE_ATELIER}` : ""}`;
  }

  function consigneAgent(id) {
    const { assistant, actifs } = lireEquipe();
    const autres = actifs.filter((a) => a.id !== id);
    const equipe = autres.length
      ? `Dans cette app, les agents que la personne a choisis sont : ${listeAgents(autres)}, et son assistant ${assistant ?? "l'assistant"} (principal). Ne confie du travail qu'à eux ; un collègue cité dans ta fiche mais absent ici n'est pas joignable : fais ta part et dis ce qui reste.`
      : `Dans cette app, la personne n'a pas d'autre agent que toi et son assistant ${assistant ?? "l'assistant"} (principal) : un collègue cité dans ta fiche n'est pas joignable ici. Fais ta part et dis ce qui reste.`;
    return `${equipe} Si ta fiche cite des outils d'équipe absents de ta session, ils ne valent pas ici : on confie un travail en appelant un agent actif. ${LIVRER_EN_FICHIERS} ${CONSIGNE_ARTEFACTS} ${REGLES_COMMUNES}`;
  }

  const estActif = (id) => lireEquipe().actifs.some((a) => a.id === id);
  /* Les livrables des agents (outil publier_artefact du serveur MCP local) : retenus ici, recopiés par l'app. */
  const rendus = creerRendus({ home, donnees, publier });
  options.ia?.surPublication((appelant, args) => rendus.publier(appelant, args));
  /** La configuration MCP d'une session : l'agent et la conversation en en-têtes (qui publie). */
  const mcpIa = (demande = {}) => options.ia?.configMcp({ agent: demande.agent ?? "principal", conversation: demande.conversation ?? demande.contexte?.chatId ?? "" }) ?? null;

  /* ─── L'atelier d'un agent, avec l'assistant (comme sur le PC) ───── */

  /**
   * Le VPS n'a pas le fil de la conversation : il suit ici, par conversation, la carte que chaque appel
   * complète et les phrases ajoutées pendant l'épreuve. En mémoire : après un redémarrage, la carte
   * repart de l'appel suivant (la carte affichée, elle, vient du fil sur le PC).
   */
  const ateliers = new Map();
  const equipeAtelier = () => {
    const { assistant, actifs } = lireEquipe();
    return [{ id: "principal", noms: [assistant ?? "", "Assistant"].filter(Boolean) }, ...actifs.map((a) => ({ id: a.id, noms: [a.nom] }))];
  };
  const noterAtelier = (cle, suivi) => {
    if (!cle) return;
    ateliers.delete(cle);
    ateliers.set(cle, suivi);
    if (ateliers.size > 200) ateliers.delete(ateliers.keys().next().value);
  };
  options.ia?.brancherOutils?.({
    lister: (appelant) => (appelant.agent === "principal" ? [OUTIL_PROPOSER, OUTIL_CHOIX] : []),
    appeler: async (nom, args, appelant) => {
      if (nom !== OUTIL_PROPOSER.name && nom !== OUTIL_CHOIX.name) return null;
      if (appelant.agent !== "principal") return { texte: "Seul l'assistant crée des agents avec la personne.", erreur: true };
      const cle = CONVERSATION.test(appelant.conversation) ? appelant.conversation : null;
      const r = appelAtelier(nom, args, (cle && ateliers.get(cle)) || SUIVI_VIDE, equipeAtelier());
      if (!r.erreur) noterAtelier(cle, r.suivi);
      return { texte: r.texte, erreur: r.erreur };
    },
  });

  /** Les phrases ajoutées par la personne pendant l'épreuve (reçues avec l'essai) : l'assistant les verra. */
  function noterAjouts(conversation, ajouts) {
    if (typeof conversation !== "string" || !CONVERSATION.test(conversation) || !Array.isArray(ajouts)) return;
    const valides = ajouts
      .filter((a) => a && PILIERS_LISTE.includes(a.pilier) && typeof a.texte === "string" && a.texte.trim())
      .slice(0, 20)
      .map((a) => ({ pilier: a.pilier, texte: a.texte.trim().slice(0, 300) }));
    const suivi = ateliers.get(conversation);
    if (suivi) noterAtelier(conversation, { ...suivi, ajouts: valides });
  }

  /**
   * L'épreuve sur ce VPS (comme `essayerBrouillon` de l'app) : la fiche répond à une demande comme agent
   * de la session, sans aucun outil, dans un dossier vide supprimé après ; puis un tour de Haiku la juge.
   * Rend le résultat et ce que les deux tours ont consommé.
   */
  async function essayer(brouillon, cas, contexte) {
    const b = brouillon && typeof brouillon === "object" ? brouillon : {};
    const texte = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    const fiche = texte(b.fiche, 50_000);
    const demande = { type: ["floue", "hors-metier"].includes(cas?.type) ? cas.type : "normal", demande: texte(cas?.demande, 2000) };
    noterAjouts(contexte?.conversation, contexte?.ajouts);
    const echec = (erreur) => ({ resultat: resultatEssai(demande, fiche, { texte: "", jetons: 0, erreur }, null), consommation: [] });
    const bin = trouverClaude();
    if (!bin) return echec("Claude Code n’est pas installé sur le VPS. Relance la commande d’installation.");
    if (etat() !== "pret") return echec("Claude Code n’est pas connecté sur le VPS. Lance « connecter-claude » avec la commande d’installation.");
    const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-essai-"));
    try {
      const { id, json } = definitionEssai({ id: texte(b.id, 64), description: texte(b.description, 1200), corps: texte(b.corps, 40_000), modele: texte(b.modele, 10) });
      const definition = path.join(dossier, "agent.json");
      writeFileSync(definition, json, { mode: 0o600 });
      const essai = await tourImprime(bin, argsEssai(definition, id, consigneEssai(REGLES_COMMUNES)), dossier, demande.demande);
      const juge = essai.erreur ? null : await tourImprime(bin, ARGS_JUGE, dossier, consigneJuge(fiche, demande, essai.texte));
      /* Ce que l'épreuve a consommé, rendu au PC qui l'inscrit dans son journal (comme une réponse du VPS). */
      const consommation = [essai, juge].flatMap((t) => (t?.usage ? ecartModelUsage(t.usage, {}).lignes : []));
      return { resultat: resultatEssai(demande, fiche, essai, juge), consommation };
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  }

  /** Un tour de Claude Code en mode impression, avec l'environnement des agents de ce VPS. */
  function tourImprime(bin, args, cwd, entree) {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, env: environnement(configurationDe()), stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-4000)));
      const minuterie = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
      child.on("error", (e) => {
        clearTimeout(minuterie);
        resolve({ texte: "", jetons: 0, erreur: `Impossible de lancer Claude Code sur le VPS : ${e.message}` });
      });
      child.on("close", (code, signal) => {
        clearTimeout(minuterie);
        if (signal) return resolve({ texte: "", jetons: 0, erreur: "Essai arrêté." });
        const sortie = lireSortieImprimee(stdout, code);
        if (!sortie.usage && !sortie.texte && !sortie.erreur) return resolve({ texte: "", jetons: 0, erreur: stderr.trim().slice(0, 600) || `Claude Code s’est arrêté sur le VPS (code ${code}).` });
        resolve({ texte: sortie.texte, jetons: sortie.jetons, usage: sortie.usage, erreur: sortie.erreur });
      });
      child.stdin.end(entree);
    });
  }

  const codex = creerCodex({
    home,
    version: options.version ?? "1",
    publier,
    consigne: (agent) => `${ici()}\n\n${agent === null ? consigneAssistant() : consigneAgent(agent)}`,
    consignesKlyra: () => lireEquipe().configuration.consignes,
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
      /* La carte de l'atelier s'écrit pendant que le modèle remplit l'outil (comme dans l'app). */
      if (parent === null && typeof ev.index === "number") {
        const bloc = ev.content_block;
        if (ev.type === "content_block_start" && bloc?.type === "tool_use" && bloc.id && bloc.name === OUTIL_EN_DIRECT) {
          proc.saisies.set(ev.index, { id: bloc.id, outil: bloc.name, json: "" });
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta" && ev.delta.partial_json) {
          const saisie = proc.saisies.get(ev.index);
          if (saisie) {
            saisie.json += ev.delta.partial_json;
            const entree = lireJsonPartiel(saisie.json);
            const tour = entree ? tourOuSpontane(proc) : null;
            if (entree && tour) tour.emit({ type: "etape-partielle", id: saisie.id, outil: saisie.outil, entree });
          }
        } else if (ev.type === "content_block_stop") proc.saisies.delete(ev.index);
        else if (ev.type === "message_start") proc.saisies.clear();
      }
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
      /* Ce que ce tour a consommé, même un tour vide (tâche de fond), comme dans l'app : l'écart du
         `modelUsage` cumulé (consommation-ecart.mjs), rendu au PC avec la fin de la réponse. */
      const { cumul, lignes } = ecartModelUsage(msg.modelUsage, proc.cumul);
      proc.cumul = cumul;
      proc.aCompter.push(...lignes);
      if (!courant) return;
      if (!courant.activite && !courant.arretee && msg.subtype === "success" && !msg.is_error && !msg.result) return;
      const ok = !courant.arretee && !msg.is_error && msg.subtype === "success";
      const consommation = proc.aCompter.length ? { agent: proc.agent, lignes: proc.aCompter } : undefined;
      proc.aCompter = [];
      finirTour(proc, courant, {
        type: "fin",
        ok,
        texte: typeof msg.result === "string" ? msg.result : "",
        erreur: ok ? undefined : courant.arretee ? "Arrêté par toi." : (typeof msg.result === "string" && msg.result) || "L’agent s’est arrêté sur une erreur.",
        costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
        sessionId: typeof msg.session_id === "string" ? msg.session_id : undefined,
        ...(consommation ? { consommation } : {}),
      });
    }
  }

  function lancer(bin, args, cwd, signature, demande, acces) {
    const child = spawn(bin, args, { cwd, env: environnement(configurationDe()), stdio: ["pipe", "pipe", "pipe"] });
    /* `cumul` : le `modelUsage` déjà compté ; `aCompter` : ce qu'un tour sans réponse a consommé, rendu au suivant. */
    const proc = { child, signature, modele: demande.modele ?? null, acces, tours: [], sessionId: demande.sessionId, veille: null, fond: 0, agent: demande.agent ?? "principal", cumul: {}, aCompter: [], saisies: new Map() };
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
    /* Le serveur MCP sait qui l'appelle : l'agent, et la conversation (publication, atelier suivi). */
    const assistant = demande.agent === null;
    const conversation = typeof demande.conversation === "string" && CONVERSATION.test(demande.conversation) ? demande.conversation : "";
    const mcp = mcpIa(demande);
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
    const configuration = configurationDe();
    const signature = JSON.stringify([cwd, demande.agent, demande.effort ?? null, acces === "projet", lireEquipe().empreinte, options.ia?.generation() ?? 0, precharge.noms, configuration, conversation]);
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
      if (acces === "projet") args.push("--allowedTools", ...COMMANDES_AUTORISEES, ...(mcp ? [OUTIL_IA, OUTIL_PUBLIER, ...(assistant ? OUTILS_ATELIER : [])] : []));
      if (mcp) args.push("--mcp-config", mcp);
      if (demande.agent) args.push("--agent", demande.agent);
      if (demande.sessionId) args.push("--resume", demande.sessionId);
      if (demande.modele) args.push("--model", demande.modele);
      if (demande.effort) args.push("--effort", demande.effort);
      const consigne = demande.agent === null ? consigneAssistant() : consigneAgent(demande.agent);
      args.push("--append-system-prompt", [ici(), consigne, ...(configuration.consignes ? [configuration.consignes] : []), ...(precharge.texte ? [precharge.texte] : [])].join("\n\n"));
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

  /** Ce que la configuration de Claude Code de ce VPS ajoute à chaque appel (cf. electron/diagnostic-poste.ts), avec ses agents actifs. */
  const diagnostic = () => diagnostiquerPoste(home, lireEquipe().actifs.map((a) => a.id), path.join(home, ".claude"));

  return { etat, envoyer, autoriser, annuler, recevoirFiches, competences, memoire, diagnostic, rendus, essayer, empreinteEquipe: () => lireEquipe().empreinte, fermerTout, claude, codex };
}
