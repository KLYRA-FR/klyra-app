import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { effetExterneAutorise, lirePolitique } from "./politique";
import { ecrire, enTransaction, tous, un } from "./stockage";
import { lireTravail } from "./travaux";
import { ESSAIS_MAX, iso, type Constat, type Horloge, type Operation, type StatutOperation } from "./types";

/**
 * Intention avant effet (point 22) : `planned` est écrit avant tout appel, `inflight` (essai compté)
 * est validé sur le disque avant le départ, `succeeded` exige la preuve d'effet. Après incident :
 * `unknown`, puis on constate l'effet sans le refaire. Effet présent : confirmé, jamais rejoué.
 * Absence prouvée, droits et révision intacts, essai restant : une seule reprise. Sinon : `blocked`.
 * Aucune garantie « exactement une fois » sur un système externe : au moins une fois, effet contrôlé.
 */

export interface Intention {
  work_id: string;
  event_id?: string | null;
  idempotency_key: string;
  kind: string;
  target_ref: string;
  /** Effet attendu, vérifiable : par exemple l'empreinte de l'état à écrire. */
  desired_effect: string;
  authorization_ref: string;
  rollback_ref?: string | null;
  deadline_at?: string | null;
}

export type ResultatPlanification = { ok: true; operation_id: string; existante: boolean } | { ok: false; motif: string };

export function lireOperation(db: DatabaseSync, operationId: string): Operation | undefined {
  return un<Operation>(db, "SELECT * FROM operation WHERE operation_id = ?", operationId);
}

/** Écrit l'intention. Une clé d'idempotence déjà connue rend l'opération existante, sans en créer une seconde. */
export function planifier(db: DatabaseSync, i: Intention, maintenant: Horloge = Date.now): ResultatPlanification {
  return enTransaction(db, (): ResultatPlanification => {
    const existante = un<Operation>(db, "SELECT * FROM operation WHERE idempotency_key = ?", i.idempotency_key);
    if (existante) {
      if (existante.work_id !== i.work_id) return { ok: false, motif: "cle_en_conflit" };
      return { ok: true, operation_id: existante.operation_id, existante: true };
    }
    const travail = lireTravail(db, i.work_id);
    if (!travail) return { ok: false, motif: "travail_inconnu" };
    const garde = effetExterneAutorise(i.kind, i.authorization_ref, lirePolitique(db, travail.project_id)?.allowed_kinds ?? []);
    if (!garde.ok) return { ok: false, motif: garde.motif };
    if (travail.status !== "active") return { ok: false, motif: "statut_incompatible" };
    if (!travail.owner_agent_id) return { ok: false, motif: "travail_sans_responsable" };
    const operationId = randomUUID();
    const t = iso(maintenant());
    ecrire(
      db,
      `INSERT INTO operation (operation_id, work_id, event_id, idempotency_key, kind, target_ref, desired_effect,
         authorization_ref, rollback_ref, owner_epoch, objective_revision, deadline_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      operationId,
      i.work_id,
      i.event_id ?? null,
      i.idempotency_key,
      i.kind,
      i.target_ref,
      i.desired_effect,
      i.authorization_ref,
      i.rollback_ref ?? null,
      travail.owner_epoch,
      travail.objective_revision,
      i.deadline_at ?? null,
      t,
      t,
    );
    return { ok: true, operation_id: operationId, existante: false };
  });
}

function statut(db: DatabaseSync, operationId: string, status: StatutOperation, motif: string | null, t: string) {
  ecrire(db, "UPDATE operation SET status = ?, status_motif = ?, updated_at = ? WHERE operation_id = ?", status, motif, t, operationId);
}

export type ResultatDepart = { ok: true; attempts: number } | { ok: false; motif: string };

/**
 * Réserve un essai : vérifie responsable, epoch, bail, statut et révision d'objectif, compte l'essai,
 * passe en `inflight`, et COMMIT avant que l'appelant ne produise l'effet. Pas de troisième essai.
 */
export function demarrer(db: DatabaseSync, c: { operation_id: string; agent_id: string }, maintenant: Horloge = Date.now): ResultatDepart {
  return enTransaction(db, (): ResultatDepart => {
    const t = maintenant();
    const op = lireOperation(db, c.operation_id);
    if (!op) return { ok: false, motif: "operation_inconnue" };
    if (op.status !== "planned") return { ok: false, motif: `statut_${op.status}` };
    if (op.attempts >= ESSAIS_MAX) {
      statut(db, op.operation_id, "blocked", "essais_epuises", iso(t));
      return { ok: false, motif: "essais_epuises" };
    }
    const travail = lireTravail(db, op.work_id);
    if (!travail || travail.status !== "active") return { ok: false, motif: "travail_inactif" };
    if (travail.owner_agent_id !== c.agent_id) return { ok: false, motif: "pas_responsable" };
    if (travail.owner_epoch !== op.owner_epoch) return { ok: false, motif: "epoch_perime" };
    if (!travail.lease_until || Date.parse(travail.lease_until) <= t) return { ok: false, motif: "bail_expire" };
    if (travail.objective_revision !== op.objective_revision) {
      statut(db, op.operation_id, "cancelled", "objectif_revise", iso(t));
      return { ok: false, motif: "objectif_revise" };
    }
    ecrire(
      db,
      "UPDATE operation SET status = 'inflight', status_motif = NULL, attempts = attempts + 1, updated_at = ? WHERE operation_id = ? AND status = 'planned'",
      iso(t),
      op.operation_id,
    );
    return { ok: true, attempts: op.attempts + 1 };
  });
}

/** Effet observé : `succeeded`, avec sa preuve (le moteur refuse un succès sans `effect_check_ref`). */
export function confirmer(
  db: DatabaseSync,
  c: { operation_id: string; external_receipt_ref: string | null; effect_check_ref: string },
  maintenant: Horloge = Date.now,
): void {
  const changes = ecrire(
    db,
    `UPDATE operation SET status = 'succeeded', status_motif = NULL, external_receipt_ref = coalesce(?, external_receipt_ref),
       effect_check_ref = ?, updated_at = ?
     WHERE operation_id = ? AND status IN ('inflight', 'unknown', 'failed', 'reconciliation_required')`,
    c.external_receipt_ref,
    c.effect_check_ref,
    iso(maintenant()),
    c.operation_id,
  );
  if (changes !== 1) throw new Error(`Opération ${c.operation_id} : rien à confirmer.`);
}

/** Échec : absence d'effet prouvée → `failed` (ou `blocked` après le second essai) ; sinon `unknown`. */
export function echouer(
  db: DatabaseSync,
  c: { operation_id: string; motif: string; effet_absent: boolean },
  maintenant: Horloge = Date.now,
): StatutOperation {
  return enTransaction(db, () => {
    const op = lireOperation(db, c.operation_id);
    if (!op || op.status !== "inflight") throw new Error(`Opération ${c.operation_id} : pas en vol.`);
    const suivant: StatutOperation = !c.effet_absent ? "unknown" : op.attempts >= ESSAIS_MAX ? "blocked" : "failed";
    statut(db, op.operation_id, suivant, suivant === "blocked" ? `deux_essais_echoues:${c.motif}` : c.motif, iso(maintenant()));
    return suivant;
  });
}

/**
 * Au démarrage du composant : ce qui était en vol devient `unknown` (l'effet a pu partir) ; un lot
 * resté en décision est abandonné et ses événements reviennent en attente (la décision et ses
 * opérations s'écrivent ensemble à la fermeture du lot : un lot ouvert n'a rien produit).
 */
export function reprendreApresRedemarrage(db: DatabaseSync, maintenant: Horloge = Date.now): { inconnues: string[]; lots_abandonnes: string[] } {
  return enTransaction(db, () => {
    const t = iso(maintenant());
    const enVol = tous<{ operation_id: string }>(db, "SELECT operation_id FROM operation WHERE status = 'inflight'");
    for (const { operation_id } of enVol) statut(db, operation_id, "unknown", "redemarrage", t);
    const lots = tous<{ decision_id: string }>(db, "SELECT decision_id FROM decision_batch WHERE status = 'deciding'");
    for (const { decision_id } of lots) {
      ecrire(db, "UPDATE event SET status = 'pending', decision_id = NULL WHERE decision_id = ? AND status = 'deciding'", decision_id);
      ecrire(db, "UPDATE decision_batch SET status = 'abandoned', status_motif = 'redemarrage' WHERE decision_id = ?", decision_id);
    }
    return { inconnues: enVol.map((o) => o.operation_id), lots_abandonnes: lots.map((l) => l.decision_id) };
  });
}

/** Rapproche une opération incertaine de ce qu'on constate réellement. */
export function reconcilier(
  db: DatabaseSync,
  c: { operation_id: string; constat: Constat; preuve_ref: string | null },
  maintenant: Horloge = Date.now,
): StatutOperation {
  return enTransaction(db, (): StatutOperation => {
    const t = iso(maintenant());
    const op = lireOperation(db, c.operation_id);
    if (!op || !["unknown", "failed", "reconciliation_required"].includes(op.status)) {
      throw new Error(`Opération ${c.operation_id} : rien à rapprocher.`);
    }
    if (c.constat === "present") {
      if (!c.preuve_ref) throw new Error("Un effet présent se confirme avec sa preuve.");
      confirmer(db, { operation_id: op.operation_id, external_receipt_ref: null, effect_check_ref: c.preuve_ref }, maintenant);
      return "succeeded";
    }
    if (c.constat === "inverifiable") {
      statut(db, op.operation_id, "blocked", "effet_inverifiable", t);
      return "blocked";
    }
    const travail = lireTravail(db, op.work_id);
    const motif =
      op.attempts >= ESSAIS_MAX ? "deux_essais_echoues"
      : !travail || travail.status !== "active" ? "travail_inactif"
      : travail.owner_epoch !== op.owner_epoch ? "epoch_perime"
      : travail.objective_revision !== op.objective_revision ? "objectif_revise"
      : null;
    if (motif) {
      statut(db, op.operation_id, "blocked", motif, t);
      return "blocked";
    }
    statut(db, op.operation_id, "planned", `reprise:absence_prouvee:${c.preuve_ref ?? "constat"}`, t);
    return "planned";
  });
}

/** Un retrait d'autorisation annule les intentions qui n'ont pas encore commencé. */
export function retirerAutorisation(db: DatabaseSync, authorizationRef: string, maintenant: Horloge = Date.now): number {
  return ecrire(
    db,
    "UPDATE operation SET status = 'cancelled', status_motif = 'autorisation_retiree', updated_at = ? WHERE authorization_ref = ? AND status = 'planned'",
    iso(maintenant()),
    authorizationRef,
  );
}

export interface Effet {
  /** Produit l'effet (message remis, fichier écrit…) et rend sa référence. */
  appliquer(op: Operation): Promise<{ receipt_ref: string | null }>;
  /** Constate l'effet sans le refaire. */
  constater(op: Operation): Promise<{ constat: Constat; preuve_ref: string | null }>;
}

/** Démarre, produit l'effet, le constate, puis confirme ou classe l'échec. */
export async function executer(
  db: DatabaseSync,
  c: { operation_id: string; agent_id: string; effet: Effet },
  maintenant: Horloge = Date.now,
): Promise<{ ok: true; status: StatutOperation } | { ok: false; motif: string }> {
  const depart = demarrer(db, c, maintenant);
  if (!depart.ok) return depart;
  const op = lireOperation(db, c.operation_id)!;
  let recu: string | null = null;
  let erreur = "effet_en_erreur";
  try {
    recu = (await c.effet.appliquer(op)).receipt_ref;
    erreur = "effet_non_constate";
  } catch (error) {
    erreur = `effet_en_erreur:${(error as Error).message}`;
  }
  let constat: { constat: Constat; preuve_ref: string | null };
  try {
    constat = await c.effet.constater(op);
  } catch {
    constat = { constat: "inverifiable", preuve_ref: null };
  }
  if (constat.constat === "present" && constat.preuve_ref) {
    confirmer(db, { operation_id: op.operation_id, external_receipt_ref: recu, effect_check_ref: constat.preuve_ref }, maintenant);
    return { ok: true, status: "succeeded" };
  }
  const status = echouer(db, { operation_id: op.operation_id, motif: erreur, effet_absent: constat.constat === "absent" }, maintenant);
  return { ok: true, status };
}
