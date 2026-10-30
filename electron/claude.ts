import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { enregistrerTourClaude } from "./consommation";
import { configMcp, OUTILS_APP } from "./ia";
import { espaceComposio } from "./composio";
import { agentAutorise, agentsARefuser, dossierAgents as agentsDir, estActif, generation, mesAgents, presentationActifs } from "./mes-agents";
import { DOSSIER_PLANNING, FICHIER_PLANNING } from "./planning";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Lance Claude Code en local (`claude -p`) avec un agent de l'équipe.
 * L'agent ne peut ni écrire ni exécuter de commande : il propose, l'app
 * montre la proposition, et c'est l'utilisateur qui l'applique.
 */

const HOME = os.homedir();

/** Outils retirés à l'agent : il lit et cherche, il n'écrit rien. */
const OUTILS_INTERDITS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"];
const DELAI_MAX_MS = 10 * 60 * 1000;

/** Les clés Composio restent dans main, même si le terminal parent en a exporté une. */
const environnementClaude = () => Object.fromEntries(Object.entries({ ...process.env, ELECTRON_RUN_AS_NODE: undefined }).filter(([nom]) => !/^(COMPOSIO|KLYRA_COMPOSIO)_/.test(nom)));

/** Sous Windows, le binaire natif de Claude Code (un .cmd de npm ne se lance pas sans shell). */
const EXE_CLAUDE = process.platform === "win32" ? "claude.exe" : "claude";

/** Le binaire de l'extension VS Code ou Cursor la plus récente. */
function fromEditorExtensions(): string[] {
  const found: string[] = [];
  for (const base of [".vscode/extensions", ".cursor/extensions"]) {
    const dir = path.join(HOME, base);
    if (!existsSync(dir)) continue;
    const versions = readdirSync(dir)
      .filter((d) => d.startsWith("anthropic.claude-code-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) found.push(path.join(dir, v, "resources", "native-binary", EXE_CLAUDE));
  }
  return found;
}

/** Une app lancée depuis le Finder n'hérite pas du PATH du terminal : on cherche aussi aux endroits habituels. */
export function findClaude(): string | null {
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, EXE_CLAUDE));
  const candidates = [
    process.env.KLYRA_CLAUDE_PATH,
    ...fromPath,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(HOME, ".local", "bin", EXE_CLAUDE),
    path.join(HOME, ".claude", "local", EXE_CLAUDE),
    path.join(HOME, ".npm-global", "bin", "claude"),
    ...fromEditorExtensions(),
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

export interface ClaudeResult {
  ok: boolean;
  text: string;
  /** Message lisible en cas d'échec. */
  error?: string;
  costUsd?: number;
}

const running = new Map<string, ChildProcess>();

/*
 * Ce que Claude Code charge vraiment : toutes les fiches de `~/.claude/agents` (et de `.claude/agents`
 * du projet), celles des plugins et des réglages gérés. Seuls les agents actifs de Mes agents restent :
 * - chaque fiche lue qui n'est pas active est refusée (`Agent(<nom>)`) : le modèle ne la voit plus dans
 *   la liste des agents, et son appel échoue ;
 * - tout appel d'agent passe en plus par l'app (règle `ask`), qui n'accepte que les agents actifs et
 *   ceux de Claude Code (`agentAutorise`) : le filet pour les plugins et les fiches apparues depuis.
 * Les fiches elles-mêmes ne sont jamais touchées : d'autres outils les lisent.
 */
const refusAgents = (cwd: string) => agentsARefuser(cwd).map((nom) => `Agent(${nom})`);
const REGLE_AGENTS = JSON.stringify({ permissions: { ask: ["Agent", "mcp__klyra__composio_executer"] } });

const pasDansMesAgents = (agent: string) => `« ${agent} » n’est pas dans Mes agents : ajoute-le ou réactive-le dans Équipe pour lui écrire.`;

export function runAgent(requestId: string, agent: string, prompt: string): Promise<ClaudeResult> {
  const bin = findClaude();
  if (!bin) {
    return Promise.resolve({ ok: false, text: "", error: "Claude Code est introuvable sur ce poste." });
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agent)) {
    return Promise.resolve({ ok: false, text: "", error: "Nom d’agent invalide." });
  }
  if (!estActif(agent)) return Promise.resolve({ ok: false, text: "", error: pasDansMesAgents(agent) });

  return new Promise((resolve) => {
    // Sans canal d'autorisation ici : l'outil Agent est retiré, l'agent répond seul, et le sait.
    const args = ["-p", "--agent", agent, "--output-format", "json", "--disallowedTools", ...OUTILS_INTERDITS, "Agent", "--append-system-prompt", CONSIGNE_SEUL];
    const child = spawn(bin, args, {
      cwd: HOME,
      env: environnementClaude(),
      windowsHide: true,
    });
    running.set(requestId, child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timeout = setTimeout(() => child.kill("SIGTERM"), DELAI_MAX_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      running.delete(requestId);
      resolve({ ok: false, text: "", error: `Impossible de lancer Claude Code : ${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      running.delete(requestId);
      if (signal) {
        resolve({ ok: false, text: "", error: "Demande annulée." });
        return;
      }
      try {
        const json = JSON.parse(stdout) as { result?: string; is_error?: boolean; total_cost_usd?: number; modelUsage?: unknown };
        // Un seul tour dans ce processus : son total est ce qu'il a consommé.
        enregistrerTourClaude(json.modelUsage, {}, agent);
        if (json.is_error || code !== 0) {
          resolve({ ok: false, text: "", error: json.result || stderr.trim() || `Claude Code a échoué (code ${code}).` });
          return;
        }
        resolve({ ok: true, text: json.result ?? "", costUsd: json.total_cost_usd });
      } catch {
        resolve({ ok: false, text: "", error: stderr.trim() || stdout.trim() || `Claude Code a échoué (code ${code}).` });
      }
    });

    // Le prompt passe par l'entrée standard : aucune limite de longueur ni d'échappement.
    child.stdin.end(prompt);
  });
}

/** Arrête un agent : d'abord poliment, puis de force s'il ne s'est pas arrêté au bout de 3 s. */
export function cancelAgent(requestId: string): void {
  /* Une réponse en direct : on l'interrompt, comme Échap dans VS Code. Claude Code reste
     ouvert, et ce qu'il a lancé en arrière-plan continue. */
  const enCours = parRequete.get(requestId);
  if (enCours) {
    const { proc, tour } = enCours;
    tour.arretee = true;
    if (proc.tours[0] !== tour) return;
    controle(proc, { subtype: "interrupt" });
    // Sans réponse, on le ferme de force : la réponse se termine quand même.
    setTimeout(() => {
      if (!tour.finie) proc.child.kill("SIGTERM");
    }, 5000);
    return;
  }
  const child = running.get(requestId);
  if (!child) return;
  child.stdin?.end();
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 3000);
}

/* ─── Conversation en direct ───────────────────────────────────── */

/** Ce que l'interface reçoit pendant qu'un agent travaille (cf. src/lib/bridge.ts). */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  /** Un morceau du texte de la réponse. `nouveauBloc` : il suit des étapes, on passe à la ligne. */
  | { type: "texte"; delta: string; nouveauBloc: boolean }
  /** Une étape : lire un fichier, lancer une commande, confier à un agent… */
  | { type: "etape"; id: string; outil: string; entree: Record<string, unknown>; parent: string | null }
  | { type: "etape-fin"; id: string; ok: boolean; apercu: string }
  /** Les tokens écrits depuis le début (réflexion, texte, outils, sous-agents compris), estimés en direct. */
  | { type: "jetons"; total: number }
  /** L'agent demande ton accord avant d'utiliser un outil hors de son accès. */
  | { type: "autorisation"; id: string; outil: string; entree: Record<string, unknown>; description: string }
  /** La demande a reçu sa réponse (de toi, ou d'office en accès complet). */
  | { type: "autorisation-fin"; id: string; accepte: boolean }
  | { type: "fin"; ok: boolean; texte: string; erreur?: string; costUsd?: number; sessionId?: string; silencieux?: boolean };

export interface StreamOptions {
  /** Le sous-agent qui répond (`~/.claude/agents/<nom>.md`), ou null pour la session principale. */
  agent: string | null;
  prompt: string;
  /** Dossier du projet : l'agent y travaille. */
  dossier: string | null;
  /** Session à reprendre : l'agent se souvient de la conversation. */
  sessionId: string | null;
  /** Modèle choisi dans la conversation (« opus », « sonnet », « haiku »), ou null : celui de la fiche. */
  modele?: string | null;
  /** Effort de réflexion : low, medium, high, xhigh, max ; null : celui par défaut. */
  effort?: string | null;
  /** Fichiers joints au message : leurs dossiers sont ouverts en lecture à l'agent. */
  fichiers?: string[];
  /**
   * Ce que l'agent peut faire sans demander :
   * - « demander » : il lit seul, et demande pour tout le reste ;
   * - « projet » : fichiers du dossier et commandes de travail seul, il demande pour le reste ;
   * - « tout » : tout lui est accordé, sans demander.
   */
  acces?: "demander" | "projet" | "tout";
  /** La conversation de l'app : les outils des fils savent d'où vient l'agent. */
  chatId?: string;
  /** Réservé par le moteur avant de lancer ce tour. */
  routineRun?: string;
}

/** Réponse à une demande d'autorisation. « toujours » : accordé pour le reste de la session. */
export type Decision = "oui" | "toujours" | "non";

/** Demandes en attente de réponse, par réponse d'agent. */
const demandes = new Map<string, Map<string, { entree: Record<string, unknown>; suggestions: unknown[] }>>();

type Acces = NonNullable<StreamOptions["acces"]>;

/** Une réponse de l'agent : à un de tes messages, ou spontanée, quand une tâche de fond se termine. */
interface Tour {
  requestId: string;
  emit: (event: AgentEvent) => void;
  acces: Acces;
  finie: boolean;
  /** Tu l'as arrêtée : son résultat, même vide, la termine. */
  arretee: boolean;
  /** L'agent a écrit ou agi : un résultat sans activité n'est pas sa réponse. */
  activite: boolean;
  /** Le texte d'un nouveau message après des étapes commence un nouveau bloc. */
  etapesDepuisTexte: boolean;
  dejaDuTexte: boolean;
  compter: (n: number) => void;
}

/**
 * Un Claude Code par conversation, comme dans VS Code : il reste ouvert entre tes messages,
 * qui lui arrivent sur son entrée. Ce qu'il a lancé en arrière-plan (agents, serveurs) continue
 * donc pendant que tu lui écris, et il n'y a jamais deux agents sur la même conversation.
 */
interface Processus {
  routineRun?: string;
  child: ChildProcess;
  /** Ce qui ne change pas en cours de route sans relancer Claude Code. */
  signature: string;
  modele: string | null;
  acces: Acces;
  /** Les réponses attendues, dans l'ordre : la première est en cours. */
  tours: Tour[];
  sessionId: string | null;
  /** Une réponse spontanée s'ouvre dans l'interface par ce rappel. */
  spontane: Spontane;
  veille: ReturnType<typeof setTimeout> | null;
  /** Agents et commandes lancés en arrière-plan, pas encore revenus : tant qu'il y en a, pas de veille. */
  fond: number;
  /** L'agent de ce Claude Code (null : le Principal), pour la consommation. */
  agent: string | null;
  /** Jetons et coût cumulés par modèle depuis le lancement (cf. consommation.ts). */
  cumul: ReturnType<typeof enregistrerTourClaude>;
}

/** Ouvre une réponse spontanée dans l'interface ; null si elle n'est plus là. */
export type Spontane = (sessionId: string) => { requestId: string; emit: (event: AgentEvent) => void } | null;

/** Les fils : comment l'agent confie une tâche à un coéquipier (outils du serveur MCP de l'app). */
const CONSIGNE_FILS = `Dans cette app, une tâche = un fil : une conversation à part d'un agent, ouverte dans un onglet de son chat, qui tourne sans bloquer. Pour confier à un coéquipier (ou à toi-même) un travail qui ne se règle pas tout de suite, utilise l'outil ouvrir_fil avec un brief complet (le fil ne voit pas ta conversation), après avoir regardé avec lister_fils qu'il n'en existe pas déjà un sur le même sujet. Une tâche = un responsable. Quand le coéquipier a fini, sa réponse te revient d'elle-même : ne la surveille pas en boucle. Tu peux lire un fil (lire_fil), y ajouter une précision (ecrire_dans_fil), l'arrêter (arreter_fil), et le fermer (fermer_fil) une fois le travail fait et vérifié. Cite toujours un fil avec son titre et son identifiant : Rapport hebdo (klyra-fil-…). Les fils d'un même agent partagent ses fichiers : évite que deux fils modifient les mêmes fichiers en même temps. Pour une petite recherche rapide, pas besoin de fil.`;

/** Dit à l'agent où lire le planning de la personne (electron/planning.ts). */
const CONSIGNE_PLANNING = `La personne avec qui tu parles a, dans cette app, son calendrier (avec les rendez-vous de son équipe), ses rappels, ses routines, ses projets, ses conversations, ses artefacts et ses workflows. Tout est dans ${FICHIER_PLANNING}, tenu à jour en continu. Quand elle dit « mes rappels », « mon calendrier », « mon agenda », « mes routines », « mes projets »…, c'est de ceux-là qu'elle parle, les siens, pas des apps du Mac (Rappels, Calendrier) : lis ce fichier en premier, avant toute autre recherche, et réponds à partir de lui. Il est en lecture seule : pour y changer quelque chose, dis-lui quoi faire dans l'app.`;

/**
 * Les règles de l'app qui valent pour l'assistant et pour chaque agent, quelle que soit la version de sa fiche :
 * une fiche installée avant leur mise à jour (« validation QA obligatoire », équipe fixe, outils d'un autre
 * système) reçoit les mêmes règles que les modèles actuels, sans être réécrite.
 */
const REGLES_COMMUNES = `L'auteur vérifie lui-même ce qu'il livre et dit ce qu'il a contrôlé ; une relecture par un agent de contrôle (QA) n'a lieu que si la personne l'a demandée pour ce livrable. L'accès que l'app donne (fichiers, commandes, accès complet) ne vaut pas accord : envoyer, publier, payer, supprimer, engager un prix ou un délai, toucher à la production ou aux données réelles demandent l'accord de la personne qui décide ; ce qu'elle a déjà autorisé ne se redemande pas. N'invente ni prix, ni délai, ni autorisation.`;

const listeAgents = (agents: { id: string; nom: string }[]) => agents.map((a) => (a.nom === a.id ? a.id : `${a.nom} (${a.id})`)).join(", ");

/**
 * Qui est l'assistant, et comment il pilote : il répond et fait lui-même ce qui est simple ; il confie aux
 * agents actifs de Mes agents, et à eux seuls, la part qui relève d'eux, suit le travail et rend le résultat vérifié.
 */
function consigneAssistant(outilsApp: boolean): string {
  const nom = mesAgents().assistant.nom;
  const actifs = presentationActifs();
  const qui = `Dans cette app, tu es ${nom ? `${nom}, ` : ""}l'assistant personnel de la personne. Qualifie le résultat attendu et prends le chemin utile le plus court : réponds toi-même aux demandes simples, et fais toi-même, dans tes capacités et tes accès, ce qu'aucun de ses agents ne fera mieux.`;
  const equipe = actifs.length
    ? `Les agents qu'elle a choisis dans « Mes agents » : ${listeAgents(actifs)}. Tu ne confies du travail qu'à eux ; n'en invente pas d'autre et n'ajoute personne pour finir une tâche. Quand une partie relève clairement de l'un d'eux, confie-la-lui avec un brief qui se suffit (objectif, contexte et chemins, contraintes, ce qui est permis ou non, critère de fin), avec l'équipe la plus petite possible, et reste responsable du suivi, de la cohérence et de ce que tu rends. Une tâche, un responsable : ne refais pas en parallèle ce que tu as confié.${outilsApp ? " Reprends le fil déjà ouvert sur le sujet (lister_fils) plutôt que d'en ouvrir un autre." : ""} Le retour arrive de lui-même : ne le surveille pas en boucle. Au plus trois travaux confiés en même temps, seulement s'ils sont indépendants ; au plus deux reprises avec un défaut précis, puis dis le blocage. Vérifie les preuves reçues avant de dire que c'est livré, et rends un résultat court : ce qui est livré, où le voir, ce qui a été vérifié, les limites, la décision qui reste.`
    : `Elle n'a encore choisi aucun agent dans « Mes agents » : tu fais le travail toi-même, ou tu dis précisément ce qui manque. N'invente aucun collègue.`;
  const proposer = outilsApp
    ? ` Quand elle exprime un besoin qui revient et qu'aucun de ses agents ne couvre, tu peux lui proposer une fiche d'agent avec l'outil proposer_agent : elle l'ouvre, l'ajuste et l'enregistre elle-même. Rien n'est créé avant.`
    : "";
  return `${qui} ${equipe} ${REGLES_COMMUNES}${proposer}`;
}

/**
 * Pour un agent lancé par l'app : avec qui il travaille vraiment (sa fiche peut citer des collègues
 * absents d'ici, elle n'est jamais réécrite pour autant), comment on confie ici, les règles communes,
 * et les dossiers encore à configurer.
 */
function consigneAgent(id: string, outilsApp: boolean): string {
  const nom = mesAgents().assistant.nom ?? "l'assistant";
  const autres = presentationActifs().filter((a) => a.id !== id);
  const equipe = autres.length
    ? `Dans cette app, les agents que la personne a choisis sont : ${listeAgents(autres)}, et son assistant ${nom} (principal). Ne confie du travail qu'à eux ; un collègue cité dans ta fiche mais absent ici n'est pas joignable : fais ta part et dis ce qui reste, sans demander de l'ajouter.`
    : `Dans cette app, la personne n'a pas d'autre agent que toi et son assistant ${nom} (principal) : un collègue cité dans ta fiche n'est pas joignable ici. Fais ta part et dis ce qui reste, sans demander de l'ajouter.`;
  const confier = `Si ta fiche cite des outils d'équipe absents de ta session ou une liste fixe de collègues, ils ne valent pas ici : on confie un travail ${outilsApp ? "dans un fil de l'app ou " : ""}en appelant un agent actif.`;
  const manquants = dossiersAConfigurer(id);
  const dossiers = manquants.length
    ? ` Certains dossiers de ta fiche ne sont pas encore configurés sur cet ordinateur (${manquants.join(", ")}, écrits {{chemin:…}}) : si tu en as besoin, dis-le à la personne au lieu de deviner un chemin.`
    : "";
  return `${equipe} ${confier} ${REGLES_COMMUNES}${dossiers}`;
}

/** Le chemin court (`runAgent`) : un seul tour, sans délégation possible. */
const CONSIGNE_SEUL = `Dans cette session, tu ne peux confier aucun travail ni ouvrir de fil, et personne ne te répondra en cours de route : fais ta part seul, rends-la en entier, et dis ce qui reste ou ce que tu n'as pas pu vérifier. ${REGLES_COMMUNES}`;

/** Les dépendances encore écrites `{{chemin:cle}}` dans la fiche d'un agent reçu. */
function dossiersAConfigurer(id: string): string[] {
  try {
    const contenu = readFileSync(path.join(agentsDir(), `${id}.md`), "utf8");
    return [...new Set([...contenu.matchAll(/\{\{chemin:([a-z0-9][a-z0-9-]{0,39})\}\}/g)].map((m) => m[1]))];
  } catch {
    return [];
  }
}

const processus = new Map<string, Processus>();
const parRequete = new Map<string, { proc: Processus; tour: Tour }>();
/** Sans message pendant ce temps, Claude Code est fermé (il finit d'abord ses tâches de fond). */
const VEILLE_MS = 30 * 60 * 1000;

function vivant(proc: Processus): boolean {
  return proc.child.exitCode === null && proc.child.signalCode === null && !proc.child.stdin?.writableEnded;
}

function ecrire(proc: Processus, message: unknown) {
  proc.child.stdin?.write(`${JSON.stringify(message)}\n`);
}

function controle(proc: Processus, request: Record<string, unknown>) {
  ecrire(proc, { type: "control_request", request_id: randomUUID(), request });
}

function modeDe(acces: Acces): string {
  // « projet » : le mode auto de Claude Code, comme dans VS Code — il juge seul ce qui est sans risque
  // et ne demande que pour le reste.
  return acces === "demander" ? "manual" : acces === "projet" ? "auto" : "acceptEdits";
}

function repondre(child: ChildProcess, demandeId: string, accepte: boolean, entree: Record<string, unknown>, regles: unknown[] = []) {
  const reponse = accepte
    ? { behavior: "allow", updatedInput: entree, ...(regles.length ? { updatedPermissions: regles } : {}) }
    : { behavior: "deny", message: "Refusé : la personne n’a pas donné son accord." };
  child.stdin?.write(`${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: demandeId, response: reponse } })}\n`);
}

/** Ta réponse à une demande d'autorisation, depuis l'app. */
export function autoriser(requestId: string, demandeId: string, decision: Decision): boolean {
  const child = running.get(requestId);
  const demande = demandes.get(requestId)?.get(demandeId);
  if (!child || !demande) return false;
  // « Toujours » : les règles proposées par Claude Code, gardées dans le projet
  // (.claude/settings.local.json), comme « Ne plus demander » dans VS Code.
  const regles =
    decision === "toujours"
      ? demande.suggestions.map((r) => ({ ...(r as Record<string, unknown>), destination: "localSettings" }))
      : [];
  repondre(child, demandeId, decision !== "non", demande.entree, regles);
  demandes.get(requestId)?.delete(demandeId);
  parRequete.get(requestId)?.tour.emit({ type: "autorisation-fin", id: demandeId, accepte: decision !== "non" });
  return true;
}

/** Commandes qu'un agent peut lancer sans demander : construire, vérifier, lire l'état git. */
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

/** Hors projet (message direct), l'agent travaille dans un dossier à lui, jamais dans tout le dossier personnel. */
const ATELIER = path.join(HOME, ".klyra", "atelier");

/** `~/…` → chemin absolu. null si le dossier du projet n'existe pas. */
function dossierDeTravail(dossier: string | null): string | null {
  if (!dossier) {
    mkdirSync(ATELIER, { recursive: true });
    return ATELIER;
  }
  const absolu = dossier.startsWith("~") ? path.join(HOME, dossier.slice(1)) : dossier;
  return existsSync(absolu) ? absolu : null;
}

export function dossierExiste(dossier: string): boolean {
  const absolu = dossier.startsWith("~") ? path.join(HOME, dossier.slice(1)) : dossier;
  return existsSync(absolu);
}

function nouveauTour(requestId: string, emit: (event: AgentEvent) => void, acces: Acces): Tour {
  /* Les tokens écrits, estimés au fil de l'eau (≈ 4 caractères par token), envoyés au plus toutes les 300 ms. */
  let jetons = 0;
  let jetonsEnvoyes = 0;
  let dernierEnvoi = 0;
  return {
    requestId,
    emit,
    acces,
    finie: false,
    arretee: false,
    activite: false,
    etapesDepuisTexte: false,
    dejaDuTexte: false,
    compter: (n) => {
      jetons += n;
      const maintenant = Date.now();
      if (jetons !== jetonsEnvoyes && maintenant - dernierEnvoi > 300) {
        jetonsEnvoyes = jetons;
        dernierEnvoi = maintenant;
        emit({ type: "jetons", total: Math.round(jetons) });
      }
    },
  };
}

function ajouterTour(proc: Processus, tour: Tour) {
  if (proc.veille) clearTimeout(proc.veille);
  proc.veille = null;
  proc.tours.push(tour);
  parRequete.set(tour.requestId, { proc, tour });
  running.set(tour.requestId, proc.child);
}

/** Un seul `fin` par réponse. Le processus, lui, reste ouvert pour le message suivant. */
function finirTour(proc: Processus, tour: Tour, event: Extract<AgentEvent, { type: "fin" }>) {
  if (tour.finie) return;
  tour.finie = true;
  proc.tours = proc.tours.filter((t) => t !== tour);
  parRequete.delete(tour.requestId);
  running.delete(tour.requestId);
  demandes.delete(tour.requestId);
  tour.emit(event);
  if (!proc.tours.length && !proc.fond && vivant(proc)) {
    proc.veille = setTimeout(() => proc.child.stdin?.end(), VEILLE_MS);
  }
}

/** La réponse en cours ; sans elle, l'agent répond de lui-même (une tâche de fond s'est terminée). */
function tourOuSpontane(proc: Processus): Tour | null {
  if (proc.tours[0]) return proc.tours[0];
  if (!proc.sessionId) return null;
  // Une tâche de fond revient : c'est elle qui fait reparler l'agent.
  proc.fond = Math.max(0, proc.fond - 1);
  const ouvert = proc.spontane(proc.sessionId);
  if (!ouvert) return null;
  const tour = nouveauTour(ouvert.requestId, ouvert.emit, proc.acces);
  ajouterTour(proc, tour);
  return tour;
}

function lireLigne(proc: Processus, ligne: string) {
  if (!ligne.trim()) return;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(ligne) as Record<string, unknown>;
  } catch {
    return;
  }
  const parent = (msg.parent_tool_use_id as string | null | undefined) ?? null;
  const courant = proc.tours[0] ?? null;

  if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
    proc.sessionId = msg.session_id;
    processus.set(msg.session_id, proc);
    courant?.emit({ type: "session", sessionId: msg.session_id });
    return;
  }
  if (msg.type === "rate_limit_event") {
    noterUtilisation(msg.rate_limit_info);
    return;
  }
  if (msg.type === "system" && msg.subtype === "thinking_tokens" && typeof msg.estimated_tokens_delta === "number") {
    courant?.compter(msg.estimated_tokens_delta);
    return;
  }
  if (msg.type === "stream_event") {
    const ev = msg.event as { type?: string; delta?: { type?: string; text?: string; partial_json?: string } };
    // La réflexion est comptée par thinking_tokens, juste au-dessus.
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
    const contenu = ((msg.message as { content?: unknown[] })?.content ?? []) as {
      type: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }[];
    const outils = contenu.filter((b) => b.type === "tool_use" && b.id && b.name);
    // Les agents d'arrière-plan travaillent sans réponse ouverte : on ne les suit que dans une réponse.
    const tour = parent === null && outils.length ? tourOuSpontane(proc) : courant;
    if (!tour) return;
    if (parent === null) tour.activite = true;
    for (const bloc of outils) {
      if (bloc.input?.run_in_background === true) proc.fond += 1;
      tour.emit({ type: "etape", id: bloc.id!, outil: bloc.name!, entree: bloc.input ?? {}, parent });
      if (parent === null) tour.etapesDepuisTexte = true;
    }
    return;
  }
  if (msg.type === "user") {
    if (!courant) return;
    const contenu = ((msg.message as { content?: unknown[] })?.content ?? []) as {
      type: string;
      tool_use_id?: string;
      is_error?: boolean;
      content?: unknown;
    }[];
    for (const bloc of contenu) {
      if (bloc.type !== "tool_result" || !bloc.tool_use_id) continue;
      const brut = typeof bloc.content === "string" ? bloc.content : JSON.stringify(bloc.content ?? "");
      courant.emit({ type: "etape-fin", id: bloc.tool_use_id, ok: !bloc.is_error, apercu: brut.slice(0, 400) });
    }
    return;
  }
  /* Demande d'autorisation : à toi de répondre dans l'app, sauf en accès complet. */
  if (msg.type === "control_request") {
    const req = msg.request as {
      subtype?: string;
      tool_name?: string;
      input?: Record<string, unknown>;
      description?: string;
      permission_suggestions?: unknown[];
    };
    const demandeId = msg.request_id as string;
    if (req?.subtype !== "can_use_tool" || typeof demandeId !== "string") return;
    const entree = req.input ?? {};
    /* Confier à un agent : l'app décide seule, d'après Mes agents, même en accès complet. */
    if (req.tool_name === "Agent" || req.tool_name === "Task") {
      if (agentAutorise(entree.subagent_type)) return repondre(proc.child, demandeId, true, entree);
      const nom = String(entree.subagent_type);
      return proc.child.stdin?.write(
        `${JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: demandeId,
            response: { behavior: "deny", message: `${pasDansMesAgents(nom)} Ne le rappelle pas ; fais le travail toi-même ou propose à la personne de l’ajouter.` },
          },
        })}\n`,
      );
    }
    const tour = tourOuSpontane(proc);
    if ((tour?.acces ?? proc.acces) === "tout") return repondre(proc.child, demandeId, true, entree);
    if (!tour) return repondre(proc.child, demandeId, false, entree);
    if (!demandes.has(tour.requestId)) demandes.set(tour.requestId, new Map());
    demandes.get(tour.requestId)!.set(demandeId, { entree, suggestions: req.permission_suggestions ?? [] });
    tour.emit({ type: "autorisation", id: demandeId, outil: req.tool_name ?? "outil", entree, description: req.description ?? "" });
    return;
  }
  /* Réponse annulée par Claude Code (l'agent est passé à autre chose). */
  if (msg.type === "control_cancel_request" && typeof msg.request_id === "string") {
    if (!courant) return;
    demandes.get(courant.requestId)?.delete(msg.request_id);
    courant.emit({ type: "autorisation-fin", id: msg.request_id, accepte: false });
    return;
  }
  if (msg.type === "result") {
    /* Ce que ce tour a consommé, même un tour vide (tâche de fond) : il a coûté aussi. */
    proc.cumul = enregistrerTourClaude(msg.modelUsage, proc.cumul, proc.agent);
    if (!courant) return;
    /* Une tâche de fond qui se termine ouvre un tour vide : son résultat peut arriver avant
       la réponse à ton message. Seul compte le résultat d'un tour où l'agent a vraiment répondu. */
    if (!courant.activite && !courant.arretee && msg.subtype === "success" && !msg.is_error && !msg.result) return;
    const ok = !courant.arretee && !msg.is_error && msg.subtype === "success";
    finirTour(proc, courant, {
      type: "fin",
      ok,
      texte: typeof msg.result === "string" ? msg.result : "",
      erreur: ok
        ? undefined
        : courant.arretee
          ? "Arrêté par toi."
          : (typeof msg.result === "string" && msg.result) || "L’agent s’est arrêté sur une erreur.",
      costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
      sessionId: typeof msg.session_id === "string" ? msg.session_id : undefined,
    });
  }
}

function lancerProcessus(bin: string, args: string[], cwd: string, signature: string, options: StreamOptions, acces: Acces, spontane: Spontane): Processus {
  const child = spawn(bin, args, { cwd, env: environnementClaude(), windowsHide: true });
  const proc: Processus = {
    routineRun: options.routineRun,
    child,
    signature,
    modele: options.modele ?? null,
    acces,
    tours: [],
    sessionId: options.sessionId,
    spontane,
    veille: null,
    fond: 0,
    agent: options.agent,
    cumul: {},
  };
  if (options.sessionId) processus.set(options.sessionId, proc);

  let tampon = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => {
    tampon += d.toString();
    const lignes = tampon.split("\n");
    tampon = lignes.pop() ?? "";
    for (const l of lignes) lireLigne(proc, l);
  });
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

  const finTout = (erreur: (tour: Tour) => string) => {
    if (proc.veille) clearTimeout(proc.veille);
    if (proc.sessionId && processus.get(proc.sessionId) === proc) processus.delete(proc.sessionId);
    for (const tour of [...proc.tours]) finirTour(proc, tour, { type: "fin", ok: false, texte: "", erreur: erreur(tour) });
  };
  child.on("error", (error) => finTout(() => `Impossible de lancer Claude Code : ${error.message}`));
  child.on("close", (code, signal) => {
    lireLigne(proc, tampon);
    finTout((tour) =>
      tour.arretee
        ? "Arrêté par toi."
        : signal
          ? "Arrêté."
          : stderr.trim().slice(0, 600) || `Claude Code s’est arrêté (code ${code}).`,
    );
  });
  return proc;
}

/**
 * Fait répondre un agent dans le dossier du projet, et transmet sa réponse au fil de l'eau.
 * La conversation garde son Claude Code ouvert : le message lui est écrit, sans le relancer.
 * Se termine toujours par un événement `fin`.
 */
export function streamAgent(requestId: string, options: StreamOptions, emit: (event: AgentEvent) => void, spontane: Spontane): void {
  const echec = (erreur: string) => emit({ type: "fin", ok: false, texte: "", erreur });
  const bin = findClaude();
  if (!bin) return echec("Claude Code est introuvable sur ce poste.");
  if (options.agent !== null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.agent)) return echec("Nom d’agent invalide.");
  if (options.sessionId !== null && !/^[0-9a-f-]{36}$/.test(options.sessionId)) return echec("Session invalide.");
  if (options.modele && !/^[a-z0-9][a-z0-9.\-]{0,63}$/.test(options.modele)) return echec("Modèle invalide.");
  if (options.effort && !["low", "medium", "high", "xhigh", "max"].includes(options.effort)) return echec("Effort invalide.");
  // Fils, routines, workflows ou conversation directe : un agent hors de Mes agents ne répond pas.
  if (options.agent !== null && !estActif(options.agent)) return echec(pasDansMesAgents(options.agent));

  const cwd = dossierDeTravail(options.dossier);
  if (!cwd) return echec(`Le dossier du projet est introuvable : ${options.dossier}`);

  const acces = options.acces ?? "projet";
  // Les dossiers des pièces jointes, pour que l'agent puisse les lire.
  const dossiersJoints = [...new Set((options.fichiers ?? []).filter((f) => path.isAbsolute(f) && existsSync(f)).map((f) => path.dirname(f)))].filter(
    (d) => !d.startsWith(cwd),
  );
  // Une pièce jointe hors du projet, en cours de route : l'agent demande à la lire.
  // Mes agents a changé (agent ajouté, désactivé, assistant renommé) : relancé au message suivant, session reprise.
  const signature = JSON.stringify([cwd, options.agent, options.effort ?? null, acces === "projet", generation(), espaceComposio.signature(), options.routineRun ?? null]);

  const ouvert = options.sessionId ? processus.get(options.sessionId) : undefined;
  let proc: Processus;
  if (ouvert && vivant(ouvert) && (ouvert.signature === signature || (ouvert.tours.length && !options.routineRun && !ouvert.routineRun))) {
    /* La conversation a déjà son Claude Code : on lui écrit. Le modèle et l'accès changent en route. */
    proc = ouvert;
    proc.spontane = spontane;
    if ((options.modele ?? null) !== proc.modele) {
      controle(proc, { subtype: "set_model", ...(options.modele ? { model: options.modele } : {}) });
      proc.modele = options.modele ?? null;
    }
    if (modeDe(acces) !== modeDe(proc.acces)) controle(proc, { subtype: "set_permission_mode", mode: modeDe(acces) });
    proc.acces = acces;
  } else {
    /* Un réglage qui demande de relancer Claude Code (l'effort) :
       l'ancien est fermé avant, pour ne jamais en avoir deux sur la même conversation. */
    if (ouvert && vivant(ouvert)) ouvert.child.stdin?.end();
    /* Le message part en flux sur l'entrée standard : l'app peut ainsi répondre aux demandes
       d'autorisation pendant que l'agent travaille, et lui écrire les messages suivants. */
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool",
      "stdio",
      "--permission-prompts",
      "host",
      "--permission-mode",
      modeDe(acces),
      // Ces outils attendent une réponse que l'app ne sait pas afficher : l'agent bloquerait.
      // Il pose ses questions dans sa réponse, comme à un collègue.
      "--disallowedTools",
      "AskUserQuestion",
      "EnterPlanMode",
      ...refusAgents(cwd),
      "--settings",
      REGLE_AGENTS,
    ];
    // Les outils de l'app (fils, autres IA ajoutées dans les Réglages), par son serveur MCP local.
    const capaciteComposio = espaceComposio.creerCapacite();
    const mcp = configMcp({ chatId: options.chatId ?? "", roleId: options.agent ?? "principal", routineRun: options.routineRun }, capaciteComposio);
    if (acces === "projet") args.push("--allowedTools", ...COMMANDES_AUTORISEES, ...(mcp ? OUTILS_APP() : []));
    if (mcp) args.push("--mcp-config", mcp);
    if (options.agent) args.push("--agent", options.agent);
    if (options.sessionId) args.push("--resume", options.sessionId);
    if (options.modele) args.push("--model", options.modele);
    if (options.effort) args.push("--effort", options.effort);
    for (const d of dossiersJoints) args.push("--add-dir", d);
    // L'agenda, les rappels et les routines de la personne, que l'app tient à jour.
    const consignes = [CONSIGNE_PLANNING, ...(mcp ? [CONSIGNE_FILS,
      "Pour Composio, commence par composio_etat : seule sa réponse confirme les comptes choisis dans KLYRA. Utilise composio_rechercher puis composio_executer avec leurs schémas. Un service absent, expiré ou refusé se règle dans Réglages › Composio : ne change pas de compte et ne te rabats pas en silence sur un CLI, un autre MCP ou une connexion du poste. La connexion ne vaut jamais accord pour une action métier ; conserve toutes les règles d'autorisation de la personne.",
    ] : []), options.agent === null ? consigneAssistant(!!mcp) : consigneAgent(options.agent, !!mcp)];
    if (options.routineRun && mcp) consignes.push("Ce tour est une exécution de routine. Si la tâche n’a pas pu être accomplie, appelle routine_report_failure avec le motif puis rends une réponse courte. Si elle a été accomplie mais qu’il n’y a rien à signaler, appelle routine_no_update. Ces deux outils ne concernent que cette exécution. Une autorisation en attente n’est pas une réussite.");
    args.push("--add-dir", DOSSIER_PLANNING, "--append-system-prompt", consignes.join("\n\n"));

    proc = lancerProcessus(bin, args, cwd, signature, options, acces, spontane);
  }

  ajouterTour(proc, nouveauTour(requestId, emit, acces));
  ecrire(proc, { type: "user", message: { role: "user", content: options.prompt } });
}

/* ─── Utilisation de Claude ────────────────────────────────────── */

/** Une fenêtre de limite : la part utilisée (0 à 1) et quand elle repart à zéro. */
export interface FenetreUtilisation {
  utilise: number;
  /** Date de remise à zéro, en millisecondes. */
  reinitialiseA: number | null;
}

/** L'utilisation de l'abonnement Claude, telle que Claude Code la renvoie à chaque réponse. */
export interface Utilisation {
  /** Fenêtre de 5 h. */
  session: FenetreUtilisation | null;
  /** Fenêtre de 7 jours. */
  semaine: FenetreUtilisation | null;
  /** « allowed », « allowed_warning » ou « rejected » (limite atteinte). */
  statut: string;
  misAJour: number;
}

let derniere: Utilisation | null = null;
const abonnes = new Set<(u: Utilisation) => void>();

export function derniereUtilisation(): Utilisation | null {
  return derniere;
}

/** Reprend la dernière utilisation connue (gardée sur le disque par le process principal). */
export function restaurerUtilisation(u: Utilisation | null): void {
  if (u && (!derniere || u.misAJour > derniere.misAJour)) derniere = u;
}

export function surUtilisation(callback: (u: Utilisation) => void): () => void {
  abonnes.add(callback);
  return () => abonnes.delete(callback);
}

function fenetre(brut: unknown): FenetreUtilisation | null {
  const f = brut as { utilization?: unknown; resetsAt?: unknown } | undefined;
  if (!f || typeof f.utilization !== "number") return null;
  return { utilise: f.utilization, reinitialiseA: typeof f.resetsAt === "number" ? f.resetsAt * 1000 : null };
}

function noterUtilisation(info: unknown): void {
  const i = info as { status?: unknown; unifiedWindows?: Record<string, unknown> } | undefined;
  if (!i) return;
  derniere = {
    session: fenetre(i.unifiedWindows?.five_hour),
    semaine: fenetre(i.unifiedWindows?.seven_day),
    statut: typeof i.status === "string" ? i.status : "allowed",
    misAJour: Date.now(),
  };
  abonnes.forEach((cb) => cb(derniere!));
}

/**
 * Demande l'utilisation à jour par une toute petite requête (modèle le plus
 * léger, sans outil, sans garder de session). Elle compte, très peu, dans
 * l'utilisation : on ne la lance qu'à la demande.
 */
export function actualiserUtilisation(): Promise<Utilisation | null> {
  const bin = findClaude();
  if (!bin) return Promise.resolve(derniere);
  mkdirSync(ATELIER, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      ["-p", "--model", "haiku", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--disallowedTools", ...OUTILS_INTERDITS, "WebFetch", "WebSearch", "Read", "Glob", "Grep"],
      { cwd: ATELIER, env: environnementClaude(), windowsHide: true },
    );
    let tampon = "";
    child.stdout.on("data", (d: Buffer) => {
      tampon += d.toString();
      const lignes = tampon.split("\n");
      tampon = lignes.pop() ?? "";
      for (const ligne of lignes) {
        try {
          const msg = JSON.parse(ligne) as { type?: string; rate_limit_info?: unknown };
          if (msg.type === "rate_limit_event") noterUtilisation(msg.rate_limit_info);
        } catch {
          /* ligne incomplète */
        }
      }
    });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 60_000);
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(derniere);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      resolve(derniere);
    });
    child.stdin.end("Réponds seulement : ok");
  });
}

/* ─── Compte Claude ────────────────────────────────────────────── */

/** Le compte Claude du poste, tel que Claude Code le voit (`claude auth status`). */
export interface CompteClaude {
  /** Claude Code est trouvé sur le poste. */
  installe: boolean;
  chemin: string | null;
  version: string | null;
  connecte: boolean;
  /** « claude.ai » (abonnement) ou « console » (facturation à l'usage). */
  methode: string | null;
  email: string | null;
  organisation: string | null;
  /** « max », « pro », « team »… */
  abonnement: string | null;
  verifieLe: number;
}

/** Lance une commande de Claude Code et rend sa sortie. */
function commandeClaude(bin: string, args: string[], delai: number): Promise<{ code: number | null; sortie: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: HOME, env: environnementClaude(), windowsHide: true });
    let sortie = "";
    child.stdout.on("data", (d: Buffer) => (sortie += d.toString()));
    child.stderr.on("data", (d: Buffer) => (sortie += d.toString()));
    const timeout = setTimeout(() => child.kill("SIGTERM"), delai);
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ code: null, sortie });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, sortie });
    });
    child.stdin.end();
  });
}

export async function compteClaude(): Promise<CompteClaude> {
  const bin = findClaude();
  const vide: CompteClaude = {
    installe: !!bin,
    chemin: bin,
    version: null,
    connecte: false,
    methode: null,
    email: null,
    organisation: null,
    abonnement: null,
    verifieLe: Date.now(),
  };
  if (!bin) return vide;
  const [version, statut] = await Promise.all([
    commandeClaude(bin, ["--version"], 15_000),
    commandeClaude(bin, ["auth", "status", "--json"], 15_000),
  ]);
  const compte = { ...vide, version: version.sortie.match(/\d+\.\d+\.\d+/)?.[0] ?? null };
  try {
    const s = JSON.parse(statut.sortie.slice(statut.sortie.indexOf("{"))) as Record<string, unknown>;
    const texte = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      ...compte,
      connecte: s.loggedIn === true,
      methode: texte(s.authMethod),
      email: texte(s.email),
      organisation: texte(s.orgName),
      abonnement: texte(s.subscriptionType),
    };
  } catch {
    return compte;
  }
}

/**
 * Connexion au compte : Claude Code ouvre la page de connexion d'Anthropic
 * dans le navigateur et attend qu'elle soit validée (5 min au plus).
 */
export async function connecterClaude(): Promise<CompteClaude> {
  const bin = findClaude();
  if (bin) await commandeClaude(bin, ["auth", "login", "--claudeai"], 5 * 60_000);
  return compteClaude();
}

export async function deconnecterClaude(): Promise<CompteClaude> {
  const bin = findClaude();
  if (bin) await commandeClaude(bin, ["auth", "logout"], 30_000);
  return compteClaude();
}
