import { createHash, randomUUID } from "node:crypto";
import { RESUME_MAX_OCTETS, TYPES_METIER, type Enveloppe, type EntreeSource, type TypeMetier } from "./types";

/**
 * Enveloppe d'un événement (point 08) : identité source et révision, dates, liens et empreinte.
 * Fonctions pures : la date de réception vient de l'horloge du process principal, qui fait autorité.
 */

const CHAMPS_IDENTITE = ["source_app", "source_account", "source_conversation_id", "source_message_id"] as const;

export type ControleEnveloppe =
  | { ok: true; enveloppe: Enveloppe }
  | { ok: false; disposition: "quarantaine" | "rejete"; motif: string };

export const empreinte = (texte: string) => `sha256:${createHash("sha256").update(texte, "utf8").digest("hex")}`;

const EMPREINTE = /^sha256:[0-9a-f]{64}$/;

/** Coupe un texte à `max` octets UTF-8 sans casser un caractère ; `…` marque la coupure. */
export function tronquerOctets(texte: string, max = RESUME_MAX_OCTETS): { texte: string; tronque: boolean } {
  if (Buffer.byteLength(texte, "utf8") <= max) return { texte, tronque: false };
  const limite = max - Buffer.byteLength("…", "utf8");
  let octets = 0;
  let coupe = "";
  // Par point de code : une paire de substitution n'est jamais coupée.
  for (const caractere of texte) {
    const taille = Buffer.byteLength(caractere, "utf8");
    if (octets + taille > limite) break;
    octets += taille;
    coupe += caractere;
  }
  return { texte: `${coupe}…`, tronque: true };
}

/** Date source valide en ISO UTC, sinon null avec motif : on n'invente jamais une date source. */
function dateSource(valeur: string | null | undefined): { occurred_at: string | null; occurred_at_motif: string | null } {
  if (valeur == null || valeur === "") return { occurred_at: null, occurred_at_motif: "date_source_absente" };
  const ms = Date.parse(valeur);
  if (Number.isNaN(ms)) return { occurred_at: null, occurred_at_motif: "date_source_illisible" };
  return { occurred_at: new Date(ms).toISOString(), occurred_at_motif: null };
}

const vide = (v: unknown) => typeof v !== "string" || v.trim() === "";

/**
 * Contrôle une entrée : sans identité stable (application, compte, conversation, message), elle part
 * en quarantaine ; une clé requise absente ou invalide est refusée. Les liens non résolus restent null.
 */
export function controlerEntree(entree: EntreeSource, recuA: string, policyVersion: number): ControleEnveloppe {
  const manquants = CHAMPS_IDENTITE.filter((champ) => vide(entree[champ]));
  if (manquants.length > 0) return { ok: false, disposition: "quarantaine", motif: `identite_incomplete:${manquants.join(",")}` };
  const revision = entree.source_revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) return { ok: false, disposition: "quarantaine", motif: "revision_invalide" };

  if (vide(entree.type)) return { ok: false, disposition: "rejete", motif: "champ_requis:type" };
  if (!(TYPES_METIER as readonly string[]).includes(entree.type!)) return { ok: false, disposition: "rejete", motif: "type_inconnu" };
  if (vide(entree.project_id)) return { ok: false, disposition: "rejete", motif: "champ_requis:project_id" };
  if (vide(entree.source_url) && vide(entree.local_ref)) return { ok: false, disposition: "rejete", motif: "champ_requis:reference" };

  const resume = entree.resume ?? (entree.payload !== undefined ? tronquerOctets(entree.payload).texte : undefined);
  if (resume === undefined) return { ok: false, disposition: "rejete", motif: "champ_requis:resume" };
  if (Buffer.byteLength(resume, "utf8") > RESUME_MAX_OCTETS) return { ok: false, disposition: "rejete", motif: "resume_trop_long" };
  // Un contenu plus long que le résumé reste à sa source : on garde sa référence, pas le texte.
  const tronque = entree.payload !== undefined && resume !== entree.payload;
  if (tronque && vide(entree.payload_ref)) return { ok: false, disposition: "rejete", motif: "payload_non_reference" };

  let payloadHash: string;
  if (entree.payload !== undefined) payloadHash = empreinte(entree.payload);
  else if (entree.payload_hash && EMPREINTE.test(entree.payload_hash)) payloadHash = entree.payload_hash;
  else return { ok: false, disposition: "rejete", motif: "champ_requis:payload_hash" };

  const cible = entree.cible ?? null;
  return {
    ok: true,
    enveloppe: {
      event_id: randomUUID(),
      source_app: entree.source_app!.trim(),
      source_account: entree.source_account!.trim(),
      source_conversation_id: entree.source_conversation_id!.trim(),
      source_message_id: entree.source_message_id!.trim(),
      source_revision: revision,
      type: entree.type as TypeMetier,
      mode: entree.mode ?? "fixture",
      ...dateSource(entree.occurred_at),
      received_at: recuA,
      project_id: entree.project_id!,
      work_id: entree.work_id ?? null,
      target_kind: cible?.target_kind ?? null,
      native_chat_id: cible?.target_kind === "klyra" ? cible.native_chat_id : null,
      native_message_id: cible?.target_kind === "klyra" ? cible.native_message_id : null,
      external_task_id: cible?.target_kind === "openbot" ? cible.external_task_id : null,
      source_url: vide(entree.source_url) ? null : entree.source_url!,
      local_ref: vide(entree.local_ref) ? null : entree.local_ref!,
      payload_ref: vide(entree.payload_ref) ? null : entree.payload_ref!,
      payload_hash: payloadHash,
      resume,
      trust: "external_data",
      policy_version: policyVersion,
    },
  };
}
