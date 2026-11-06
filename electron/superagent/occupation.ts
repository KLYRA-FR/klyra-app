import type { DatabaseSync } from "node:sqlite";
import { ecrire, enTransaction, tous, un } from "./stockage";
import { lireTravail } from "./travaux";
import { BAIL_MS, CAPACITE_OCCUPATIONS, RefusSuperagent, iso, type Horloge } from "./types";

/**
 * Prise en charge et sémaphore (point 21). Un claim est un compare-and-set sur `owner_epoch`, dans la
 * même transaction que la réservation d'une des places (`occupation.slot` 1 à `CAPACITE_OCCUPATIONS`) et la mise à
 * jour des abonnements. Deux claims sur le même epoch : un gagnant, un refus. Bail de 10 minutes ;
 * expiré, le travail passe en `reconciliation_required` et rien ne repart avant `reconcilierTravail`.
 * Limite : le sémaphore compte les travaux de ce journal, sur ce PC.
 */

export type ResultatClaim =
  | { ok: true; owner_epoch: number; lease_until: string; slot: number }
  | {
      ok: false;
      motif:
        | "travail_inconnu"
        | "statut_incompatible"
        | "reconciliation_requise"
        | "epoch_perime"
        | "deja_detenu"
        | "deja_responsable"
        | "capacite_atteinte";
    };

function placeLibre(db: DatabaseSync): number | null {
  const prises = new Set(tous<{ slot: number }>(db, "SELECT slot FROM occupation").map((o) => o.slot));
  for (let slot = 1; slot <= CAPACITE_OCCUPATIONS; slot++) if (!prises.has(slot)) return slot;
  return null;
}

/** Bail échu d'un responsable : le travail attend la réconciliation, ses opérations en vol aussi. */
function constaterBailEchu(db: DatabaseSync, workId: string, maintenantIso: string) {
  ecrire(db, "UPDATE work SET status = 'reconciliation_required' WHERE work_id = ?", workId);
  ecrire(
    db,
    `UPDATE operation SET status = 'reconciliation_required', status_motif = 'bail_expire', updated_at = ?
     WHERE work_id = ? AND status = 'inflight'`,
    maintenantIso,
    workId,
  );
}

export function revendiquer(
  db: DatabaseSync,
  c: { work_id: string; agent_id: string; epoch_attendu: number },
  maintenant: Horloge = Date.now,
): ResultatClaim {
  return enTransaction(db, (): ResultatClaim => {
    const t = maintenant();
    const travail = lireTravail(db, c.work_id);
    if (!travail) return { ok: false, motif: "travail_inconnu" };
    if (travail.status === "reconciliation_required") return { ok: false, motif: "reconciliation_requise" };
    if (travail.status !== "active" && travail.status !== "waiting") return { ok: false, motif: "statut_incompatible" };
    if (travail.owner_epoch !== c.epoch_attendu) return { ok: false, motif: "epoch_perime" };
    if (travail.owner_agent_id && travail.lease_until) {
      if (Date.parse(travail.lease_until) <= t) {
        constaterBailEchu(db, c.work_id, iso(t));
        return { ok: false, motif: "reconciliation_requise" };
      }
      return { ok: false, motif: travail.owner_agent_id === c.agent_id ? "deja_responsable" : "deja_detenu" };
    }
    const occupee = un<{ slot: number }>(db, "SELECT slot FROM occupation WHERE work_id = ?", c.work_id);
    const slot = occupee?.slot ?? placeLibre(db);
    if (slot === null) return { ok: false, motif: "capacite_atteinte" };

    const leaseUntil = iso(t + BAIL_MS);
    const gagne = ecrire(
      db,
      `UPDATE work SET owner_agent_id = ?, owner_epoch = owner_epoch + 1, lease_until = ?, last_progress_at = ?
       WHERE work_id = ? AND owner_epoch = ? AND owner_agent_id IS NULL`,
      c.agent_id,
      leaseUntil,
      iso(t),
      c.work_id,
      c.epoch_attendu,
    );
    if (gagne !== 1) return { ok: false, motif: "epoch_perime" };
    const epoch = c.epoch_attendu + 1;
    ecrire(db, "DELETE FROM occupation WHERE work_id = ?", c.work_id);
    ecrire(
      db,
      "INSERT INTO occupation (slot, occupant_ref, work_id, agent_id, owner_epoch, acquired_at) VALUES (?, ?, ?, ?, ?, ?)",
      slot,
      `work:${c.work_id}`,
      c.work_id,
      c.agent_id,
      epoch,
      iso(t),
    );
    // Le transfert remplace l'epoch : un abonnement d'un ancien epoch ne réveille plus personne.
    ecrire(db, "UPDATE subscription SET owner_epoch = ? WHERE work_id = ? AND enabled = 1", epoch, c.work_id);
    return { ok: true, owner_epoch: epoch, lease_until: leaseUntil, slot };
  });
}

/** Renouvelle le bail du responsable courant, à faire au moins toutes les 3 minutes (`RENOUVELLEMENT_MS`). */
export function renouveler(
  db: DatabaseSync,
  c: { work_id: string; agent_id: string; owner_epoch: number },
  maintenant: Horloge = Date.now,
): { ok: true; lease_until: string } | { ok: false; motif: "pas_responsable" | "reconciliation_requise" } {
  return enTransaction(db, () => {
    const t = maintenant();
    const travail = lireTravail(db, c.work_id);
    if (!travail || travail.owner_agent_id !== c.agent_id || travail.owner_epoch !== c.owner_epoch) {
      return { ok: false, motif: "pas_responsable" } as const;
    }
    if (!travail.lease_until || Date.parse(travail.lease_until) <= t) {
      constaterBailEchu(db, c.work_id, iso(t));
      return { ok: false, motif: "reconciliation_requise" } as const;
    }
    const leaseUntil = iso(t + BAIL_MS);
    ecrire(db, "UPDATE work SET lease_until = ?, last_progress_at = ? WHERE work_id = ?", leaseUntil, iso(t), c.work_id);
    return { ok: true, lease_until: leaseUntil } as const;
  });
}

/**
 * Le responsable rend le travail (fin de son tour, transfert accepté). Refusé tant qu'une opération est
 * en vol ou à vérifier. L'epoch reste : le prochain claim l'incrémente, l'ancien ne démarre plus rien.
 */
export function liberer(db: DatabaseSync, c: { work_id: string; agent_id: string; owner_epoch: number }): void {
  enTransaction(db, () => {
    const travail = lireTravail(db, c.work_id);
    if (!travail || travail.owner_agent_id !== c.agent_id || travail.owner_epoch !== c.owner_epoch) throw new RefusSuperagent("pas_responsable");
    const enVol = un<{ n: number }>(
      db,
      "SELECT count(*) AS n FROM operation WHERE work_id = ? AND status IN ('inflight', 'unknown', 'reconciliation_required')",
      c.work_id,
    );
    if ((enVol?.n ?? 0) > 0) throw new RefusSuperagent("operations_a_verifier");
    ecrire(db, "UPDATE work SET owner_agent_id = NULL, lease_until = NULL WHERE work_id = ?", c.work_id);
    ecrire(db, "DELETE FROM occupation WHERE work_id = ?", c.work_id);
  });
}

/** Place du sémaphore pour un occupant qui n'est pas un travail (routeur, surveillance quand ils tournent). */
export function occuper(db: DatabaseSync, c: { occupant_ref: string; agent_id: string }, maintenant: Horloge = Date.now): number | null {
  return enTransaction(db, () => {
    const deja = un<{ slot: number }>(db, "SELECT slot FROM occupation WHERE occupant_ref = ?", c.occupant_ref);
    if (deja) return deja.slot;
    const slot = placeLibre(db);
    if (slot === null) return null;
    ecrire(
      db,
      "INSERT INTO occupation (slot, occupant_ref, agent_id, acquired_at) VALUES (?, ?, ?, ?)",
      slot,
      c.occupant_ref,
      c.agent_id,
      iso(maintenant()),
    );
    return slot;
  });
}

export function libererOccupant(db: DatabaseSync, occupantRef: string): void {
  ecrire(db, "DELETE FROM occupation WHERE occupant_ref = ? AND work_id IS NULL", occupantRef);
}

/** Relevé des baux échus : chaque travail concerné passe en réconciliation, son occupation reste comptée. */
export function verifierBaux(db: DatabaseSync, maintenant: Horloge = Date.now): string[] {
  return enTransaction(db, () => {
    const t = iso(maintenant());
    const echus = tous<{ work_id: string }>(
      db,
      "SELECT work_id FROM work WHERE owner_agent_id IS NOT NULL AND lease_until <= ? AND status IN ('active', 'waiting')",
      t,
    );
    for (const { work_id } of echus) constaterBailEchu(db, work_id, t);
    return echus.map((e) => e.work_id);
  });
}

/**
 * Après un bail échu : une fois chaque opération rapprochée (`reconcilier` de `operations.ts`) et
 * l'ancien responsable contrôlé (`constat_ref`), le travail redevient actif, sans responsable.
 */
export function reconcilierTravail(db: DatabaseSync, c: { work_id: string; constat_ref: string }, maintenant: Horloge = Date.now): void {
  enTransaction(db, () => {
    const travail = lireTravail(db, c.work_id);
    if (!travail || travail.status !== "reconciliation_required") throw new RefusSuperagent("pas_en_reconciliation");
    if (!c.constat_ref.trim()) throw new RefusSuperagent("constat_absent");
    const restantes = un<{ n: number }>(
      db,
      "SELECT count(*) AS n FROM operation WHERE work_id = ? AND status IN ('inflight', 'unknown', 'reconciliation_required')",
      c.work_id,
    );
    if ((restantes?.n ?? 0) > 0) throw new RefusSuperagent("operations_a_verifier");
    ecrire(
      db,
      "UPDATE work SET status = 'active', owner_agent_id = NULL, lease_until = NULL, last_progress_at = ? WHERE work_id = ?",
      iso(maintenant()),
      c.work_id,
    );
    ecrire(db, "DELETE FROM occupation WHERE work_id = ?", c.work_id);
  });
}
