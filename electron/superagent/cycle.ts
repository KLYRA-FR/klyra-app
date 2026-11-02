import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { abonner } from "./abonnements";
import { classerEvenement } from "./decision";
import { admettre } from "./filtre";
import { depuisMessageKlyra, type MessageNatif } from "./ingestion";
import { livrer } from "./livraison";
import { fermerLot, ouvrirLot } from "./lots";
import { mesurer } from "./mesures";
import { revendiquer } from "./occupation";
import { type Effet } from "./operations";
import { autoriserFil, effetExterneAutorise, lirePolitique } from "./politique";
import { indexerTravail } from "./recherche";
import { ecrire, enTransaction, tous, un } from "./stockage";
import { changerStatut, creerTravail, lireTravail } from "./travaux";
import { noterCheckpoint } from "./watchdog";
import { RefusSuperagent, type Horloge, type StatutTravail, type TypeMetier } from "./types";

/**
 * Cycle d'un fil Klyra : un travail, une politique limitée à ce fil, une décision, une livraison.
 * Le routeur est l'assistant de l'app (`principal`).
 * L'autorité d'écriture est le fichier SQLite de ce PC. L'écran lit la projection par IPC.
 */

export const ROUTEUR_APP = "principal";

export interface ContexteCycle {
  compte: string;
  project_id: string;
  state_ref: string;
  authorization_ref: string;
  router_id?: string;
}

function texteMessage(message: MessageNatif): string {
  return message.parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n");
}

export function typeDuMessage(texte: string): TypeMetier {
  if (/^objectif\s*:/i.test(texte.trim())) return "changement_objectif";
  if (/^priorit[eé]\s*:/i.test(texte.trim())) return "priorite";
  return "precision";
}

export function travailDuFil(db: DatabaseSync, filId: string): string | null {
  return un<{ work_id: string }>(db, "SELECT work_id FROM work WHERE target_kind = 'klyra' AND native_chat_id = ?", filId)?.work_id ?? null;
}

export function placesLibres(db: DatabaseSync): number {
  const n = un<{ n: number }>(db, "SELECT count(*) AS n FROM occupation")?.n ?? 0;
  return Math.max(0, 3 - n);
}

/** Ouvre le travail du fil et en donne la responsabilité à son agent. Un fil déjà ouvert rend le même travail. */
export function ouvrirTravailFil(
  db: DatabaseSync,
  c: ContexteCycle & { fil_id: string; role_id: string; titre: string; deadline_at?: string | null; priority?: number },
  maintenant: Horloge = Date.now,
): { ok: true; work_id: string; existant: boolean; owner_epoch: number } | { ok: false; motif: string } {
  try {
    return enTransaction(db, () => ouvrirTravailFilDans(db, c, maintenant));
  } catch (error) {
    if (error instanceof RefusSuperagent) return { ok: false, motif: error.motif };
    throw error;
  }
}

function ouvrirTravailFilDans(
  db: DatabaseSync,
  c: ContexteCycle & { fil_id: string; role_id: string; titre: string; deadline_at?: string | null; priority?: number },
  maintenant: Horloge,
): { ok: true; work_id: string; existant: boolean; owner_epoch: number } | { ok: false; motif: string } {
  const deja = travailDuFil(db, c.fil_id);
  if (deja) {
    const travail = lireTravail(db, deja)!;
    return { ok: true, work_id: deja, existant: true, owner_epoch: travail.owner_epoch };
  }
  if (placesLibres(db) < 1) return { ok: false, motif: "capacite_atteinte" };
  const cree = creerTravail(
    db,
    {
      project_id: c.project_id,
      canonical_source_request: `klyra-fil:${c.fil_id}`,
      cible: { target_kind: "klyra", native_chat_id: c.fil_id },
      state_ref: c.state_ref,
      titre: c.titre,
      deadline_at: c.deadline_at ?? null,
    },
    maintenant,
  );
  if (cree.existant) {
    const travail = lireTravail(db, cree.work_id)!;
    return { ok: true, work_id: cree.work_id, existant: true, owner_epoch: travail.owner_epoch };
  }
  const claim = revendiquer(db, { work_id: cree.work_id, agent_id: c.role_id, epoch_attendu: 0 }, maintenant);
  if (!claim.ok) throw new RefusSuperagent(claim.motif);
  autoriserFil(db, { project_id: c.project_id, compte: c.compte, fil_id: c.fil_id, approval_ref: c.authorization_ref }, maintenant);
  abonner(db, {
    work_id: cree.work_id,
    source_app: "klyra",
    source_account: c.compte,
    source_conversation_id: c.fil_id,
    event_types: ["demande", "precision", "changement_objectif", "priorite", "resultat", "erreur", "fin_verification"],
  });
  indexerTravail(db, { work_id: cree.work_id, account: c.compte }, maintenant);
  if (c.priority) ecrire(db, "UPDATE work SET priority = ? WHERE work_id = ?", c.priority, cree.work_id);
  return { ok: true, work_id: cree.work_id, existant: false, owner_epoch: claim.owner_epoch };
}

export interface IssueCycle {
  work_id: string | null;
  event_id: string | null;
  disposition: string;
  motif: string;
  operations: string[];
  livraisons: { operation_id: string; status: string }[];
}

/**
 * Admet un message du fil, décide le lot, livre au plus une fois.
 * `transport` constate le message déjà dans le fil : il ne doit pas en écrire un second.
 */
export async function ingererMessageFil(
  db: DatabaseSync,
  c: ContexteCycle & { fil_id: string; message: MessageNatif; transport: Effet; typeMessage?: TypeMetier },
  maintenant: Horloge = Date.now,
): Promise<IssueCycle> {
  const workId = c.message ? travailDuFil(db, c.fil_id) : null;
  const politique = lirePolitique(db, c.project_id);
  const entree = depuisMessageKlyra(c.message, {
    compte: c.compte,
    project_id: c.project_id,
    work_id: workId,
    type: c.message.author.kind === "user" ? (c.typeMessage ?? typeDuMessage(texteMessage(c.message))) : undefined,
  });
  if (!entree) return { work_id: workId, event_id: null, disposition: "ignore", motif: "message_en_cours", operations: [], livraisons: [] };
  const admission = admettre(db, entree, politique, maintenant);
  if (admission.disposition === "doublon") {
    return { work_id: workId, event_id: admission.event_id, disposition: "doublon", motif: "tuple_source_existant", operations: [], livraisons: [] };
  }
  if (admission.disposition !== "accepte") {
    return { work_id: workId, event_id: null, disposition: admission.disposition, motif: admission.motif, operations: [], livraisons: [] };
  }
  const routerId = c.router_id ?? ROUTEUR_APP;
  if (routerId !== ROUTEUR_APP) {
    return { work_id: workId, event_id: admission.event_id, disposition: "attendre", motif: "routeur_non_autorise", operations: [], livraisons: [] };
  }
  const lot = ouvrirLot(db, { router_id: routerId, project_id: c.project_id, policy_version: politique?.version ?? 0 }, maintenant);
  if (lot.etat === "occupe") {
    return { work_id: workId, event_id: admission.event_id, disposition: "en_attente_de_lot", motif: lot.decision_id, operations: [], livraisons: [] };
  }
  if (lot.etat === "vide") {
    return { work_id: workId, event_id: admission.event_id, disposition: "vide", motif: "rien_a_decider", operations: [], livraisons: [] };
  }
  const decisions = lot.evenements.map((e) => {
    const classe = classerEvenement(db, e.event_id);
    return { event_id: e.event_id, disposition: classe.disposition, work_id: classe.work_id, owner_epoch_attendu: classe.owner_epoch_attendu, motif: classe.motif };
  });
  const ferme = fermerLot(db, { decision_id: lot.decision_id, decisions, authorization_ref: c.authorization_ref }, maintenant);
  const travail = workId ? lireTravail(db, workId) : undefined;
  const livraisons: { operation_id: string; status: string }[] = [];
  for (const operationId of ferme.operations) {
    if (!travail?.owner_agent_id) continue;
    const rendu = await livrer(db, { operation_id: operationId, agent_id: travail.owner_agent_id, transport: c.transport }, maintenant);
    livraisons.push({ operation_id: operationId, status: rendu.ok ? rendu.status : rendu.motif });
  }
  const classe = classerEvenement(db, admission.event_id);
  if ((c.message.author.kind === "role" && c.message.statut !== "erreur") || c.message.statut === "fait") {
    if (workId) noterCheckpoint(db, workId, `message:${c.message.id}`, maintenant);
  }
  return {
    work_id: workId,
    event_id: admission.event_id,
    disposition: classe.disposition,
    motif: classe.motif,
    operations: ferme.operations,
    livraisons,
  };
}

export function marquerTravailFil(
  db: DatabaseSync,
  c: { fil_id: string; status: Exclude<StatutTravail, "reconciliation_required">; controle_ref?: string | null },
  maintenant: Horloge = Date.now,
): { ok: true } | { ok: false; motif: string } {
  const workId = travailDuFil(db, c.fil_id);
  if (!workId) return { ok: true };
  const travail = lireTravail(db, workId);
  if (!travail) return { ok: false, motif: "travail_inconnu" };
  // Reprendre un travail suspendu, ou une attente de machine, exige un contrôle. Aucune machine n'est contactée.
  if ((c.status === "active" || c.status === "waiting") && (travail.status === "suspended" || travail.status === "waiting_machine") && !c.controle_ref) {
    return { ok: false, motif: "controle_requis" };
  }
  if ((c.status === "active" || c.status === "waiting") && (travail.status === "cancelled" || travail.status === "done")) {
    return { ok: false, motif: "travail_clos" };
  }
  try {
    changerStatut(db, { work_id: workId, status: c.status, owner_epoch_attendu: travail.owner_epoch }, maintenant);
    if (c.status === "active") {
      ecrire(db, "UPDATE subscription SET enabled = 1, owner_epoch = ? WHERE work_id = ?", travail.owner_epoch, workId);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, motif: error instanceof RefusSuperagent ? error.motif : "refus" };
  }
}

/** Préparation anticipée : refusée tant que le plafond de dépense n'est pas un nombre positif. */
export function preparer(db: DatabaseSync, filId: string, maintenant: Horloge = Date.now): { ok: true } | { ok: false; motif: string } {
  const workId = travailDuFil(db, filId);
  if (!workId) return { ok: false, motif: "travail_inconnu" };
  const travail = lireTravail(db, workId)!;
  const politique = lirePolitique(db, travail.project_id);
  if (politique?.spend_cap == null || politique.spend_cap <= 0) return { ok: false, motif: "plafond_absent" };
  const deja = un(db, "SELECT 1 AS ok FROM preparation WHERE work_id = ? AND objective_revision = ?", workId, travail.objective_revision);
  if (deja) return { ok: false, motif: "deja_prepare" };
  ecrire(
    db,
    "INSERT INTO preparation (preparation_id, work_id, objective_revision, started_at) VALUES (?, ?, ?, ?)",
    randomUUID(),
    workId,
    travail.objective_revision,
    new Date(maintenant()).toISOString(),
  );
  return { ok: true };
}

export function preparerInterdit(kind: string, authorizationRef: string | null, projectId: string, db: DatabaseSync) {
  const politique = lirePolitique(db, projectId);
  return effetExterneAutorise(kind, authorizationRef, politique?.allowed_kinds ?? []);
}

export interface LigneProjection {
  work_id: string;
  fil_id: string | null;
  titre: string;
  owner_agent_id: string | null;
  status: string;
  state_ref: string;
  priority: number;
  objective_revision: number;
  deadline_at: string | null;
  mesures_cout: string | null;
}

export interface Projection {
  travaux: LigneProjection[];
  alertes: { work_id: string; type: string; motif: string; prochain_geste: string }[];
  blocages: { point: string; texte: string }[];
  couverture: "ok" | "journal_illisible";
}

export function projection(db: DatabaseSync, projectId: string | null): Projection {
  const travaux = tous<LigneProjection>(
    db,
    `SELECT work_id, native_chat_id AS fil_id, titre, owner_agent_id, status, state_ref, priority, objective_revision, deadline_at,
            NULL AS mesures_cout
     FROM work WHERE (? IS NULL OR project_id = ?) ORDER BY created_at`,
    projectId,
    projectId,
  );
  for (const ligne of travaux) {
    const cout = mesurer(db, ligne.work_id).cout;
    ligne.mesures_cout = cout.motif;
  }
  const alertes = tous<{ work_id: string; type: string; motif: string; prochain_geste: string }>(
    db,
    `SELECT a.work_id, a.type, a.motif, a.prochain_geste FROM alerte a
     JOIN work w ON w.work_id = a.work_id
     WHERE a.resolved_at IS NULL AND (? IS NULL OR w.project_id = ?)
     ORDER BY a.opened_at`,
    projectId,
    projectId,
  );
  return { travaux, alertes, blocages: [], couverture: "ok" };
}

/** Preuves lisibles par le watchdog (point 36) : identifiants et statuts, pas le texte des messages. */
export function preuvesTravail(db: DatabaseSync, workId: string) {
  const travail = lireTravail(db, workId);
  if (!travail) return null;
  return {
    work_id: travail.work_id,
    status: travail.status,
    owner_agent_id: travail.owner_agent_id,
    owner_epoch: travail.owner_epoch,
    state_ref: travail.state_ref,
    objective_revision: travail.objective_revision,
    operations: tous(db, "SELECT operation_id, status, attempts, effect_check_ref FROM operation WHERE work_id = ?", workId),
    recus: tous(db, "SELECT event_id, owner_epoch, preuve_ref FROM receipt WHERE work_id = ?", workId),
    checkpoints: tous(db, "SELECT preuve_ref, observed_at FROM checkpoint WHERE work_id = ? ORDER BY observed_at", workId),
    alertes: tous(db, "SELECT type, motif, preuve_ref, resolved_at FROM alerte WHERE work_id = ?", workId),
  };
}
