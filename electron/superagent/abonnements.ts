import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ecrire, tous, un } from "./stockage";
import { lireTravail } from "./travaux";
import { RefusSuperagent, TYPES_METIER, type TypeMetier } from "./types";

/**
 * Abonnements des travaux aux événements (point 13), dans le journal : source exacte (application,
 * compte, conversation), types, epoch du responsable. Une clôture ou une suspension les désactive
 * (`changerStatut`), un transfert remplace l'epoch (`revendiquer`). Ce n'est pas une routine et ce
 * n'est pas le flux SSE du serveur Klyra : un abonnement désigne un destinataire, il ne livre rien.
 */

export function normaliserTypes(types: string[]): string {
  const uniques = [...new Set(types)].sort();
  if (uniques.length === 0) throw new RefusSuperagent("types_absents");
  for (const type of uniques) if (!(TYPES_METIER as readonly string[]).includes(type)) throw new RefusSuperagent(`type_inconnu:${type}`);
  return uniques.join(",");
}

/** Abonne un travail actif ; refait sur un abonnement désactivé, c'est la réactivation explicite. */
export function abonner(
  db: DatabaseSync,
  s: { work_id: string; source_app: string; source_account: string; source_conversation_id: string; event_types: TypeMetier[] },
): string {
  const travail = lireTravail(db, s.work_id);
  if (!travail) throw new RefusSuperagent("travail_inconnu");
  if (travail.status !== "active" && travail.status !== "waiting") throw new RefusSuperagent("statut_incompatible");
  const types = normaliserTypes(s.event_types);
  ecrire(
    db,
    `INSERT INTO subscription (subscription_id, work_id, owner_epoch, project_id, source_app, source_account,
       source_conversation_id, event_types, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT (work_id, source_app, source_account, source_conversation_id, event_types)
     DO UPDATE SET enabled = 1, owner_epoch = excluded.owner_epoch`,
    randomUUID(),
    s.work_id,
    travail.owner_epoch,
    travail.project_id,
    s.source_app,
    s.source_account,
    s.source_conversation_id,
    types,
  );
  return un<{ subscription_id: string }>(
    db,
    `SELECT subscription_id FROM subscription WHERE work_id = ? AND source_app = ? AND source_account = ?
       AND source_conversation_id = ? AND event_types = ?`,
    s.work_id,
    s.source_app,
    s.source_account,
    s.source_conversation_id,
    types,
  )!.subscription_id;
}

/** Les travaux actifs abonnés à cet événement : même projet, même source exacte, type listé, epoch courant. */
export function destinataires(db: DatabaseSync, eventId: string): { work_id: string; owner_epoch: number }[] {
  const lignes = tous<{ work_id: string; owner_epoch: number; event_types: string; type: string }>(
    db,
    `SELECT w.work_id, w.owner_epoch, s.event_types, e.type
     FROM event e
     JOIN subscription s ON s.project_id = e.project_id AND s.source_app = e.source_app
       AND s.source_account = e.source_account AND s.source_conversation_id = e.source_conversation_id AND s.enabled = 1
     JOIN work w ON w.work_id = s.work_id AND w.owner_epoch = s.owner_epoch AND w.status IN ('active', 'waiting')
     WHERE e.event_id = ?`,
    eventId,
  );
  const vus = new Set<string>();
  return lignes
    .filter((l) => l.event_types.split(",").includes(l.type) && !vus.has(l.work_id) && vus.add(l.work_id))
    .map(({ work_id, owner_epoch }) => ({ work_id, owner_epoch }));
}

/**
 * Proposition au routeur : un seul abonné, il est désigné ; plusieurs, la décision revient à Cicco,
 * sans affectation multiple spontanée ; aucun, l'événement reste non résolu.
 */
export function proposerRoutage(
  db: DatabaseSync,
  eventId: string,
): { cas: "unique"; work_id: string; owner_epoch: number } | { cas: "cicco"; work_ids: string[] } | { cas: "aucun" } {
  const liste = destinataires(db, eventId);
  if (liste.length === 0) return { cas: "aucun" };
  if (liste.length === 1) return { cas: "unique", ...liste[0] };
  return { cas: "cicco", work_ids: liste.map((d) => d.work_id) };
}
