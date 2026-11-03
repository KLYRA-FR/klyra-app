import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ecrire, tous, un } from "./stockage";
import { iso, type Horloge } from "./types";

/**
 * Mesures (point 41, annexe M du contrat), calculées depuis le journal : réceptions, événements
 * canoniques, opérations, reçus et mesures enregistrées avec leur preuve. Une donnée absente reste
 * null avec son motif : jamais 0, jamais une estimation. Aucun contenu de conversation, aucun appel
 * payant. Le premier passage reste le PASSAGES de Cicco, pas une table d'ici.
 */

export interface Valeur {
  valeur: number | null;
  motif: string | null;
}

export interface MesuresTravail {
  work_id: string;
  ingestions: number;
  evenements_canoniques: number;
  doublons: number;
  operations_demarrees: number;
  reprises: number;
  ratio_reprises: Valeur;
  delai_prise_en_compte_ms: { n: number; mediane: Valeur; p95: Valeur };
  cout: { par_unite: { unite: string; total: number; preuves: string[] }[]; motif: string | null };
  effets_repetes: Valeur;
}

function centile(triees: number[], p: number): number {
  const rang = Math.ceil((p / 100) * triees.length) - 1;
  return triees[Math.min(Math.max(rang, 0), triees.length - 1)];
}

export function mesurer(db: DatabaseSync, workId: string): MesuresTravail {
  const evenements = `SELECT event_id FROM event WHERE work_id = ? UNION SELECT event_id FROM event_work WHERE work_id = ?`;
  const canoniques = un<{ n: number }>(db, `SELECT count(*) AS n FROM (${evenements})`, workId, workId)!.n;
  const ingestions = un<{ n: number }>(
    db,
    `SELECT count(*) AS n FROM reception WHERE disposition IN ('accepte', 'doublon') AND event_id IN (${evenements})`,
    workId,
    workId,
  )!.n;
  const ops = un<{ demarrees: number; reprises: number }>(
    db,
    "SELECT coalesce(sum(attempts >= 1), 0) AS demarrees, coalesce(sum(attempts = 2), 0) AS reprises FROM operation WHERE work_id = ?",
    workId,
  )!;
  const delais = tous<{ acked_at: string; received_at: string }>(
    db,
    "SELECT r.acked_at, e.received_at FROM receipt r JOIN event e ON e.event_id = r.event_id WHERE r.work_id = ?",
    workId,
  )
    .map((d) => Date.parse(d.acked_at) - Date.parse(d.received_at))
    .sort((a, b) => a - b);
  const couts = tous<{ unit: string; total: number; preuves: string }>(
    db,
    `SELECT unit, sum(value) AS total, group_concat(evidence_ref, ' ') AS preuves FROM metric
     WHERE work_id = ? AND type = 'cout' AND value IS NOT NULL GROUP BY unit ORDER BY unit`,
    workId,
  );
  return {
    work_id: workId,
    ingestions,
    evenements_canoniques: canoniques,
    doublons: ingestions - canoniques,
    operations_demarrees: ops.demarrees,
    reprises: ops.reprises,
    ratio_reprises:
      ops.demarrees > 0 ? { valeur: ops.reprises / ops.demarrees, motif: null } : { valeur: null, motif: "aucune_operation_demarree" },
    delai_prise_en_compte_ms: {
      n: delais.length,
      mediane: delais.length > 0 ? { valeur: centile(delais, 50), motif: null } : { valeur: null, motif: "aucun_accuse" },
      p95: delais.length >= 20 ? { valeur: centile(delais, 95), motif: null } : { valeur: null, motif: `effectif_insuffisant:n=${delais.length}` },
    },
    cout: {
      par_unite: couts.map((c) => ({ unite: c.unit, total: c.total, preuves: c.preuves.split(" ") })),
      motif: couts.length === 0 ? "aucun_cout_attribuable_recu" : null,
    },
    // Un effet externe n'est compté que par son contrôle : un doublon d'effet hors journal n'est pas observable ici.
    effets_repetes: { valeur: null, motif: "non_instrumente:effet_externe_controle_par_effect_check_ref" },
  };
}

/** Compteurs du journal hors travail : arrivées par disposition (y compris rejets et quarantaines). */
export function compteursReception(db: DatabaseSync): Record<string, number> {
  return Object.fromEntries(
    tous<{ disposition: string; n: number }>(db, "SELECT disposition, count(*) AS n FROM reception GROUP BY disposition ORDER BY disposition").map(
      (l) => [l.disposition, l.n],
    ),
  );
}

/** Enregistre une mesure observée : une valeur a sa preuve, une valeur absente a son motif (le moteur le vérifie). */
export function enregistrerMesure(
  db: DatabaseSync,
  m: { work_id: string; event_id?: string | null; type: string; value: number | null; unit: string; evidence_ref: string | null; motif: string | null },
  maintenant: Horloge = Date.now,
): string {
  const metricId = randomUUID();
  ecrire(
    db,
    "INSERT INTO metric (metric_id, work_id, event_id, type, value, unit, observed_at, evidence_ref, motif) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    metricId,
    m.work_id,
    m.event_id ?? null,
    m.type,
    m.value,
    m.unit,
    iso(maintenant()),
    m.evidence_ref,
    m.motif,
  );
  return metricId;
}
