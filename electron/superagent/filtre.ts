import type { DatabaseSync } from "node:sqlite";
import { controlerEntree } from "./enveloppe";
import { ecrire, enTransaction, un } from "./stockage";
import { TYPES_TECHNIQUES, iso, type Enveloppe, type EntreeSource, type Horloge, type PolitiqueProjet } from "./types";

/**
 * Premier filtre, en code, avant tout modèle (point 09) : type technique listé, politique, identité,
 * périmètre de la source, type permis, taille ; puis clé canonique unique dans le journal.
 * Chaque arrivée laisse une ligne `reception` avec sa disposition et son motif.
 * Un doublon ne crée ni événement, ni lot, ni travail : rien en aval ne le voit.
 */

export type Verdict =
  | { disposition: "accepte"; enveloppe: Enveloppe }
  | { disposition: "rejete" | "quarantaine" | "ignore_technique"; motif: string };

export function filtrer(entree: EntreeSource, politique: PolitiqueProjet | null, recuA: string): Verdict {
  if ((TYPES_TECHNIQUES as readonly string[]).includes(entree.type ?? "")) {
    return { disposition: "ignore_technique", motif: `type_technique:${entree.type}` };
  }
  if (!politique) return { disposition: "rejete", motif: "politique_absente" };
  if (!politique.enabled) return { disposition: "rejete", motif: "politique_desactivee" };
  if (entree.project_id !== politique.project_id) return { disposition: "rejete", motif: "projet_hors_politique" };

  const controle = controlerEntree(entree, recuA, politique.version);
  if (!controle.ok) return { disposition: controle.disposition, motif: controle.motif };
  const e = controle.enveloppe;
  const source = politique.source_allowlist.find(
    (s) => s.source_app === e.source_app && s.source_account === e.source_account && s.source_conversation_id === e.source_conversation_id,
  );
  if (!source) return { disposition: "rejete", motif: "source_hors_perimetre" };
  if (!source.types.includes(e.type)) return { disposition: "rejete", motif: "type_non_autorise" };
  return { disposition: "accepte", enveloppe: e };
}

export type Admission =
  | { disposition: "accepte"; event_id: string; ingest_seq: number }
  | { disposition: "doublon"; event_id: string }
  | { disposition: "conflit"; event_id: string; motif: string }
  | { disposition: "rejete" | "quarantaine" | "ignore_technique"; motif: string };

interface Existant {
  event_id: string;
  payload_hash: string;
}

/**
 * Filtre puis enregistre, dans une seule transaction. Même tuple source et même empreinte : doublon,
 * l'événement canonique existant est rendu. Même tuple, empreinte différente : conflit signalé, rien
 * n'est écrasé. Une révision plus ancienne qu'une révision déjà reçue est gardée, marquée dépassée.
 */
export function admettre(db: DatabaseSync, entree: EntreeSource, politique: PolitiqueProjet | null, maintenant: Horloge = Date.now): Admission {
  return enTransaction(db, () => {
    const recuA = iso(maintenant());
    const verdict = filtrer(entree, politique, recuA);
    const tracer = (disposition: string, motif: string, eventId: string | null) =>
      ecrire(
        db,
        `INSERT INTO reception (received_at, source_app, source_account, source_conversation_id, source_message_id,
           source_revision, project_id, disposition, motif, event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        recuA,
        entree.source_app ?? null,
        entree.source_account ?? null,
        entree.source_conversation_id ?? null,
        entree.source_message_id ?? null,
        Number.isSafeInteger(entree.source_revision) ? entree.source_revision! : null,
        entree.project_id ?? null,
        disposition,
        motif,
        eventId,
      );

    if (verdict.disposition !== "accepte") {
      tracer(verdict.disposition, verdict.motif, null);
      return verdict;
    }
    const e = verdict.enveloppe;
    const tuple = [e.source_app, e.source_account, e.source_conversation_id, e.source_message_id] as const;
    const existant = un<Existant>(
      db,
      `SELECT event_id, payload_hash FROM event WHERE source_app = ? AND source_account = ? AND source_conversation_id = ?
         AND source_message_id = ? AND source_revision = ?`,
      ...tuple,
      e.source_revision,
    );
    if (existant) {
      if (existant.payload_hash === e.payload_hash) {
        tracer("doublon", "tuple_source_existant", existant.event_id);
        return { disposition: "doublon", event_id: existant.event_id };
      }
      tracer("conflit", "meme_revision_contenu_different", existant.event_id);
      return { disposition: "conflit", event_id: existant.event_id, motif: "meme_revision_contenu_different" };
    }

    // Un lien vers un travail inconnu ou d'un autre projet reste non résolu : rien ne démarre dessus.
    let motifLien: string | null = null;
    if (e.work_id && !un(db, "SELECT 1 FROM work WHERE work_id = ? AND project_id = ?", e.work_id, e.project_id)) {
      e.work_id = null;
      motifLien = "lien_travail_non_resolu";
    }
    const plusRecente = un<{ n: number }>(
      db,
      `SELECT count(*) AS n FROM event WHERE source_app = ? AND source_account = ? AND source_conversation_id = ?
         AND source_message_id = ? AND source_revision > ?`,
      ...tuple,
      e.source_revision,
    );
    const seq = (un<{ s: number | null }>(db, "SELECT max(ingest_seq) AS s FROM event")?.s ?? 0) + 1;
    // ON CONFLICT : filet du moteur si deux écrivains passaient malgré le verrou de la transaction.
    const inseres = ecrire(
      db,
      `INSERT INTO event (event_id, ingest_seq, source_app, source_account, source_conversation_id, source_message_id,
         source_revision, type, mode, occurred_at, occurred_at_motif, received_at, project_id, work_id, target_kind,
         native_chat_id, native_message_id, external_task_id, source_url, local_ref, payload_ref, payload_hash, resume,
         trust, policy_version, revision_depassee, status_motif)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      e.event_id,
      seq,
      ...tuple,
      e.source_revision,
      e.type,
      e.mode,
      e.occurred_at,
      e.occurred_at_motif,
      e.received_at,
      e.project_id,
      e.work_id,
      e.target_kind,
      e.native_chat_id,
      e.native_message_id,
      e.external_task_id,
      e.source_url,
      e.local_ref,
      e.payload_ref,
      e.payload_hash,
      e.resume,
      e.trust,
      e.policy_version,
      (plusRecente?.n ?? 0) > 0 ? 1 : 0,
      motifLien,
    );
    if (inseres !== 1) throw new Error("Insertion d'événement refusée par le journal.");
    tracer("accepte", (plusRecente?.n ?? 0) > 0 ? "revision_depassee" : "nouvel_evenement", e.event_id);
    return { disposition: "accepte", event_id: e.event_id, ingest_seq: seq };
  });
}

/** Compteurs du premier filtre par disposition et motif (motifs observables, point 09). */
export function compteursFiltre(db: DatabaseSync): Record<string, number> {
  const lignes = db.prepare("SELECT disposition, motif, count(*) AS n FROM reception GROUP BY disposition, motif").all();
  return Object.fromEntries(lignes.map((l) => [`${l.disposition}:${l.motif}`, Number(l.n)]));
}
