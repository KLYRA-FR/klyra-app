import type { Carte, ReponseCarte } from "../../electron/cartes-interactives";
import type { Chat, Etape, Message, MessagePart, Project, Role } from "@/types/domain";
import { vueAtelier, vueEquipe, type ContexteAtelier, type PartieAtelierCompte, type PartieEquipeCompte } from "./atelier-compte";
import { echanges, mesureActuelle, type MesureContexte } from "./contexte";
import { resumeFond, type GenreFond } from "./fond-resume";

export type { CarteAtelierCompte, CarteEquipeCompte, ContexteAtelier, LigneAtelierCompte, MembreEquipeCompte, ResultatCompte } from "./atelier-compte";

const TEXTE_MAX = 8000;
const PARTIES_MAX = 20_000;
const FICHIERS_MAX = 60;

/* ─── Ni chemin absolu, ni secret ──────────────────────────────── */

/** Clés, jetons et mots de passe reconnaissables (mêmes motifs que la Bibliothèque), masqués. */
const SECRETS: RegExp[] = [
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
];
const SECRET_NOMME = /\b((?:api[_-]?key|access[_-]?token|secret|password|passwd|mot de passe)\s*[:=]\s*["']?)[^\s"']{8,}/gi;

/** Chemins absolus d'un ordinateur (Mac, Linux, Windows). Les adresses web n'en sont pas. */
const CHEMIN =
  /(?<![\w.:/\\-])(?:\/(?:Users|home|var|opt|srv|mnt|Volumes|private|tmp|etc|root|data|Library|Applications)\/[^\s`"'()<>\]|,;]+|[A-Za-z]:\\[^\s`"'()<>\]|,;]+)/g;
const DOSSIER_PERSO = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/;

const unix = (chemin: string) => chemin.replace(/\\/g, "/");

function nomDe(chemin: string): string {
  return chemin.split(/[\\/]/).filter(Boolean).at(-1) ?? chemin;
}

/** Un chemin du disque tel qu'il part dans le compte : relatif au projet, `~/…` chez soi, sinon son seul nom. */
export function cheminPartage(chemin: string, dossier: string | null): string {
  const propre = chemin.replace(/[\\/]+$/, "");
  if (dossier) {
    const racine = unix(dossier).replace(/\/+$/, "");
    const relatif = unix(propre);
    if (relatif === racine) return ".";
    if (racine && relatif.startsWith(`${racine}/`)) return relatif.slice(racine.length + 1);
  }
  const perso = DOSSIER_PERSO.exec(propre);
  if (perso) return `~${unix(propre.slice(perso[0].length))}`;
  return `…/${nomDe(propre)}`;
}

/** Un fichier du projet (chemin relatif) que le téléphone peut ouvrir, ou null s'il est ailleurs sur le disque. */
function relatifAuProjet(chemin: string, dossier: string | null): string | null {
  const partage = cheminPartage(chemin, dossier);
  return partage.startsWith("~") || partage.startsWith("…/") || partage === "." ? null : partage;
}

/** Le texte tel qu'il part dans le compte : chemins absolus rendus relatifs ou réduits, secrets masqués. */
export function sansCheminNiSecret(texte: string, dossier: string | null = null): string {
  let propre = texte.replace(CHEMIN, (chemin) => {
    const fin = /[.)]+$/.exec(chemin)?.[0] ?? "";
    return cheminPartage(chemin.slice(0, chemin.length - fin.length), dossier) + fin;
  });
  for (const motif of SECRETS) propre = propre.replace(motif, "•••");
  return propre.replace(SECRET_NOMME, "$1•••");
}

/* ─── Les parties d'un message ─────────────────────────────────── */

export type SourceFichier = "joint" | "cree" | "modifie" | "lu";

/** Un fichier cité par le fil : son nom, et son chemin dans le projet s'il y est (sinon null). */
export interface FichierCompte {
  nom: string;
  chemin: string | null;
}

/** Ce que le compte garde d'une partie de message : la forme du bureau, sans chemin absolu ni secret. */
export type PartieCompte =
  | { type: "text"; text: string }
  | { type: "fichiers"; fichiers?: FichierCompte[] }
  | {
      type: "etapes";
      n: number;
      modifies?: number;
      erreurs?: number;
      /** L'étape en cours (« Lit src/app.tsx »), pendant que l'agent travaille. */
      enCours?: string | null;
      fichiers?: (FichierCompte & { source: Exclude<SourceFichier, "joint"> })[];
    }
  | {
      type: "autorisation";
      id: string;
      outil: string;
      libelle: string;
      detail: string;
      description: string;
      toujours?: string;
      statut: "attente" | "acceptee" | "refusee";
    }
  | { type: "passation"; roleId: string; statut: "en-cours" | "fait" | "erreur"; consigne?: string; etapes?: number }
  | { type: "proposition-agent"; etapeId: string; nom: string; role: string; description: string }
  | { type: "tasks"; tasks: { label: string; status: "fait" | "en-cours" | "a-venir"; roleId?: string }[] }
  | { type: "options"; options: { label: string; layout: "texte" | "texte-media"; selected: boolean }[] }
  | { type: "worklog"; durationMin: number; files: { path: string; added: number; removed: number }[] }
  | { type: "actions"; actions: { label: string; primary: boolean }[] }
  /** L'atelier d'un agent : la carte calculée par l'ordinateur (cf. atelier-compte.ts). */
  | PartieAtelierCompte
  /** L'atelier d'une équipe : la carte calculée par l'ordinateur (cf. atelier-compte.ts). */
  | PartieEquipeCompte
  /** Les réponses toutes prêtes sous une question de l'assistant (outil `proposer_choix`). */
  | { type: "choix"; question: string; options: string[]; multiple: boolean }
  /** Une carte interactive (outil `proposer_carte`) : le téléphone la remplit et l'envoie comme un message. */
  | { type: "carte"; etapeId: string; carte: Carte; reponse?: ReponseCarte };

function source(etape: Etape): Exclude<SourceFichier, "joint"> {
  return etape.outil === "Write" ? "cree" : etape.outil === "Read" ? "lu" : "modifie";
}

/** Le niveau de réduction : tout, sans les listes de fichiers, puis l'atelier en version courte. */
interface Reduction {
  avecFichiers: boolean;
  atelierCompact: boolean;
}

function reduire(part: MessagePart, tout: MessagePart[], dossier: string | null, r: Reduction, atelier: ContexteAtelier | null): PartieCompte | null {
  const { avecFichiers } = r;
  const net = (texte: string, max: number) => sansCheminNiSecret(texte, dossier).slice(0, max);
  switch (part.type) {
    case "text":
      return { type: "text", text: net(part.text, TEXTE_MAX) };
    // Le téléphone ne connaît pas les citations : l'extrait part comme une ligne de texte.
    case "citation":
      return { type: "text", text: net(`En réponse : ${part.extrait}`, 300) };
    case "fichiers":
      return avecFichiers
        ? { type: "fichiers", fichiers: part.chemins.slice(0, 10).map((c) => ({ nom: nomDe(c).slice(0, 160), chemin: relatifAuProjet(c, dossier) })) }
        : { type: "fichiers" };
    case "etapes": {
      const propres = part.etapes.filter((e) => e.parent === null);
      const derniere = propres.at(-1);
      const fichiers = avecFichiers
        ? part.etapes
            .filter((e) => e.chemin && e.statut !== "erreur")
            .slice(-FICHIERS_MAX)
            .map((e) => ({ nom: nomDe(e.chemin!).slice(0, 160), chemin: relatifAuProjet(e.chemin!, dossier), source: source(e) }))
        : undefined;
      return {
        type: "etapes",
        n: propres.length,
        modifies: new Set(propres.filter((e) => /Write|Edit/.test(e.outil)).map((e) => e.libelle)).size,
        erreurs: propres.filter((e) => e.statut === "erreur").length,
        enCours: derniere?.statut === "en-cours" ? net(derniere.libelle, 160) : null,
        ...(fichiers ? { fichiers } : {}),
      };
    }
    case "autorisation":
      return {
        type: "autorisation",
        id: part.id.slice(0, 200),
        outil: part.outil.slice(0, 80),
        libelle: net(part.libelle, 200),
        detail: net(part.detail, 1000),
        description: net(part.description, 400),
        ...(part.toujours ? { toujours: net(part.toujours, 80) } : {}),
        statut: part.statut,
      };
    case "passation": {
      const etapes = tout.find((p) => p.type === "etapes");
      return {
        type: "passation",
        roleId: part.roleId,
        statut: part.statut,
        consigne: net(part.consigne, 200),
        etapes: etapes?.type === "etapes" ? etapes.etapes.filter((e) => e.parent === part.etapeId).length : 0,
      };
    }
    case "proposition-agent":
      return {
        type: "proposition-agent",
        etapeId: part.etapeId.slice(0, 200),
        nom: part.proposition.nom.slice(0, 80),
        role: part.proposition.role.slice(0, 120),
        description: net(part.proposition.description, 400),
      };
    case "atelier-agent":
      return atelier ? vueAtelier(part.etapeId, atelier, net, r.atelierCompact) : null;
    case "atelier-equipe":
      return atelier ? vueEquipe(part.etapeId, atelier, net, r.atelierCompact) : null;
    // Une carte en cours d'écriture ne part pas ; chaque texte, sans chemin ni secret.
    case "carte":
      return part.provisoire
        ? null
        : {
            type: "carte",
            etapeId: part.etapeId.slice(0, 200),
            carte: JSON.parse(JSON.stringify(part.carte), (_cle, v) => (typeof v === "string" ? net(v, 600) : v)) as Carte,
            ...(part.reponse ? { reponse: JSON.parse(JSON.stringify(part.reponse), (_cle, v) => (typeof v === "string" ? net(v, 1000) : v)) as ReponseCarte } : {}),
          };
    case "choix":
      return { type: "choix", question: net(part.question, 300), options: part.options.slice(0, 6).map((o) => net(o, 120)), multiple: part.multiple };
    // Un secret ne se colle jamais du téléphone (il passerait par le compte) : la demande part en une ligne.
    case "coffre-demande":
      return {
        type: "text",
        text: net(
          part.reponse
            ? `${part.reponse.etat === "refusee" ? "Refusé" : "Rangé dans le coffre"} : ${part.nom} (${part.variable}).`
            : `Demande ${part.nom} (${part.variable}) : à coller sur l’ordinateur, dans la carte sécurisée de la conversation.`,
          300,
        ),
      };
    case "tasks":
      return {
        type: "tasks",
        tasks: part.tasks.slice(0, 40).map((t) => ({ label: net(t.label, 120), status: t.status, roleId: t.roleId })),
      };
    case "options":
      return { type: "options", options: part.options.slice(0, 12).map((o) => ({ label: o.label.slice(0, 120), layout: o.layout, selected: o.selected })) };
    case "worklog":
      return {
        type: "worklog",
        durationMin: part.durationMin,
        files: avecFichiers ? part.files.slice(0, FICHIERS_MAX).map((f) => ({ path: cheminPartage(f.path, dossier), added: f.added, removed: f.removed })) : [],
      };
    case "actions":
      return { type: "actions", actions: part.actions.slice(0, 8).map((a) => ({ label: a.label.slice(0, 80), primary: a.primary })) };
    // La réflexion reste sur l'ordinateur : le téléphone montre la réponse.
    case "reflexion":
      return null;
    // Questions et plan se répondent depuis l'ordinateur : le téléphone les lit en texte.
    case "question": {
      const lignes = part.questions.map((q) => `${q.question}${part.reponses?.[q.question] ? ` → ${part.reponses[q.question]}` : q.options.length ? ` (${q.options.map((o) => o.libelle).join(", ")})` : ""}`);
      const etat = part.statut === "attente" ? "Question à choix, à répondre depuis l’ordinateur" : part.statut === "repondue" ? "Questions répondues" : "Questions laissées sans réponse";
      return { type: "text", text: net(`_${etat} :_\n${lignes.join("\n")}`, TEXTE_MAX) };
    }
    case "plan": {
      const etat = part.statut === "attente" ? "Plan proposé, à lancer depuis l’ordinateur" : part.statut === "lance" ? "Plan lancé" : part.statut === "corrige" ? "Plan à corriger" : "Plan laissé de côté";
      return { type: "text", text: net(`_${etat}_\n\n${part.plan}`, TEXTE_MAX) };
    }
  }
}

/**
 * Parties gardées dans le compte : la forme de chaque bloc (texte, étapes repliées, accord, passation,
 * tâches, options, carte de l'atelier…), sans chemin absolu ni secret ni session. Trop long : d'abord
 * sans les listes de fichiers, puis l'atelier en version courte, puis le texte seul. Sans `atelier`
 * (la conversation pliée par l'ordinateur), les cartes de l'atelier ne partent pas.
 */
export function partiesReduites(tout: MessagePart[], dossier: string | null = null, atelier: ContexteAtelier | null = null): string {
  const parts = tout;
  const essai = (r: Reduction) => JSON.stringify(parts.flatMap((p) => reduire(p, parts, dossier, r, atelier) ?? []));
  for (const r of [
    { avecFichiers: true, atelierCompact: false },
    { avecFichiers: false, atelierCompact: false },
    { avecFichiers: false, atelierCompact: true },
  ]) {
    const json = essai(r);
    if (json.length <= PARTIES_MAX) return json;
  }
  const texte = parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  return JSON.stringify([{ type: "text", text: sansCheminNiSecret(texte, dossier).slice(0, TEXTE_MAX) }]);
}

/** Les parties lues dans le compte. Une copie abîmée ou d'une autre version ne casse pas le fil. */
export function lireParties(json: string): PartieCompte[] {
  try {
    const brut = JSON.parse(json) as unknown;
    return Array.isArray(brut)
      ? brut.filter((p): p is PartieCompte => !!p && typeof p === "object" && typeof (p as { type?: unknown }).type === "string")
      : [];
  } catch {
    return [];
  }
}

/* ─── Ce que fait l'agent ──────────────────────────────────────── */

/**
 * Ce que le téléphone montre d'une conversation où un agent travaille ou attend : « Attend ton accord »
 * (avec la demande, pour répondre depuis la liste), « Écrit sa réponse », « Attend un collègue »,
 * l'étape en cours, « Réfléchit » ; ou « Attend ta réponse » quand sa dernière réponse, pas encore lue,
 * finit sur une question ou propose des choix.
 */
export type Activite =
  | {
      etat: "accord";
      roleId: string;
      messageId: string;
      depuis: string;
      accord: { id: string; libelle: string; detail: string; description: string; toujours?: string };
    }
  | { etat: "ecrit" | "collegue" | "reflechit" | "question"; roleId: string; messageId: string; depuis: string }
  | { etat: "etape"; roleId: string; messageId: string; depuis: string; libelle: string }
  /**
   * Sa réponse est rendue mais il a encore une commande ou un agent en fond (`libelle` : sa description, ou
   * « 2 commandes et 1 agent » avec `taches`) ; `reprise` : l'un d'eux est revenu, il s'y remet (cf. fond-agents.ts).
   */
  | { etat: "fond"; roleId: string; messageId: string; depuis: string; libelle: string; reprise: boolean; taches: { description: string; depuis: string }[] };

/** L'agent écrit ou attend quelque chose : un message de la personne attendra sa fin. Pas une question, ni une tâche de fond. */
export const activiteOccupe = (a: Activite | null | undefined): boolean => !!a && a.etat !== "question" && a.etat !== "fond";

/** Ce qu'un agent a en fond, tel que le bureau le tient (`FondAgent`). */
export interface FondCopie {
  roleId: string;
  taches: readonly { description: string; genre: GenreFond; debut: number }[];
  reprise: boolean;
}

/** Au plus 5 tâches nommées sur le téléphone : la ligne en dit le compte. */
const TACHES_FOND_MAX = 5;

function activiteFond(duFil: Message[], fond: FondCopie, dossier: string | null): Activite {
  const dernier = duFil.findLast((m) => m.author.kind === "role" && m.author.roleId === fond.roleId) ?? duFil.at(-1);
  const net = (t: string) => sansCheminNiSecret(t, dossier).replace(/\s+/g, " ").trim().slice(0, 120);
  const iso = (ms: number) => new Date(ms).toISOString();
  const premier = fond.taches.reduce<number | null>((min, t) => (min === null || t.debut < min ? t.debut : min), null);
  return {
    etat: "fond",
    roleId: fond.roleId,
    messageId: dernier?.id ?? "",
    /* Stable d'une copie à l'autre : le début de la plus ancienne tâche, sinon la dernière réponse. */
    depuis: premier !== null ? iso(premier) : (dernier?.createdAt ?? iso(0)),
    libelle: fond.taches.length === 1 ? net(fond.taches[0].description) : resumeFond(fond.taches),
    reprise: fond.reprise,
    taches: fond.taches.slice(0, TACHES_FOND_MAX).map((t) => ({ description: net(t.description), depuis: iso(t.debut) })),
  };
}

/** Le travail en cours d'une conversation, tel que `useWorkspace().state.travail` le tient. */
export interface TravailCopie {
  roleId: string;
  messageId: string;
  debut: number;
}

function poseUneQuestion(message: Message): boolean {
  if (message.parts.some((p) => (p.type === "options" && p.options.length > 0) || (p.type === "actions" && p.actions.length > 0) || p.type === "choix" || (p.type === "carte" && !p.reponse) || (p.type === "coffre-demande" && !p.reponse))) return true;
  const texte = message.parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
  return /\?\s*[)»"*_]*$/.test(texte);
}

export function activiteDe(duFil: Message[], travail: TravailCopie | null, nonLus: number, dossier: string | null = null, fond: FondCopie | null = null): Activite | null {
  if (travail) {
    const message = duFil.find((m) => m.id === travail.messageId);
    const base = { roleId: travail.roleId, messageId: travail.messageId, depuis: new Date(travail.debut).toISOString() };
    const accord = message?.parts.find((p) => p.type === "autorisation" && p.statut === "attente");
    if (accord?.type === "autorisation") {
      return {
        ...base,
        etat: "accord",
        accord: {
          id: accord.id.slice(0, 200),
          libelle: sansCheminNiSecret(accord.libelle, dossier).slice(0, 200),
          detail: sansCheminNiSecret(accord.detail, dossier).slice(0, 600),
          description: sansCheminNiSecret(accord.description, dossier).slice(0, 300),
          ...(accord.toujours ? { toujours: sansCheminNiSecret(accord.toujours, dossier).slice(0, 80) } : {}),
        },
      };
    }
    for (const part of [...(message?.parts ?? [])].reverse()) {
      if (part.type === "text" && part.text.trim()) return { ...base, etat: "ecrit" };
      if (part.type === "passation" && part.statut === "en-cours") return { ...base, etat: "collegue" };
      if (part.type === "etapes") {
        const etape = part.etapes.findLast((e) => e.statut === "en-cours" && e.parent === null);
        if (etape) return { ...base, etat: "etape", libelle: sansCheminNiSecret(etape.libelle, dossier).slice(0, 160) };
      }
    }
    return { ...base, etat: "reflechit" };
  }
  if (fond) return activiteFond(duFil, fond, dossier);
  const dernier = duFil.at(-1);
  if (!dernier || nonLus === 0 || dernier.author.kind !== "role" || dernier.statut === "en-cours" || dernier.statut === "erreur") return null;
  return poseUneQuestion(dernier) ? { etat: "question", roleId: dernier.author.roleId, messageId: dernier.id, depuis: dernier.createdAt } : null;
}

/** L'activité lue dans le compte, ou null. */
export function lireActivite(json: string | null | undefined): Activite | null {
  if (!json) return null;
  try {
    const brut = JSON.parse(json) as Partial<Activite> | null;
    return brut && typeof brut.etat === "string" && typeof brut.roleId === "string" && typeof brut.messageId === "string" ? (brut as Activite) : null;
  } catch {
    return null;
  }
}

/* ─── Conversations, messages, cartes ──────────────────────────── */

export function nonLusDe(chat: Chat, messages: Message[]): number {
  const seuil = chat.luJusqua;
  const n = messages.filter((m) => m.chatId === chat.id && m.author.kind === "role" && (!seuil || m.createdAt > seuil)).length;
  return Math.min(9999, n);
}

/** Le dossier d'une conversation, pour rendre ses chemins relatifs : celui de son projet (sinon aucun). */
export function dossierDe(chat: Pick<Chat, "projectId">, projets: Project[]): string | null {
  return projets.find((p) => p.id === chat.projectId)?.folder || null;
}

/**
 * La conversation telle que le compte la garde. Un fil supprimé (retiré des archivés) n'y va pas : null.
 * `duFil` : ses messages seulement, dans l'ordre.
 */
/** La version du contrat Tickets que connaît ce poste. */
export const CONTRAT_TICKETS = 1;

/**
 * Le ticket d'un fil pour le compte (contrat des lots 3 et 4, règle 1) : les champs utiles du fil, le poste,
 * la version, s'il a une réponse. Null pour une conversation qui n'est pas un fil. Sans chemin ni secret.
 */
export function ticketCompte(chat: Chat, duFil: Message[], projets: Project[], poste: string | null): string | null {
  const fil = chat.fil;
  if (!fil) return null;
  const projet = projets.find((p) => p.id === fil.projetId);
  const dossier = projets.find((p) => p.id === chat.projectId)?.folder ?? projet?.folder ?? null;
  return JSON.stringify({
    version: CONTRAT_TICKETS,
    poste,
    statut: fil.statut,
    etape: fil.etape ?? null,
    raison: fil.raison ? sansCheminNiSecret(fil.raison, dossier).slice(0, 200) : null,
    priorite: fil.priorite ?? 0,
    echeance: fil.echeance ?? null,
    projetNom: projet?.name ?? null,
    rappel: fil.rappel ?? null,
    lancePar: fil.lancePar?.roleId ?? null,
    creeLe: fil.creeLe,
    fermeLe: fil.fermeLe ?? null,
    aReponse: duFil.some((m) => m.author.kind === "role" && m.statut !== "en-cours"),
    revision: fil.revision ?? 0,
  });
}

export function conversationCompte(chat: Chat, duFil: Message[], projets: Project[], travail: TravailCopie | null = null, poste: string | null = null, fond: FondCopie | null = null) {
  if (chat.fil?.supprime) return null;
  const dernier = duFil.at(-1);
  const projet = projets.find((p) => p.id === chat.projectId);
  const dossier = projet?.folder || null;
  const nonLus = nonLusDe(chat, duFil);
  const activite = activiteDe(duFil, travail, nonLus, dossier, fond);
  const extrait = dernier ? dernier.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ") : "";
  return {
    origine: chat.id,
    kind: chat.kind,
    titre: chat.title,
    projetId: chat.projectId,
    projetNom: projet?.name ?? null,
    roleIds: chat.roleIds.slice(0, 20),
    misAJour: chat.updatedAt,
    epingleLe: chat.epingleLe ?? null,
    extrait: sansCheminNiSecret(extrait, dossier).replace(/\s+/g, " ").trim().slice(0, 240),
    extraitLe: dernier?.createdAt ?? null,
    nonLus,
    taches: JSON.stringify((chat.taches ?? []).slice(0, 40).map((t) => ({ texte: sansCheminNiSecret(t.texte, dossier).slice(0, 120), statut: t.statut }))).slice(0, 4000),
    lieu: chat.lieu ?? null,
    parent: chat.fil ? `dm-${chat.fil.roleId}` : null,
    archiveLe: chat.fil?.statut === "archive" ? chat.updatedAt : null,
    activite: activite ? JSON.stringify(activite) : null,
    /* Le compte Claude choisi ne compte qu'avec Claude (et garde le champ sous les 200 caractères du compte). */
    modele: chat.fournisseur || chat.modele || chat.effort || chat.compteClaude ? JSON.stringify({ ...(chat.fournisseur ? { fournisseur: chat.fournisseur } : {}), modele: chat.modele ?? null, effort: chat.effort ?? null, ...(chat.compteClaude && !chat.fournisseur ? { compteClaude: chat.compteClaude } : {}) }) : null,
    contexte: contexteCompte(chat),
    ticket: ticketCompte(chat, duFil, projets, poste),
    contratTickets: CONTRAT_TICKETS,
  };
}

/**
 * La mesure de l'agent qui pèse le plus (`chat.contexte`) pour le conseil du téléphone : des nombres et une
 * date, aucun contenu. Seulement une mesure de la session actuelle, comme le conseil du bureau.
 */
export function contexteCompte(chat: Chat): string | null {
  let plusLourd: { roleId: string; mesure: MesureContexte } | null = null;
  for (const roleId of chat.roleIds) {
    const mesure = mesureActuelle(chat, roleId);
    if (mesure && (!plusLourd || echanges(mesure) > echanges(plusLourd.mesure))) plusLourd = { roleId, mesure };
  }
  if (!plusLourd) return null;
  const { roleId, mesure } = plusLourd;
  return JSON.stringify({ roleId, jetons: mesure.jetons, echanges: echanges(mesure), le: mesure.le, masqueJusqua: chat.contexteMasqueJusqua ?? 0 });
}

export function messageCompte(message: Message, dossier: string | null = null, atelier: ContexteAtelier | null = null) {
  const texte = sansCheminNiSecret(
    message.parts
      .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n\n"),
    dossier,
  ).slice(0, TEXTE_MAX);
  return {
    conversationOrigine: message.chatId,
    origine: message.id,
    auteurKind: message.author.kind,
    auteurId: message.author.kind === "role" ? message.author.roleId : null,
    creeLe: message.createdAt,
    texte,
    parties: partiesReduites(message.parts, dossier, atelier),
    statut: message.statut ?? null,
    reactions: message.reactions ?? [],
    compaction: message.compaction === true,
  };
}

export function carteAgent(role: Role, actif: boolean) {
  return {
    origine: role.id,
    nom: role.name,
    teinte: role.teinte,
    /* Le rôle court lisible, sinon le rôle de la fiche : jamais l'id, que `roleFromContent` prend en dernier repli (C-2a). */
    roleCourt: (role.tag && role.tag !== role.id ? role.tag : role.title) || "",
    actif,
  };
}

export function carteProjet(projet: Project) {
  return {
    origine: projet.id,
    nom: projet.name,
    accroche: projet.subtitle,
    statut: projet.status,
    epingle: projet.pinned,
    lieu: projet.lieu ?? null,
    misAJour: projet.updatedAt,
  };
}

export function decoupages<T>(liste: T[], taille: number): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) lots.push(liste.slice(i, i + taille));
  return lots;
}

/**
 * Ce qui a changé depuis la dernière copie : chaque élément est comparé à sa copie déjà envoyée
 * (par sa clé). Seuls les changés repartent ; l'appelant retient leurs empreintes une fois envoyés.
 */
export function changements<T>(elements: T[], cle: (e: T) => string, envoyes: ReadonlyMap<string, string>): { lot: T[]; empreintes: [string, string][] } {
  const lot: T[] = [];
  const empreintes: [string, string][] = [];
  for (const element of elements) {
    const empreinte = JSON.stringify(element);
    const id = cle(element);
    if (envoyes.get(id) === empreinte) continue;
    lot.push(element);
    empreintes.push([id, empreinte]);
  }
  return { lot, empreintes };
}
