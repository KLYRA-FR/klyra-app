import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ecrire, tous, un } from "./stockage";
import type { TypeReference } from "./travaux";
import { iso, type Horloge, type Operation, type Travail } from "./types";

/**
 * Identifiants stables et navigation (point 26) : source → événement → travail → décision → opération
 * → preuve, et retour. On garde les identifiants natifs (PRJ, chatId, messageId, requestId, sessionId,
 * taskId) comme références typées ; work_id, event_id, operation_id, decision_id et artifact_id sont des
 * UUID. Rien n'est retrouvé par un titre : le renommer ne change aucun lien.
 */

export function ajouterArtefact(
  db: DatabaseSync,
  a: { work_id: string; operation_id?: string | null; decision_id?: string | null; kind: "resultat" | "preuve" | "etat"; ref: string; hash: string },
  maintenant: Horloge = Date.now,
): string {
  const artifactId = randomUUID();
  ecrire(
    db,
    "INSERT INTO artefact (artifact_id, work_id, operation_id, decision_id, kind, ref, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    artifactId,
    a.work_id,
    a.operation_id ?? null,
    a.decision_id ?? null,
    a.kind,
    a.ref,
    a.hash,
    iso(maintenant()),
  );
  return artifactId;
}

/** Les travaux reliés à une référence externe de ce type précis : un taskId n'est jamais pris pour un chatId. */
export function travauxPourReference(db: DatabaseSync, kind: TypeReference, ref: string): string[] {
  return tous<{ work_id: string }>(db, "SELECT work_id FROM lien_externe WHERE kind = ? AND ref = ? ORDER BY work_id", kind, ref).map(
    (l) => l.work_id,
  );
}

export interface Trace {
  evenement: {
    event_id: string;
    source: { app: string; account: string; conversation_id: string; message_id: string; revision: number };
    mode: string;
    received_at: string;
    local_ref: string | null;
  };
  travaux: {
    travail: Pick<Travail, "work_id" | "titre" | "target_kind" | "native_chat_id" | "external_task_id" | "state_ref" | "objective_revision">;
    references: { kind: string; ref: string }[];
    disposition: string;
    decision: { decision_id: string; router_id: string; status: string };
    operations: Pick<Operation, "operation_id" | "kind" | "status" | "attempts" | "external_receipt_ref" | "effect_check_ref">[];
    recus: { owner_epoch: number; acked_at: string; preuve_ref: string }[];
    artefacts: { artifact_id: string; kind: string; ref: string; hash: string }[];
  }[];
}

/** De l'événement à ses effets et preuves, pour chaque travail qu'il a touché. */
export function tracer(db: DatabaseSync, eventId: string): Trace | null {
  const e = un<Record<string, string | number | null>>(db, "SELECT * FROM event WHERE event_id = ?", eventId);
  if (!e) return null;
  const liens = tous<{ work_id: string; disposition: string; decision_id: string }>(
    db,
    "SELECT work_id, disposition, decision_id FROM event_work WHERE event_id = ? ORDER BY work_id",
    eventId,
  );
  return {
    evenement: {
      event_id: eventId,
      source: {
        app: String(e.source_app),
        account: String(e.source_account),
        conversation_id: String(e.source_conversation_id),
        message_id: String(e.source_message_id),
        revision: Number(e.source_revision),
      },
      mode: String(e.mode),
      received_at: String(e.received_at),
      local_ref: e.local_ref === null ? null : String(e.local_ref),
    },
    travaux: liens.map((l) => {
      const operations = tous<Trace["travaux"][number]["operations"][number]>(
        db,
        `SELECT operation_id, kind, status, attempts, external_receipt_ref, effect_check_ref FROM operation
         WHERE event_id = ? AND work_id = ? ORDER BY created_at`,
        eventId,
        l.work_id,
      );
      return {
        travail: un<Trace["travaux"][number]["travail"]>(
          db,
          "SELECT work_id, titre, target_kind, native_chat_id, external_task_id, state_ref, objective_revision FROM work WHERE work_id = ?",
          l.work_id,
        )!,
        references: tous<{ kind: string; ref: string }>(db, "SELECT kind, ref FROM lien_externe WHERE work_id = ? ORDER BY kind, ref", l.work_id),
        disposition: l.disposition,
        decision: un<{ decision_id: string; router_id: string; status: string }>(
          db,
          "SELECT decision_id, router_id, status FROM decision_batch WHERE decision_id = ?",
          l.decision_id,
        )!,
        operations,
        recus: tous<{ owner_epoch: number; acked_at: string; preuve_ref: string }>(
          db,
          "SELECT owner_epoch, acked_at, preuve_ref FROM receipt WHERE event_id = ? AND work_id = ? ORDER BY owner_epoch",
          eventId,
          l.work_id,
        ),
        artefacts: tous<{ artifact_id: string; kind: string; ref: string; hash: string }>(
          db,
          `SELECT artifact_id, kind, ref, hash FROM artefact WHERE work_id = ?
             AND (decision_id = ? OR operation_id IN (SELECT operation_id FROM operation WHERE event_id = ?)) ORDER BY created_at`,
          l.work_id,
          l.decision_id,
          eventId,
        ),
      };
    }),
  };
}

/** Le chemin retour : d'une opération (ou de sa preuve) jusqu'à la source et à la décision. */
export function remonter(
  db: DatabaseSync,
  operationId: string,
): { operation_id: string; work_id: string; state_ref: string; event_id: string | null; decision_id: string | null; source_ref: string | null } | null {
  return (
    un(
      db,
      `SELECT o.operation_id, o.work_id, w.state_ref, o.event_id, ew.decision_id, coalesce(e.source_url, e.local_ref) AS source_ref
       FROM operation o
       JOIN work w ON w.work_id = o.work_id
       LEFT JOIN event e ON e.event_id = o.event_id
       LEFT JOIN event_work ew ON ew.event_id = o.event_id AND ew.work_id = o.work_id
       WHERE o.operation_id = ?`,
      operationId,
    ) ?? null
  );
}
