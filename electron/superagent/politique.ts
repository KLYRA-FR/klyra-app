import type { DatabaseSync } from "node:sqlite";
import { ecrire, enTransaction, un } from "./stockage";
import { TYPES_METIER, iso, politiqueParDefaut, type Horloge, type PolitiqueProjet, type TypeMetier } from "./types";

/**
 * Politique par projet (point 11). Désactivée tant qu'aucun fil n'a été ouvert explicitement.
 * Une révision nouvelle n'efface pas les événements déjà décidés : ils gardent leur `policy_version`.
 */

export interface PolitiqueEnregistree extends PolitiqueProjet {
  autonomy: "manuelle";
  allowed_kinds: string[];
  spend_cap: number | null;
  decision_timeout_ms: number;
  operation_timeout_ms: number;
  effective_at: string;
  approval_ref: string | null;
}

const KINDS_LIVRAISON = ["livraison_klyra"];

export function politiqueVide(project_id: string, maintenant: Horloge = Date.now): PolitiqueEnregistree {
  return {
    ...politiqueParDefaut(project_id),
    autonomy: "manuelle",
    allowed_kinds: [],
    spend_cap: null,
    decision_timeout_ms: 5 * 60_000,
    operation_timeout_ms: 10 * 60_000,
    effective_at: iso(maintenant()),
    approval_ref: null,
  };
}

export function lirePolitique(db: DatabaseSync, projectId: string): PolitiqueEnregistree | null {
  const ligne = un<{ document: string }>(db, "SELECT document FROM project_policy WHERE project_id = ?", projectId);
  if (!ligne) return null;
  try {
    const lu = JSON.parse(ligne.document) as PolitiqueEnregistree;
    if (lu.project_id !== projectId || typeof lu.version !== "number" || typeof lu.enabled !== "boolean") return null;
    return lu;
  } catch {
    return null;
  }
}

export function enregistrerPolitique(db: DatabaseSync, politique: PolitiqueEnregistree): void {
  ecrire(
    db,
    `INSERT INTO project_policy (project_id, version, enabled, document, effective_at, approval_ref)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET version = excluded.version, enabled = excluded.enabled,
       document = excluded.document, effective_at = excluded.effective_at, approval_ref = excluded.approval_ref`,
    politique.project_id,
    politique.version,
    politique.enabled ? 1 : 0,
    JSON.stringify(politique),
    politique.effective_at,
    politique.approval_ref,
  );
}

/**
 * Ouvrir un fil autorise cette conversation précise, et seulement elle.
 * Le projet reste sans effet pour toute autre source.
 */
export function autoriserFil(
  db: DatabaseSync,
  c: { project_id: string; compte: string; fil_id: string; approval_ref: string },
  maintenant: Horloge = Date.now,
): PolitiqueProjet {
  return enTransaction(db, () => {
    const actuelle = lirePolitique(db, c.project_id) ?? politiqueVide(c.project_id, maintenant);
    const deja = actuelle.source_allowlist.some(
      (s) => s.source_app === "klyra" && s.source_account === c.compte && s.source_conversation_id === c.fil_id,
    );
    if (deja && actuelle.enabled) return actuelle;
    const suivante: PolitiqueEnregistree = {
      ...actuelle,
      version: actuelle.version + 1,
      enabled: true,
      allowed_kinds: KINDS_LIVRAISON,
      approval_ref: c.approval_ref,
      effective_at: iso(maintenant()),
      source_allowlist: deja
        ? actuelle.source_allowlist
        : [
            ...actuelle.source_allowlist,
            {
              source_app: "klyra",
              source_account: c.compte,
              source_conversation_id: c.fil_id,
              types: [...TYPES_METIER] as TypeMetier[],
            },
          ],
    };
    enregistrerPolitique(db, suivante);
    return suivante;
  });
}

/** Un effet externe (mail, publication, push) n'est jamais lancé par ce journal. */
export function effetExterneAutorise(kind: string, authorizationRef: string | null, allowedKinds: string[]): { ok: true } | { ok: false; motif: string } {
  if (kind === "mail_envoyer" || kind === "git_push_main" || kind === "publier" || kind === "payer" || kind === "supprimer") {
    return { ok: false, motif: "effet_externe_interdit" };
  }
  if (!authorizationRef?.trim()) return { ok: false, motif: "autorisation_absente" };
  if (!allowedKinds.includes(kind)) return { ok: false, motif: "outil_hors_droits" };
  return { ok: true };
}
