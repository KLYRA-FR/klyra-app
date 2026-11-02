/**
 * Fondation super-agent : types et limites communs (contrat v2, points 07–09, 12–14, 20–22, 26–27, 41–42).
 * Les champs gardent les noms du contrat (`event_id`, `owner_epoch`…) pour qu'on retrouve chaque
 * contrainte du contrat dans le schéma (`stockage.ts`). Branché sur les fils par `outils-fils.ts`. Voir `docs/SUPERAGENT.md`.
 */

/** Types d'événements métier (point 07). */
export const TYPES_METIER = [
  "demande",
  "precision",
  "changement_objectif",
  "priorite",
  "resultat",
  "erreur",
  "commentaire_pr",
  "fin_verification",
] as const;
export type TypeMetier = (typeof TYPES_METIER)[number];

/** Les seuls types ignorés par le premier filtre (point 09). Une erreur métier n'en fait jamais partie. */
export const TYPES_TECHNIQUES = ["heartbeat", "accuse_transport"] as const;

export const RESUME_MAX_OCTETS = 8 * 1024;
export const LOT_MAX_EVENEMENTS = 50;
export const LOT_MAX_OCTETS = 32 * 1024;
/** Sémaphore du programme : trois occupations au plus, routeur et surveillance compris s'ils tournent (point 21). */
export const CAPACITE_OCCUPATIONS = 3;
export const BAIL_MS = 10 * 60_000;
/** L'exécutant renouvelle son bail au moins à cet intervalle. */
export const RENOUVELLEMENT_MS = 3 * 60_000;
/** Deux essais au total, initial compris (points 22 et 23). */
export const ESSAIS_MAX = 2;
export const DELAI_DECISION_MS = 5 * 60_000;

export type ModeEntree = "natif" | "import_manuel" | "fixture";

/** Cible typée : un fil Klyra ou une tâche OpenBot, jamais l'un converti en l'autre (point 26). */
export type Cible =
  | { target_kind: "klyra"; native_chat_id: string; native_message_id: string | null }
  | { target_kind: "openbot"; external_task_id: string };

/** Ce qu'une source donne, avant contrôle. Tout peut manquer : l'enveloppe refuse ou met en quarantaine. */
export interface EntreeSource {
  source_app?: string;
  source_account?: string;
  source_conversation_id?: string;
  source_message_id?: string;
  source_revision?: number;
  type?: string;
  mode?: ModeEntree;
  occurred_at?: string | null;
  project_id?: string;
  work_id?: string | null;
  cible?: Cible | null;
  source_url?: string | null;
  local_ref?: string | null;
  payload_ref?: string | null;
  /** Texte complet, seulement pour son empreinte : il n'est pas gardé. */
  payload?: string;
  payload_hash?: string;
  resume?: string;
}

/** Un événement validé, prêt à être inséré (table `event`). */
export interface Enveloppe {
  event_id: string;
  source_app: string;
  source_account: string;
  source_conversation_id: string;
  source_message_id: string;
  source_revision: number;
  type: TypeMetier;
  mode: ModeEntree;
  occurred_at: string | null;
  occurred_at_motif: string | null;
  received_at: string;
  project_id: string;
  work_id: string | null;
  target_kind: "klyra" | "openbot" | null;
  native_chat_id: string | null;
  native_message_id: string | null;
  external_task_id: string | null;
  source_url: string | null;
  local_ref: string | null;
  payload_ref: string | null;
  payload_hash: string;
  resume: string;
  trust: "external_data";
  policy_version: number;
}

/**
 * Le strict nécessaire de la politique d'un projet pour le premier filtre. La politique complète
 * (autonomie, outils, budgets, approbation, versions datées) est le point 11, en vague 3.
 */
export interface PolitiqueProjet {
  project_id: string;
  version: number;
  enabled: boolean;
  source_allowlist: {
    source_app: string;
    source_account: string;
    source_conversation_id: string;
    types: TypeMetier[];
  }[];
}

/** Désactivée par défaut, aucune source admise (point 11). */
export function politiqueParDefaut(project_id: string): PolitiqueProjet {
  return { project_id, version: 0, enabled: false, source_allowlist: [] };
}

export type StatutTravail =
  | "active"
  | "waiting"
  | "waiting_machine"
  | "suspended"
  | "cancelled"
  | "done"
  | "blocked"
  | "reconciliation_required";

export type StatutOperation =
  | "planned"
  | "inflight"
  | "succeeded"
  | "failed"
  | "unknown"
  | "reconciliation_required"
  | "blocked"
  | "cancelled";

export type Disposition = "agir" | "repondre" | "attendre" | "ne_rien_faire";

/** Ce qu'on constate d'un effet sans le refaire. */
export type Constat = "present" | "absent" | "inverifiable";

export interface Travail {
  work_id: string;
  project_id: string;
  canonical_source_request: string;
  target_kind: "klyra" | "openbot";
  native_chat_id: string | null;
  external_task_id: string | null;
  state_ref: string;
  titre: string;
  owner_agent_id: string | null;
  owner_epoch: number;
  status: StatutTravail;
  priority: number;
  objective_revision: number;
  last_progress_at: string | null;
  deadline_at: string | null;
  lease_until: string | null;
  created_at: string;
}

export interface Operation {
  operation_id: string;
  work_id: string;
  event_id: string | null;
  idempotency_key: string;
  kind: string;
  target_ref: string;
  desired_effect: string;
  authorization_ref: string;
  rollback_ref: string | null;
  owner_epoch: number;
  objective_revision: number;
  attempts: number;
  deadline_at: string | null;
  status: StatutOperation;
  status_motif: string | null;
  external_receipt_ref: string | null;
  effect_check_ref: string | null;
  next_check_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Refus explicite : la transaction qui le lève est annulée en entier. */
export class RefusSuperagent extends Error {
  constructor(readonly motif: string, message?: string) {
    super(message ?? motif);
  }
}

/** Horloge injectable (tests) ; dates en ISO UTC. */
export type Horloge = () => number;
export const iso = (ms: number) => new Date(ms).toISOString();
