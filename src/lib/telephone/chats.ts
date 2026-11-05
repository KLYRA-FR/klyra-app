import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { lireActivite, type Activite } from "@/lib/copie-compte";
import { DEBUT_DEMANDE_AGENT } from "@/lib/decrire-a-assistant";

/**
 * Les règles des écrans Chats et du fil sur le téléphone (spec mobile T-01, T-02), sans React :
 * sections et états de ligne comme au bureau, ce qui attend une action, menus « ⋯ ».
 */

export type ConversationLue = FunctionReturnType<typeof api.conversationsCompte.liste>[number];
export type CarteAgentLue = FunctionReturnType<typeof api.conversationsCompte.agents>[number];
export type MessageEnAttente = FunctionReturnType<typeof api.conversationsCompte.enAttente>[number];

export const ASSISTANT = "principal";
export const DIRECT = "dm-";
export const PREFIXE_FIL = "klyra-fil-";

export const idDirect = (roleId: string) => `${DIRECT}${roleId}`;

/** Les suggestions de l'accueil du bureau : chacune remplit le composeur, sans rien envoyer. */
export const SUGGESTIONS = [
  { libelle: "Aide-moi à organiser ma semaine", texte: "Aide-moi à organiser ma semaine" },
  { libelle: "Résume ce document", texte: "Résume ce document" },
  { libelle: "Crée-moi un agent pour…", texte: DEBUT_DEMANDE_AGENT },
];

/** Un fil d'agent : sa conversation directe parente, sinon null. */
export function parentDe(c: Pick<ConversationLue, "origine" | "parent" | "roleIds">): string | null {
  if (c.parent) return c.parent;
  return c.origine.startsWith(PREFIXE_FIL) && c.roleIds[0] ? idDirect(c.roleIds[0]) : null;
}

/** L'agent d'une conversation directe ou d'un fil ; null pour une conversation d'équipe. */
export function agentDe(origine: string, conversation?: Pick<ConversationLue, "roleIds" | "parent" | "origine">): string | null {
  if (origine.startsWith(DIRECT)) return origine.slice(DIRECT.length);
  if (conversation) {
    const parent = parentDe(conversation);
    if (parent) return parent.slice(DIRECT.length);
  }
  return null;
}

const jourMois = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/** Sous un fil archivé (C-2e) : « Archivé aujourd'hui », « Archivé hier », « Archivé le 7 oct. », jamais son identifiant. */
export function libelleArchive(iso: string, maintenant: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Archivé";
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86_400_000);
  if (ecart <= 0) return "Archivé aujourd’hui";
  if (ecart === 1) return "Archivé hier";
  return `Archivé le ${jourMois.format(d)}`;
}

export const activiteDe =(c: Pick<ConversationLue, "activite"> | undefined): Activite | null => lireActivite(c?.activite);

/** Ce qui attend une action de la personne : un accord, ou une question de l'agent (pastille de la barre du bas). */
export function attendUneAction(c: Pick<ConversationLue, "activite" | "archiveLe">): boolean {
  const etat = activiteDe(c)?.etat;
  return !c.archiveLe && (etat === "accord" || etat === "question");
}

/**
 * Le texte d'état d'une ligne, comme la barre latérale du bureau. `nom` : le prénom d'un agent.
 * Ordinateur fermé, plus rien ne s'écrit : seuls l'accord (expiré, P-11) et la question restent.
 */
export function etatLigne(c: ConversationLue | undefined, nom: (id: string) => string, posteOuvert = true): { texte: string; enCours: boolean } | null {
  const activite = activiteDe(c);
  if (!c || !activite) return null;
  if (!posteOuvert && activite.etat !== "accord" && activite.etat !== "question") return null;
  const equipe = c.kind === "equipe";
  const qui = nom(activite.roleId);
  switch (activite.etat) {
    case "accord":
      return { texte: equipe ? `${qui} attend ton accord` : "Attend ton accord", enCours: true };
    case "question":
      return { texte: equipe ? `${qui} attend ta réponse` : "Attend ta réponse", enCours: false };
    case "ecrit":
      return { texte: equipe ? `${qui} écrit sa réponse…` : "Écrit sa réponse…", enCours: true };
    case "collegue":
      return { texte: equipe ? `${qui} attend un collègue…` : "Attend un collègue…", enCours: true };
    case "etape":
      return { texte: equipe ? `${qui} travaille…` : `${activite.libelle}…`, enCours: true };
    default:
      return { texte: equipe ? `${qui} réfléchit…` : "Réfléchit…", enCours: true };
  }
}

export interface LigneAgent {
  carte: CarteAgentLue;
  /** Sa conversation directe, si elle existe déjà dans le compte. */
  conversation: ConversationLue | undefined;
  /** Ce qu'il fait, dans sa conversation ou dans un de ses fils. */
  etat: { texte: string; enCours: boolean } | null;
}

/**
 * Les sections de Chats : « Épinglées » (conversations d'équipe épinglées, dans l'ordre de pose),
 * « Mes agents » (l'assistant, puis les agents actifs), « Conversations d'équipe » (les autres, les
 * plus récentes d'abord). Les fils vivent dans le chat de leur agent.
 */
export function sections(conversations: ConversationLue[], cartes: CarteAgentLue[], nom: (id: string) => string, posteOuvert = true) {
  const equipe = conversations.filter((c) => c.kind === "equipe");
  const epinglees = equipe
    .filter((c) => c.epingleLe)
    .sort((a, b) => (b.epingleLe ?? "").localeCompare(a.epingleLe ?? "") || b.misAJour.localeCompare(a.misAJour));
  const autres = equipe.filter((c) => !c.epingleLe).sort((a, b) => b.misAJour.localeCompare(a.misAJour));
  const parOrigine = new Map(conversations.map((c) => [c.origine, c]));
  const actifs = cartes
    .filter((a) => a.actif || a.origine === ASSISTANT)
    .sort((a, b) => (a.origine === ASSISTANT ? -1 : b.origine === ASSISTANT ? 1 : a.nom.localeCompare(b.nom, "fr")));
  const agents: LigneAgent[] = actifs.map((carte) => {
    const conversation = parOrigine.get(idDirect(carte.origine));
    const filActif = conversations.find((c) => !c.archiveLe && parentDe(c) === idDirect(carte.origine) && activiteDe(c));
    return { carte, conversation, etat: etatLigne(conversation, nom, posteOuvert) ?? etatLigne(filActif, nom, posteOuvert) };
  });
  return { epinglees, agents, equipe: autres };
}

export type StatutTache = "a-faire" | "en-cours" | "fait";

/** Les tâches de suivi d'une conversation, telles que l'ordinateur les copie dans le compte (Détails › Tâches). */
export function tachesDe(c: Pick<ConversationLue, "taches"> | undefined): { texte: string; statut: StatutTache }[] {
  try {
    const brut = JSON.parse(c?.taches ?? "[]") as { texte?: unknown; statut?: unknown }[];
    return Array.isArray(brut)
      ? brut.filter((t): t is { texte: string; statut: StatutTache } => typeof t.texte === "string" && (t.statut === "a-faire" || t.statut === "en-cours" || t.statut === "fait"))
      : [];
  } catch {
    return [];
  }
}

export interface AgentAuTravail {
  /** La conversation où il travaille : la carte ouvre ce fil. */
  origine: string;
  roleId: string;
  /** Le titre de la conversation d'équipe ou du fil ; null pour sa conversation directe. */
  sujet: string | null;
  /** Ce qu'il fait : « Écrit sa réponse… », le nom de l'étape. */
  texte: string;
  depuis: string;
  /** « 2/5 » : ses tâches faites sur le total, s'il en suit. */
  taches: { faites: number; total: number } | null;
}

/**
 * « Au travail » (E2-01, D2-2) : les agents qui travaillent réellement, ordinateur ouvert (il écrit,
 * réfléchit, passe une étape, attend un collègue), les plus récents d'abord. L'accord et la question
 * vont dans « À traiter ». Ordinateur fermé : personne, une copie d'activité ne prouve pas qu'il
 * travaille encore.
 */
export function auTravail(conversations: ConversationLue[], posteOuvert: boolean): AgentAuTravail[] {
  if (!posteOuvert) return [];
  return conversations
    .filter((c) => !c.archiveLe)
    .flatMap((c): AgentAuTravail[] => {
      const activite = activiteDe(c);
      if (!activite || activite.etat === "accord" || activite.etat === "question") return [];
      const taches = tachesDe(c);
      const etat = etatLigne({ ...c, kind: "direct" }, () => "", true);
      return [
        {
          origine: c.origine,
          roleId: activite.roleId,
          sujet: c.kind === "equipe" || parentDe(c) ? c.titre : null,
          texte: etat?.texte ?? "Travaille…",
          depuis: activite.depuis,
          taches: taches.length ? { faites: taches.filter((t) => t.statut === "fait").length, total: taches.length } : null,
        },
      ];
    })
    .sort((a, b) => b.depuis.localeCompare(a.depuis));
}

/** Depuis quand : « à l'instant », « 12 min », « 1 h 05 ». */
export function dureeDepuis(iso: string, maintenant: Date = new Date()): string {
  const minutes = Math.floor((maintenant.getTime() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "à l’instant";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

export type ElementATraiter =
  | { genre: "accord"; conversation: ConversationLue; activite: Extract<Activite, { etat: "accord" }> }
  | { genre: "question"; conversation: ConversationLue; activite: Activite }
  | { genre: "attente"; conversationOrigine: string; messages: MessageEnAttente[] };

/**
 * « À traiter » : les demandes d'accord, les fils dont l'agent attend une réponse, puis les messages
 * qui attendent l'ordinateur. Les plus anciens d'abord : ce qui attend depuis longtemps passe devant.
 */
export function aTraiter(conversations: ConversationLue[], enAttente: MessageEnAttente[]): ElementATraiter[] {
  const elements: ElementATraiter[] = [];
  const actives = conversations
    .filter((c) => !c.archiveLe)
    .map((c) => ({ c, activite: activiteDe(c) }))
    .sort((a, b) => (a.activite?.depuis ?? "").localeCompare(b.activite?.depuis ?? ""));
  for (const { c, activite } of actives) if (activite?.etat === "accord") elements.push({ genre: "accord", conversation: c, activite });
  const parConversation = new Map<string, MessageEnAttente[]>();
  for (const m of [...enAttente].sort((a, b) => a.creeLe - b.creeLe)) {
    parConversation.set(m.conversationOrigine, [...(parConversation.get(m.conversationOrigine) ?? []), m]);
  }
  /* Une question à laquelle tu as déjà répondu depuis le téléphone n'attend plus que l'ordinateur. */
  for (const { c, activite } of actives) {
    if (activite?.etat === "question" && !parConversation.has(c.origine)) elements.push({ genre: "question", conversation: c, activite });
  }
  for (const [conversationOrigine, messages] of parConversation) elements.push({ genre: "attente", conversationOrigine, messages });
  return elements;
}

/** Le nombre affiché sur l'entrée Chats de la barre du bas : accords et questions (spec § 3). */
export function nombreATraiter(conversations: ConversationLue[]): number {
  return conversations.filter(attendUneAction).length;
}

/* ─── Menus « ⋯ » ──────────────────────────────────────────────── */

export type ActionConversation = "details" | "renommer" | "epingler" | "desepingler" | "exporter" | "projet" | "rechercher";

export const LIBELLES_CONVERSATION: Record<ActionConversation, string> = {
  details: "Détails",
  renommer: "Renommer",
  epingler: "Épingler",
  desepingler: "Retirer l’épingle",
  exporter: "Exporter en Markdown…",
  projet: "Ouvrir le projet",
  rechercher: "Rechercher dans cette conversation",
};

/**
 * Le menu d'une conversation, par appui long sur sa ligne ou « ⋯ » (T-01), et dans l'en-tête du fil
 * avec « Détails » en tête (T-02). Comme au bureau : on renomme une conversation d'équipe ou un fil,
 * on n'épingle qu'une conversation d'équipe. Dans le fil, « Rechercher » ouvre T-04 sur « Cette conversation ».
 */
export function actionsConversation(
  c: Pick<ConversationLue, "kind" | "origine" | "parent" | "roleIds" | "epingleLe" | "projetId"> | undefined,
  { dansLeFil = false }: { dansLeFil?: boolean } = {},
): ActionConversation[] {
  const actions: ActionConversation[] = dansLeFil ? ["details"] : [];
  if (c) {
    const fil = !!parentDe(c);
    if (c.kind === "equipe" || fil) actions.push("renommer");
    if (c.kind === "equipe" && !fil) actions.push(c.epingleLe ? "desepingler" : "epingler");
  }
  actions.push("exporter");
  if (c?.projetId) actions.push("projet");
  if (dansLeFil) actions.push("rechercher");
  return actions;
}

export type ActionReponse =
  | { id: "copier" | "ecouter"; libelle: string; voie: "compte" }
  | { id: "brancher"; libelle: string; voie: "file" }
  | { id: "reessayer" | "details" | "concis" | "web"; libelle: string; voie: "file" }
  | { id: "modele"; libelle: string; voie: "file" };

/**
 * Les actions d'une réponse d'agent (feuille ouverte par appui long ou « ⋯ » sous la bulle). Copier et
 * lire à voix haute se font sur le téléphone ; le reste part avec un message, comme au bureau. Rien
 * sans texte, ni sur une réponse qui s'écrit encore.
 */
export function actionsReponse({ texte, enCours, parle }: { texte: string; enCours: boolean; parle: boolean }): ActionReponse[] {
  if (!texte.trim() || enCours) return [];
  return [
    { id: "copier", libelle: "Copier", voie: "compte" },
    { id: "ecouter", libelle: parle ? "Arrêter la lecture" : "Lire à voix haute", voie: "compte" },
    { id: "brancher", libelle: "Créer une branche dans une nouvelle conversation", voie: "file" },
    { id: "reessayer", libelle: "Réessayer", voie: "file" },
    { id: "details", libelle: "Ajouter des détails", voie: "file" },
    { id: "concis", libelle: "Plus concis", voie: "file" },
    { id: "web", libelle: "Rechercher sur le web", voie: "file" },
    { id: "modele", libelle: "Changer de modèle", voie: "file" },
  ];
}

/** Le texte d'une réponse à lire à voix haute, sans la mise en forme Markdown (comme au bureau). */
export function texteParle(texte: string): string {
  return texte
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Un nouvel id de fil, du même format qu'au bureau (`klyra-fil-` et 8 caractères hexadécimaux). */
export function nouvelIdFil(): string {
  return `${PREFIXE_FIL}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** Le premier agent mentionné (« @Hugo », « @Dev »), d'après les cartes du compte, comme `findMention` au bureau. */
export function mentionDans(texte: string, cartes: Pick<CarteAgentLue, "origine" | "nom" | "roleCourt" | "actif">[]): string | null {
  const net = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const m of texte.matchAll(/@([\p{L}\d/-]+)/gu)) {
    const voulu = net(m[1]);
    const carte = cartes.find((c) => (c.actif || c.origine === ASSISTANT) && [c.nom, c.roleCourt, c.origine].some((n) => net(n) === voulu));
    if (carte) return carte.origine;
  }
  return null;
}

/** La mention en cours de frappe juste avant le curseur (« @hu »), pour ouvrir la liste des agents. */
export function mentionEnCours(texte: string, curseur: number): { debut: number; requete: string } | null {
  const m = texte.slice(0, curseur).match(/(^|\s)@([\p{L}-]*)$/u);
  return m ? { debut: curseur - m[2].length - 1, requete: m[2] } : null;
}
