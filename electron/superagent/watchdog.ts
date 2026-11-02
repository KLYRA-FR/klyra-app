import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ecrire, enTransaction, tous, un } from "./stockage";
import { iso, type Horloge } from "./types";

/**
 * Surveillance des travaux Klyra (point 35, annexe W). Lecture du journal, écriture d'alertes.
 * Ne relance pas, ne ferme pas, n'écrit pas dans le fil surveillé : ce module n'a pas de port vers les fils.
 * Ce n'est pas la routine OpenBot de Tempo, qui reste inactive.
 */

const QUINZE_MIN = 15 * 60_000;
const CINQ_MIN = 5 * 60_000;
const DIX_MIN = 10 * 60_000;

export interface Alerte {
  alerte_id: string;
  work_id: string;
  type: string;
  episode_key: string;
  preuve_ref: string;
  motif: string;
  prochain_geste: string;
  opened_at: string;
  resolved_at: string | null;
}

interface Signal {
  work_id: string;
  type: string;
  preuve_ref: string;
  motif: string;
  prochain_geste: string;
}

function ouvrirEpisode(db: DatabaseSync, signal: Signal, maintenantIso: string) {
  const base = `${signal.type}:${signal.work_id}:${signal.preuve_ref}`;
  const ouvert = un<{ alerte_id: string }>(
    db,
    "SELECT alerte_id FROM alerte WHERE work_id = ? AND type = ? AND preuve_ref = ? AND resolved_at IS NULL",
    signal.work_id,
    signal.type,
    signal.preuve_ref,
  );
  if (ouvert) {
    ecrire(db, "UPDATE alerte SET updated_at = ? WHERE alerte_id = ?", maintenantIso, ouvert.alerte_id);
    return;
  }
  const rechutes = un<{ n: number }>(db, "SELECT count(*) AS n FROM alerte WHERE episode_key = ? OR episode_key LIKE ?", base, `${base}:rechute:%`)?.n ?? 0;
  const episode = rechutes === 0 ? base : `${base}:rechute:${rechutes}`;
  ecrire(
    db,
    `INSERT INTO alerte (alerte_id, work_id, type, episode_key, preuve_ref, motif, prochain_geste, opened_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    signal.work_id,
    signal.type,
    episode,
    signal.preuve_ref,
    signal.motif,
    signal.prochain_geste,
    maintenantIso,
    maintenantIso,
  );
}

function resoudreAbsents(db: DatabaseSync, typesPresents: Map<string, Set<string>>, maintenantIso: string) {
  const ouvertes = tous<{ alerte_id: string; work_id: string; type: string; preuve_ref: string }>(db, "SELECT alerte_id, work_id, type, preuve_ref FROM alerte WHERE resolved_at IS NULL");
  for (const alerte of ouvertes) {
    if (typesPresents.get(alerte.work_id)?.has(`${alerte.type}:${alerte.preuve_ref}`)) continue;
    ecrire(db, "UPDATE alerte SET resolved_at = ?, updated_at = ? WHERE alerte_id = ?", maintenantIso, maintenantIso, alerte.alerte_id);
  }
}

interface TravailLu {
  work_id: string;
  status: string;
  created_at: string;
  deadline_at: string | null;
}

/** Un passage de surveillance. L'horloge est injectable : les tests n'attendent pas 15 minutes. */
export function surveiller(db: DatabaseSync, maintenant: Horloge = Date.now): Alerte[] {
  return enTransaction(db, () => {
    const t = maintenant();
    const maintenantIso = iso(t);
    const signaux: Signal[] = [];
    const travaux = tous<TravailLu>(db, "SELECT work_id, status, created_at, deadline_at FROM work");

    for (const travail of travaux) {
      if (travail.status === "blocked") {
        signaux.push({
          work_id: travail.work_id,
          type: "W1",
          preuve_ref: `status:blocked`,
          motif: "Travail bloqué, sans résolution plus récente.",
          prochain_geste: "Lire l'état du fil et décider. Le watchdog ne relance pas.",
        });
      }

      const attend = travail.status === "waiting" || travail.status === "waiting_machine" || travail.status === "suspended";
      const clos = travail.status === "cancelled" || travail.status === "done";
      if (!attend && !clos && travail.status !== "blocked" && travail.status !== "reconciliation_required") {
        const dernier = un<{ observed_at: string; preuve_ref: string }>(
          db,
          "SELECT observed_at, preuve_ref FROM checkpoint WHERE work_id = ? ORDER BY observed_at DESC LIMIT 1",
          travail.work_id,
        );
        const reference = dernier?.observed_at ?? travail.created_at;
        const stalled = t - Date.parse(reference) > QUINZE_MIN;
        const sig = dernier ? `${dernier.preuve_ref}@${dernier.observed_at}` : "aucun";
        if (!stalled) {
          ecrire(db, "DELETE FROM observation_progres WHERE work_id = ?", travail.work_id);
        } else {
          const obs = un<{ progress_sig: string; first_seen_at: string }>(db, "SELECT progress_sig, first_seen_at FROM observation_progres WHERE work_id = ?", travail.work_id);
          if (!obs || obs.progress_sig !== sig) {
            ecrire(
              db,
              `INSERT INTO observation_progres (work_id, progress_sig, first_seen_at) VALUES (?, ?, ?)
               ON CONFLICT (work_id) DO UPDATE SET progress_sig = excluded.progress_sig, first_seen_at = excluded.first_seen_at`,
              travail.work_id,
              sig,
              maintenantIso,
            );
          } else if (t - Date.parse(obs.first_seen_at) >= QUINZE_MIN) {
            signaux.push({
              work_id: travail.work_id,
              type: "W2",
              preuve_ref: sig,
              motif: "Aucun checkpoint métier depuis plus de 15 minutes, confirmé sur deux lectures espacées de 15 minutes.",
              prochain_geste: "Vérifier le fil. Le watchdog n'écrit pas dedans et ne relance pas.",
            });
          }
        }
      }

      if (travail.status === "waiting" && !travail.deadline_at) {
        signaux.push({
          work_id: travail.work_id,
          type: "instrumentation",
          preuve_ref: "attente_sans_echeance",
          motif: "Attente sans échéance : la surveillance ne peut pas dire si elle est légitime.",
          prochain_geste: "Poser une échéance, ou sortir de l'attente.",
        });
      }

      if (travail.deadline_at && Date.parse(travail.deadline_at) < t && travail.status !== "done" && travail.status !== "cancelled") {
        signaux.push({
          work_id: travail.work_id,
          type: "W3",
          preuve_ref: `deadline:${travail.deadline_at}`,
          motif: "Échéance du travail dépassée.",
          prochain_geste: "Décider de prolonger ou d'arrêter. Le watchdog ne le fait pas.",
        });
      }

      const decisions = tous<{ decision_id: string; started_at: string }>(
        db,
        `SELECT DISTINCT d.decision_id, d.started_at FROM decision_batch d
         JOIN event e ON e.decision_id = d.decision_id
         WHERE d.status = 'deciding' AND (e.work_id = ? OR e.event_id IN (SELECT event_id FROM event_work WHERE work_id = ?))`,
        travail.work_id,
        travail.work_id,
      );
      for (const decision of decisions) {
        if (t - Date.parse(decision.started_at) > CINQ_MIN) {
          signaux.push({
            work_id: travail.work_id,
            type: "W3",
            preuve_ref: `decision:${decision.decision_id}`,
            motif: "Décision ouverte depuis plus de 5 minutes.",
            prochain_geste: "Fermer ou abandonner le lot. Le watchdog ne le fait pas.",
          });
        }
      }

      const operations = tous<{ operation_id: string; attempts: number; status: string; deadline_at: string | null; updated_at: string; effect_check_ref: string | null }>(
        db,
        "SELECT operation_id, attempts, status, deadline_at, updated_at, effect_check_ref FROM operation WHERE work_id = ?",
        travail.work_id,
      );
      for (const op of operations) {
        if ((op.status === "inflight" || op.status === "unknown") && !op.effect_check_ref && t - Date.parse(op.updated_at) > DIX_MIN) {
          signaux.push({
            work_id: travail.work_id,
            type: "W3",
            preuve_ref: `recu:${op.operation_id}`,
            motif: "Effet parti sans accusé depuis plus de 10 minutes.",
            prochain_geste: "Constate l'effet avant toute reprise. Le watchdog ne relance pas.",
          });
        }
        if (op.deadline_at && Date.parse(op.deadline_at) < t && (op.status === "planned" || op.status === "inflight")) {
          signaux.push({
            work_id: travail.work_id,
            type: "W3",
            preuve_ref: `operation:${op.operation_id}`,
            motif: "Opération au-delà de son échéance.",
            prochain_geste: "Constate l'effet avant toute reprise.",
          });
        }
        if ((op.status === "failed" || op.status === "blocked") && op.attempts >= 2) {
          signaux.push({
            work_id: travail.work_id,
            type: "W4",
            preuve_ref: `operation:${op.operation_id}`,
            motif: "Deux essais échoués pour la même opération. Pas de troisième.",
            prochain_geste: "Lire la preuve et décider. Le watchdog ne consomme pas d'essai.",
          });
        }
      }

      const erreurs = tous<{ type: string }>(
        db,
        `SELECT e.type FROM event e JOIN event_work ew ON ew.event_id = e.event_id
         WHERE ew.work_id = ? ORDER BY e.ingest_seq DESC LIMIT 3`,
        travail.work_id,
      );
      if (erreurs.length === 3 && erreurs.every((e) => e.type === "erreur")) {
        signaux.push({
          work_id: travail.work_id,
          type: "W4",
          preuve_ref: "trois_erreurs",
          motif: "Trois erreurs de suite sans checkpoint utile.",
          prochain_geste: "Lire le fil. Le watchdog ne corrige pas.",
        });
      }

      const preparations = tous<{ started_at: string; objective_revision: number }>(
        db,
        "SELECT started_at, objective_revision FROM preparation WHERE work_id = ?",
        travail.work_id,
      );
      for (const prep of preparations) {
        if (t - Date.parse(prep.started_at) > DIX_MIN) {
          signaux.push({
            work_id: travail.work_id,
            type: "W5",
            preuve_ref: `preparation:${prep.objective_revision}`,
            motif: "Préparation anticipée ouverte depuis plus de 10 minutes.",
            prochain_geste: "La laisser ou l'abandonner. Aucun appel payant n'est lancé.",
          });
        }
      }
    }

    const occupations = un<{ n: number }>(db, "SELECT count(*) AS n FROM occupation")?.n ?? 0;
    if (occupations > 3) {
      const premier = travaux[0];
      if (premier) {
        signaux.push({
          work_id: premier.work_id,
          type: "W5",
          preuve_ref: `occupations:${occupations}`,
          motif: "Plus de trois occupations dans le journal.",
          prochain_geste: "Ne pas lancer un quatrième travail.",
        });
      }
    }

    const presents = new Map<string, Set<string>>();
    for (const signal of signaux) {
      const set = presents.get(signal.work_id) ?? new Set<string>();
      set.add(`${signal.type}:${signal.preuve_ref}`);
      presents.set(signal.work_id, set);
      ouvrirEpisode(db, signal, maintenantIso);
    }
    resoudreAbsents(db, presents, maintenantIso);
    return tous<Alerte>(db, "SELECT alerte_id, work_id, type, episode_key, preuve_ref, motif, prochain_geste, opened_at, resolved_at FROM alerte WHERE resolved_at IS NULL ORDER BY opened_at");
  });
}

export function noterCheckpoint(db: DatabaseSync, workId: string, preuveRef: string, maintenant: Horloge = Date.now): void {
  ecrire(
    db,
    "INSERT INTO checkpoint (checkpoint_id, work_id, preuve_ref, observed_at) VALUES (?, ?, ?, ?)",
    randomUUID(),
    workId,
    preuveRef,
    iso(maintenant()),
  );
}
