import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ecrire, enTransaction, un } from "./stockage";
import { RefusSuperagent, iso, type Horloge, type StatutTravail, type Travail } from "./types";

/**
 * Travaux (table `work`) : un par requête d'origine canonique (UNIQUE), cible typée Klyra ou OpenBot,
 * état métier pointé dans DIGITAL-OS (`state_ref`). Le titre s'affiche, il n'identifie jamais (point 26).
 */

export type CibleTravail = { target_kind: "klyra"; native_chat_id: string } | { target_kind: "openbot"; external_task_id: string };

export type TypeReference =
  | "klyra_chat"
  | "klyra_message"
  | "klyra_request"
  | "klyra_session"
  | "openbot_task"
  | "digital_os_state"
  | "digital_os_project"
  | "github_pr";

export function lireTravail(db: DatabaseSync, workId: string): Travail | undefined {
  return un<Travail>(db, "SELECT * FROM work WHERE work_id = ?", workId);
}

/** Crée le travail d'une requête d'origine ; la même requête rend le travail existant, jamais un second. */
export function creerTravail(
  db: DatabaseSync,
  t: { project_id: string; canonical_source_request: string; cible: CibleTravail; state_ref: string; titre?: string; deadline_at?: string | null },
  maintenant: Horloge = Date.now,
): { work_id: string; existant: boolean } {
  return enTransaction(db, () => {
    const workId = randomUUID();
    const crees = ecrire(
      db,
      `INSERT INTO work (work_id, project_id, canonical_source_request, target_kind, native_chat_id, external_task_id,
         state_ref, titre, deadline_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (canonical_source_request) DO NOTHING`,
      workId,
      t.project_id,
      t.canonical_source_request,
      t.cible.target_kind,
      t.cible.target_kind === "klyra" ? t.cible.native_chat_id : null,
      t.cible.target_kind === "openbot" ? t.cible.external_task_id : null,
      t.state_ref,
      t.titre ?? "",
      t.deadline_at ?? null,
      iso(maintenant()),
    );
    if (crees === 0) {
      const existant = un<{ work_id: string }>(db, "SELECT work_id FROM work WHERE canonical_source_request = ?", t.canonical_source_request);
      return { work_id: existant!.work_id, existant: true };
    }
    if (t.cible.target_kind === "klyra") lierReference(db, workId, "klyra_chat", t.cible.native_chat_id);
    else lierReference(db, workId, "openbot_task", t.cible.external_task_id);
    lierReference(db, workId, "digital_os_state", t.state_ref);
    lierReference(db, workId, "digital_os_project", t.project_id);
    return { work_id: workId, existant: false };
  });
}

/** Relie une référence externe typée (fil successeur, requestId, session…) au même travail. */
export function lierReference(db: DatabaseSync, workId: string, kind: TypeReference, ref: string): void {
  ecrire(db, "INSERT INTO lien_externe (work_id, kind, ref) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", workId, kind, ref);
}

/** Change le titre affiché ; les liens passent par les identifiants et ne bougent pas. */
export function renommerTravail(db: DatabaseSync, workId: string, titre: string): void {
  if (ecrire(db, "UPDATE work SET titre = ? WHERE work_id = ?", titre, workId) !== 1) throw new RefusSuperagent("travail_inconnu");
}

const OPERATIONS_A_VERIFIER = "('inflight', 'unknown', 'reconciliation_required')";

/**
 * Change le statut métier d'un travail, sous l'epoch attendu. Clore ou annuler exige l'inventaire :
 * aucune opération en vol ou à vérifier ; les intentions non commencées sont annulées, les abonnements
 * désactivés et l'occupation libérée. Un travail clos ou annulé ne reprend pas. Suspendre désactive
 * les abonnements : leur réactivation est un nouvel `abonner`, après relecture de l'état.
 */
export function changerStatut(
  db: DatabaseSync,
  c: { work_id: string; status: Exclude<StatutTravail, "reconciliation_required">; owner_epoch_attendu: number },
  maintenant: Horloge = Date.now,
): void {
  enTransaction(db, () => {
    const travail = lireTravail(db, c.work_id);
    if (!travail) throw new RefusSuperagent("travail_inconnu");
    if (travail.owner_epoch !== c.owner_epoch_attendu) throw new RefusSuperagent("epoch_perime");
    if (travail.status === "done" || travail.status === "cancelled") throw new RefusSuperagent("travail_clos");
    if (travail.status === "reconciliation_required") throw new RefusSuperagent("reconciliation_requise");
    const maintenantIso = iso(maintenant());

    if (c.status === "done" || c.status === "cancelled") {
      const restantes = un<{ n: number }>(
        db,
        `SELECT count(*) AS n FROM operation WHERE work_id = ? AND status IN ${OPERATIONS_A_VERIFIER}`,
        c.work_id,
      );
      if ((restantes?.n ?? 0) > 0) throw new RefusSuperagent("operations_a_verifier");
      ecrire(
        db,
        "UPDATE operation SET status = 'cancelled', status_motif = 'travail_clos', updated_at = ? WHERE work_id = ? AND status = 'planned'",
        maintenantIso,
        c.work_id,
      );
      ecrire(db, "DELETE FROM occupation WHERE work_id = ?", c.work_id);
      ecrire(db, "UPDATE work SET owner_agent_id = NULL, lease_until = NULL WHERE work_id = ?", c.work_id);
    }
    if (c.status === "done" || c.status === "cancelled" || c.status === "suspended") {
      ecrire(db, "UPDATE subscription SET enabled = 0 WHERE work_id = ?", c.work_id);
    }
    ecrire(db, "UPDATE work SET status = ?, last_progress_at = ? WHERE work_id = ?", c.status, maintenantIso, c.work_id);
  });
}
