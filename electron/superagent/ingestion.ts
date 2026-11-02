import { tronquerOctets } from "./enveloppe";
import type { EntreeSource, TypeMetier } from "./types";

/**
 * Entrées utiles → entrées source (point 07). Deux origines seulement :
 * - un message natif de Klyra (sa référence chatId/messageId est gardée telle quelle) ;
 * - l'import manuel d'un message OpenBot par un agent autorisé, marqué `import_manuel`.
 * Aucune interception, connexion ou tâche nouvelle : l'appelant décide d'ingérer (point 15 bloqué).
 */

/** La forme minimale d'un `Message` de `src/types/domain.ts` lue ici (le process principal ne voit pas `src/`). */
export interface MessageNatif {
  id: string;
  chatId: string;
  author: { kind: "user" } | { kind: "role"; roleId: string };
  createdAt: string;
  parts: { type: string; text?: string }[];
  statut?: "en-cours" | "fait" | "erreur";
  erreur?: string;
}

export interface ContexteKlyra {
  /** Le compte de la personne sur ce PC (identifiant stable, pas son nom). */
  compte: string;
  project_id: string;
  /** Travail déjà relié à cette conversation ; null : non résolu, rien ne démarre. */
  work_id: string | null;
  /** Révision du message à la source ; 1 tant que Klyra ne versionne pas ses messages. */
  revision?: number;
  /** Type imposé (demande à l'ouverture, précision, objectif). Sinon déduit de l'auteur. */
  type?: TypeMetier;
}

const texteDe = (message: MessageNatif) =>
  message.parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");

/** Le type métier d'un message natif, d'après qui parle et son statut. */
function typeNatif(message: MessageNatif, relie: boolean): TypeMetier {
  if (message.author.kind === "user") return relie ? "precision" : "demande";
  return message.statut === "erreur" ? "erreur" : "resultat";
}

/** Message natif → entrée source. Une réponse encore en cours d'écriture n'est pas un événement : null. */
export function depuisMessageKlyra(message: MessageNatif, contexte: ContexteKlyra): EntreeSource | null {
  if (message.statut === "en-cours") return null;
  const texte = [texteDe(message), message.statut === "erreur" ? (message.erreur ?? "") : ""].filter(Boolean).join("\n");
  const reference = `/chat?id=${encodeURIComponent(message.chatId)}&message=${encodeURIComponent(message.id)}`;
  return {
    source_app: "klyra",
    source_account: contexte.compte,
    source_conversation_id: message.chatId,
    source_message_id: message.id,
    source_revision: contexte.revision ?? 1,
    type: contexte.type ?? typeNatif(message, contexte.work_id !== null),
    mode: "natif",
    occurred_at: message.createdAt,
    project_id: contexte.project_id,
    work_id: contexte.work_id,
    cible: { target_kind: "klyra", native_chat_id: message.chatId, native_message_id: message.id },
    local_ref: reference,
    // Le texte complet reste dans conversations.json : seul un résumé borné entre dans le journal.
    payload_ref: `conversations.json${reference}`,
    payload: texte,
    resume: tronquerOctets(texte).texte,
  };
}

export interface ImportOpenBot {
  /** Compte OpenBot de l'agent qui importe. */
  compte: string;
  task_id: string;
  /** Identifiant du message dans la tâche, relu par l'agent (`read_task`) ; absent : quarantaine. */
  message_id: string;
  revision?: number;
  type: TypeMetier;
  texte: string;
  occurred_at?: string | null;
  project_id: string;
  work_id: string | null;
}

/** Import manuel d'un message OpenBot : la tâche reste une référence externe, jamais un fil Klyra. */
export function importManuelOpenBot(entree: ImportOpenBot): EntreeSource {
  const reference = `openbot-task:${entree.task_id}#${entree.message_id}`;
  return {
    source_app: "openbot",
    source_account: entree.compte,
    source_conversation_id: entree.task_id,
    source_message_id: entree.message_id,
    source_revision: entree.revision ?? 1,
    type: entree.type,
    mode: "import_manuel",
    occurred_at: entree.occurred_at ?? null,
    project_id: entree.project_id,
    work_id: entree.work_id,
    cible: { target_kind: "openbot", external_task_id: entree.task_id },
    local_ref: reference,
    payload_ref: reference,
    payload: entree.texte,
    resume: tronquerOctets(entree.texte).texte,
  };
}
