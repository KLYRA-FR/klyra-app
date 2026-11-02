import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ingererMessageFil, marquerTravailFil, ouvrirTravailFil, placesLibres, preparer, projection, preuvesTravail, travailDuFil, type ContexteCycle } from "./cycle";
import { chercher } from "./recherche";
import { ouvrirStockage } from "./stockage";
import { surveiller } from "./watchdog";
import type { MessageNatif } from "./ingestion";
import { lireTravail } from "./travaux";

/**
 * Journal du process principal. Le renderer envoie des faits de fil (id, message, statut).
 * Rien n'est écrit dans le fil depuis ici : la livraison constate un message déjà posé par l'outil.
 * Aucune conversation, clé ou routine n'est envoyée à Convex.
 */

let journal: DatabaseSync | null = null;

export function ouvrirJournal(dossier: string): DatabaseSync {
  if (!journal) journal = ouvrirStockage(path.join(dossier, "superagent.sqlite"));
  return journal;
}

export function journalOuvert(): DatabaseSync | null {
  return journal;
}

const texte = (valeur: unknown, max = 8_000) => (typeof valeur === "string" ? valeur.slice(0, max) : "");

function messageDe(brut: Record<string, unknown>, filId: string): MessageNatif {
  const auteur = brut.auteur === "role" ? { kind: "role" as const, roleId: texte(brut.roleId, 80) || "principal" } : { kind: "user" as const };
  return {
    id: texte(brut.messageId, 80),
    chatId: filId,
    author: auteur,
    createdAt: texte(brut.createdAt, 40) || new Date().toISOString(),
    parts: [{ type: "text", text: texte(brut.texte) }],
    statut: brut.ok === false ? "erreur" : "fait",
    erreur: brut.ok === false ? texte(brut.erreur, 500) : undefined,
  };
}

/** Effet déjà produit par l'outil du fil : on confirme sans réécrire. */
function transportDejaPresent(filId: string, messageId: string) {
  const preuve = `fil:${filId}#${messageId}`;
  return {
    async appliquer() {
      return { receipt_ref: preuve };
    },
    async constater() {
      return { constat: "present" as const, preuve_ref: preuve };
    },
  };
}

function contexte(brut: Record<string, unknown>, filId: string): ContexteCycle {
  return {
    compte: texte(brut.compte, 120) || "local",
    project_id: texte(brut.projectId, 120) || "hors-projet",
    state_ref: texte(brut.stateRef, 300) || `local:fil/${filId}`,
    authorization_ref: `outil-fil:${filId}`,
  };
}

export async function noterOuverture(brut: unknown) {
  if (!journal) throw new Error("Journal indisponible.");
  const ligne = (brut ?? {}) as Record<string, unknown>;
  const filId = texte(ligne.filId, 80);
  const roleId = texte(ligne.roleId, 80);
  const messageId = texte(ligne.messageId, 80);
  if (!filId || !roleId || !messageId) throw new Error("Fil incomplet.");
  const ctx = contexte(ligne, filId);
  const ouvert = ouvrirTravailFil(journal, {
    ...ctx,
    fil_id: filId,
    role_id: roleId,
    titre: texte(ligne.titre, 80) || "Fil",
    priority: typeof ligne.priorite === "number" ? ligne.priorite : 0,
    deadline_at: typeof ligne.echeance === "string" ? ligne.echeance : null,
  });
  if (!ouvert.ok) return ouvert;
  const issue = await ingererMessageFil(journal, {
    ...ctx,
    fil_id: filId,
    typeMessage: "demande",
    message: messageDe({ ...ligne, messageId, texte: ligne.brief, auteur: "user" }, filId),
    transport: transportDejaPresent(filId, messageId),
  });
  return { ...ouvert, event_id: issue.event_id, disposition: issue.disposition };
}

export async function noterMessage(brut: unknown) {
  if (!journal) throw new Error("Journal indisponible.");
  const ligne = (brut ?? {}) as Record<string, unknown>;
  const filId = texte(ligne.filId, 80);
  const messageId = texte(ligne.messageId, 80);
  if (!filId || !messageId) throw new Error("Message incomplet.");
  if (!travailDuFil(journal, filId)) return { ok: false as const, motif: "sans_journal" };
  const issue = await ingererMessageFil(journal, {
    ...contexte(ligne, filId),
    fil_id: filId,
    message: messageDe(ligne, filId),
    transport: transportDejaPresent(filId, messageId),
  });
  return { ok: true as const, ...issue };
}

export function peutOuvrir(): { ok: boolean; places: number } {
  if (!journal) return { ok: true, places: 3 };
  const places = placesLibres(journal);
  return { ok: places > 0, places };
}

export function etatFil(filId: string): { status: string; work_id: string } | null {
  if (!journal) return null;
  const workId = travailDuFil(journal, filId);
  if (!workId) return null;
  const travail = lireTravail(journal, workId);
  return travail ? { status: travail.status, work_id: workId } : null;
}

export function marquerFil(filId: string, status: "active" | "suspended" | "blocked" | "done" | "cancelled" | "waiting", controleRef: string | null) {
  if (!journal) return { ok: true as const };
  return marquerTravailFil(journal, { fil_id: filId, status, controle_ref: controleRef });
}

export function lireProjection(projectId: string | null) {
  if (!journal) return { travaux: [], alertes: [], blocages: [], couverture: "journal_illisible" as const };
  return projection(journal, projectId);
}

export function lirePreuves(workId: string) {
  if (!journal) return null;
  return preuvesTravail(journal, workId);
}

export function chercherTravaux(requete: string, compte: string, projectId: string | null) {
  if (!journal) return { resultats: [], non_recherche: ["Journal indisponible."] };
  return chercher(journal, {
    requete,
    comptes_autorises: [compte || "local"],
    projets_autorises: projectId ? [projectId] : undefined,
  });
}

export function preparerFil(filId: string) {
  if (!journal) return { ok: false as const, motif: "journal_indisponible" };
  return preparer(journal, filId);
}

export function passageWatchdog() {
  if (!journal) return [];
  return surveiller(journal);
}
