import type { DatabaseSync } from "node:sqlite";
import { ecrire, un } from "./stockage";
import { lireTravail } from "./travaux";
import { ESSAIS_MAX, type Disposition } from "./types";

/**
 * Second filtre (point 10), sans appel de modèle : les messages des fils sont classés en code.
 * Une sortie de modèle, si on en fournit une, est validée ici et n'appelle aucun outil.
 * Sortie invalide : attendre, deux essais au plus, puis blocage de cet essai. Aucun fournisseur.
 */

export interface Classement {
  disposition: Disposition;
  motif: string;
  work_id: string | null;
  owner_epoch_attendu?: number;
  /** Toujours vide sur le chemin des fils : le routeur écrit l'intention, le modèle n'a pas d'outil. */
  proposed_operations: { kind: string }[];
}

const INJECTION =
  /\b(secrets?|jetons?|cl[eé]s?\s+d['’]api|api[_ -]?keys?|publie[rz]?\b|mets?\s+en\s+ligne|push\s+main|envoie[rz]?\s+(?:un\s+|le\s+)?mails?|ignore[rz]?\s+(?:les\s+)?(?:consignes|instructions)|ignore\s+previous)\b/i;

interface EvenementLu {
  event_id: string;
  type: string;
  resume: string;
  work_id: string | null;
  revision_depassee: number;
  project_id: string;
}

/** Classe un événement déjà admis. Aucune écriture. */
export function classerEvenement(db: DatabaseSync, eventId: string): Classement {
  const evenement = un<EvenementLu>(db, "SELECT event_id, type, resume, work_id, revision_depassee, project_id FROM event WHERE event_id = ?", eventId);
  if (!evenement) return { disposition: "attendre", motif: "evenement_inconnu", work_id: null, proposed_operations: [] };
  const travail = evenement.work_id ? lireTravail(db, evenement.work_id) : undefined;
  const base = { work_id: travail?.work_id ?? null, owner_epoch_attendu: travail?.owner_epoch, proposed_operations: [] as { kind: string }[] };

  if (INJECTION.test(evenement.resume)) {
    return { ...base, disposition: "ne_rien_faire", motif: "injection_externe" };
  }
  if (evenement.revision_depassee === 1) {
    return { ...base, disposition: "ne_rien_faire", motif: "revision_depassee" };
  }
  if (evenement.type === "commentaire_pr") {
    return { ...base, disposition: "ne_rien_faire", motif: "ingestion_commentaire_inactive" };
  }
  if (evenement.type === "erreur") return { ...base, disposition: "attendre", motif: "erreur_metier" };
  if (evenement.type === "resultat" || evenement.type === "fin_verification") {
    return { ...base, disposition: "repondre", motif: evenement.type };
  }
  if (!travail) return { ...base, disposition: "ne_rien_faire", motif: "travail_non_resolu" };
  if (travail.status !== "active") return { ...base, disposition: "attendre", motif: `travail_${travail.status}` };
  if (evenement.type === "demande" || evenement.type === "precision" || evenement.type === "changement_objectif" || evenement.type === "priorite") {
    return { ...base, disposition: "agir", motif: evenement.type };
  }
  return { ...base, disposition: "ne_rien_faire", motif: "type_sans_effet" };
}

export interface SortieModele {
  disposition: Disposition;
  reason: string;
  work_id?: string | null;
  expected_revision: number;
  evidence_refs: string[];
  proposed_operations: { kind: string }[];
}

/**
 * Valide une sortie JSON. Invalide, injection ou outil hors droits : pas d'opération.
 * `expected_revision` doit être celle du travail lu avant l'appel.
 */
export function validerSortieModele(
  brut: unknown,
  attendu: { objective_revision: number; allowed_kinds: string[] },
): { ok: true; sortie: SortieModele } | { ok: false; motif: string } {
  if (!brut || typeof brut !== "object") return { ok: false, motif: "sortie_invalide" };
  const ligne = brut as Record<string, unknown>;
  const disposition = ligne.disposition;
  if (disposition !== "agir" && disposition !== "repondre" && disposition !== "attendre" && disposition !== "ne_rien_faire") {
    return { ok: false, motif: "sortie_invalide" };
  }
  if (typeof ligne.reason !== "string" || !ligne.reason.trim()) return { ok: false, motif: "sortie_invalide" };
  if (ligne.expected_revision !== attendu.objective_revision) return { ok: false, motif: "revision_perimee" };
  if (!Array.isArray(ligne.evidence_refs) || !Array.isArray(ligne.proposed_operations)) return { ok: false, motif: "sortie_invalide" };
  if (INJECTION.test(ligne.reason)) return { ok: false, motif: "injection_externe" };
  const operations: { kind: string }[] = [];
  for (const op of ligne.proposed_operations) {
    if (!op || typeof op !== "object" || typeof (op as { kind?: unknown }).kind !== "string") return { ok: false, motif: "sortie_invalide" };
    const kind = (op as { kind: string }).kind;
    if (!attendu.allowed_kinds.includes(kind)) return { ok: false, motif: "outil_hors_droits" };
    operations.push({ kind });
  }
  return {
    ok: true,
    sortie: {
      disposition,
      reason: ligne.reason,
      work_id: typeof ligne.work_id === "string" ? ligne.work_id : null,
      expected_revision: ligne.expected_revision,
      evidence_refs: ligne.evidence_refs.filter((r): r is string => typeof r === "string"),
      proposed_operations: operations,
    },
  };
}

/** Compte un essai de sortie invalide. Au second, l'essai est épuisé : on n'en lance pas un troisième. */
export function noterSortieInvalide(db: DatabaseSync, decisionKey: string): { attempts: number; epuise: boolean } {
  const ligne = un<{ attempts: number }>(db, "SELECT attempts FROM essai_modele WHERE decision_key = ?", decisionKey);
  const attempts = Math.min(ESSAIS_MAX, (ligne?.attempts ?? 0) + 1);
  if (ligne) ecrire(db, "UPDATE essai_modele SET attempts = ? WHERE decision_key = ?", attempts, decisionKey);
  else ecrire(db, "INSERT INTO essai_modele (decision_key, attempts) VALUES (?, ?)", decisionKey, attempts);
  return { attempts, epuise: attempts >= ESSAIS_MAX };
}
