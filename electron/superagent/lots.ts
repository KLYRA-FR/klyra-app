import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { router } from "./livraison";
import { ecrire, enTransaction, tous, un } from "./stockage";
import { DELAI_DECISION_MS, LOT_MAX_EVENEMENTS, LOT_MAX_OCTETS, RefusSuperagent, iso, type Disposition, type Horloge } from "./types";

/**
 * Lots de décision (point 12). Ouvrir un lot fige des événements en attente, dans l'ordre de
 * réception (`ingest_seq`, jamais `occurred_at`), 50 au plus et 32 Ko de résumés au plus. Une seule
 * décision en cours par routeur (index unique partiel) : ce qui arrive pendant le lot N reste en
 * attente pour N+1. Fermer le lot écrit d'un bloc la décision, les liens et les intentions de
 * livraison ; une erreur n'en écrit aucun. La file du renderer ne fait pas autorité.
 */

export interface EvenementLot {
  event_id: string;
  ingest_seq: number;
  type: string;
  resume: string;
  work_id: string | null;
  revision_depassee: number;
  received_at: string;
  occurred_at: string | null;
  source_app: string;
  source_conversation_id: string;
  source_message_id: string;
  source_revision: number;
}

export type Ouverture =
  | { etat: "ouvert"; decision_id: string; seq_start: number; seq_end: number; evenements: EvenementLot[] }
  | { etat: "occupe"; decision_id: string }
  | { etat: "vide" };

export function ouvrirLot(
  db: DatabaseSync,
  o: { router_id: string; project_id: string; policy_version: number },
  maintenant: Horloge = Date.now,
): Ouverture {
  return enTransaction(db, (): Ouverture => {
    const enCours = un<{ decision_id: string }>(db, "SELECT decision_id FROM decision_batch WHERE router_id = ? AND status = 'deciding'", o.router_id);
    if (enCours) return { etat: "occupe", decision_id: enCours.decision_id };
    const candidats = tous<EvenementLot>(
      db,
      `SELECT event_id, ingest_seq, type, resume, work_id, revision_depassee, received_at, occurred_at, source_app,
         source_conversation_id, source_message_id, source_revision
       FROM event WHERE project_id = ? AND status = 'pending' ORDER BY ingest_seq LIMIT ?`,
      o.project_id,
      LOT_MAX_EVENEMENTS,
    );
    const lot: EvenementLot[] = [];
    let octets = 0;
    for (const e of candidats) {
      const taille = Buffer.byteLength(e.resume, "utf8");
      if (octets + taille > LOT_MAX_OCTETS) break; // Le surplus attend le lot suivant.
      octets += taille;
      lot.push(e);
    }
    if (lot.length === 0) return { etat: "vide" };
    const t = maintenant();
    const decisionId = randomUUID();
    const seqStart = lot[0].ingest_seq;
    const seqEnd = lot[lot.length - 1].ingest_seq;
    ecrire(
      db,
      `INSERT INTO decision_batch (decision_id, router_id, project_id, seq_start, seq_end, policy_version, status, started_at, deadline_at)
       VALUES (?, ?, ?, ?, ?, ?, 'deciding', ?, ?)`,
      decisionId,
      o.router_id,
      o.project_id,
      seqStart,
      seqEnd,
      o.policy_version,
      iso(t),
      iso(t + DELAI_DECISION_MS),
    );
    for (const e of lot) {
      ecrire(db, "UPDATE event SET status = 'deciding', decision_id = ? WHERE event_id = ? AND status = 'pending'", decisionId, e.event_id);
    }
    return { etat: "ouvert", decision_id: decisionId, seq_start: seqStart, seq_end: seqEnd, evenements: lot };
  });
}

export interface DecisionEvenement {
  event_id: string;
  disposition: Disposition;
  /** Travail visé ; plusieurs décisions pour un même événement = plusieurs liens, une seule copie. */
  work_id?: string | null;
  /** Epoch du responsable lu par le routeur : un transfert entre-temps fait échouer la fermeture entière. */
  owner_epoch_attendu?: number;
  motif?: string;
}

/**
 * Ferme le lot : écrit chaque disposition et ses intentions, puis le lot décidé. Un événement du lot
 * sans décision repart en attente pour le lot suivant (aucune perte). Tout ou rien.
 */
export function fermerLot(
  db: DatabaseSync,
  f: { decision_id: string; decisions: DecisionEvenement[]; authorization_ref: string; output_ref?: string | null },
  maintenant: Horloge = Date.now,
): { operations: string[]; remis_en_attente: string[] } {
  return enTransaction(db, () => {
    const lot = un<{ status: string }>(db, "SELECT status FROM decision_batch WHERE decision_id = ?", f.decision_id);
    if (!lot || lot.status !== "deciding") throw new RefusSuperagent("lot_non_ouvert");
    const membres = new Set(
      tous<{ event_id: string }>(db, "SELECT event_id FROM event WHERE decision_id = ? AND status = 'deciding'", f.decision_id).map((e) => e.event_id),
    );
    const parEvenement = new Map<string, DecisionEvenement[]>();
    for (const d of f.decisions) {
      if (!membres.has(d.event_id)) throw new RefusSuperagent("evenement_hors_lot");
      if ((d.disposition === "agir" || d.disposition === "repondre") && !d.work_id) throw new RefusSuperagent("travail_requis");
      parEvenement.set(d.event_id, [...(parEvenement.get(d.event_id) ?? []), d]);
    }

    const operations: string[] = [];
    for (const [eventId, decisions] of parEvenement) {
      for (const d of decisions) {
        if (!d.work_id) continue;
        const operation = router(
          db,
          {
            event_id: eventId,
            work_id: d.work_id,
            decision_id: f.decision_id,
            disposition: d.disposition,
            owner_epoch_attendu: d.owner_epoch_attendu,
            authorization_ref: f.authorization_ref,
          },
          maintenant,
        );
        if (operation) operations.push(operation);
      }
      const dispositions = decisions.map((d) => d.disposition);
      const statut =
        dispositions.some((d) => d === "agir" || d === "repondre") ? "routed"
        : dispositions.includes("attendre") ? "waiting"
        : "ignored";
      const motif = decisions.map((d) => d.motif).filter(Boolean).join(" ; ") || null;
      ecrire(db, "UPDATE event SET status = ?, status_motif = coalesce(?, status_motif) WHERE event_id = ?", statut, motif, eventId);
    }

    const remis = [...membres].filter((id) => !parEvenement.has(id));
    for (const id of remis) ecrire(db, "UPDATE event SET status = 'pending', decision_id = NULL WHERE event_id = ?", id);
    ecrire(db, "UPDATE decision_batch SET status = 'decided', output_ref = ? WHERE decision_id = ?", f.output_ref ?? null, f.decision_id);
    return { operations, remis_en_attente: remis };
  });
}

/** Décision impossible (modèle indisponible, délai dépassé) : le lot est abandonné, ses événements reviennent en attente. */
export function abandonnerLot(db: DatabaseSync, decisionId: string, motif: string): void {
  enTransaction(db, () => {
    const changes = ecrire(
      db,
      "UPDATE decision_batch SET status = 'abandoned', status_motif = ? WHERE decision_id = ? AND status = 'deciding'",
      motif,
      decisionId,
    );
    if (changes !== 1) throw new RefusSuperagent("lot_non_ouvert");
    ecrire(db, "UPDATE event SET status = 'pending', decision_id = NULL WHERE decision_id = ? AND status = 'deciding'", decisionId);
  });
}
