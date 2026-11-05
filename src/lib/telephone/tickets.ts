import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import type { Fil } from "@/types/domain";
import type { ConversationLue } from "./chats";

/**
 * Les demandes du téléphone sur les tickets, sans React (contrat des lots 3 et 4). L'état confirmé vient
 * de la copie du compte ; une demande en cours se montre à part (règle 2).
 */

export type DemandeLue = FunctionReturnType<typeof api.ticketsCompte.mesDemandes>[number];

export interface TicketCopie {
  version: number;
  poste: string | null;
  statut: "ouvert" | "archive";
  etape: Fil["etape"] | null;
  raison: string | null;
  priorite: 0 | 1 | 2 | 3;
  echeance: string | null;
  projetNom: string | null;
  rappel: { source: "local" | "compte"; id: string } | null;
  lancePar: string | null;
  creeLe: string;
  fermeLe: string | null;
  aReponse: boolean;
  revision: number;
}

export function lireTicket(json: string | null | undefined): TicketCopie | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as Partial<TicketCopie>;
    if ((t.statut !== "ouvert" && t.statut !== "archive") || typeof t.creeLe !== "string") return null;
    return {
      version: typeof t.version === "number" ? t.version : 1,
      poste: t.poste ?? null,
      statut: t.statut,
      etape: t.etape ?? null,
      raison: t.raison ?? null,
      priorite: t.priorite === 1 || t.priorite === 2 || t.priorite === 3 ? t.priorite : 0,
      echeance: t.echeance ?? null,
      projetNom: t.projetNom ?? null,
      rappel: t.rappel ?? null,
      lancePar: t.lancePar ?? null,
      creeLe: t.creeLe,
      fermeLe: t.fermeLe ?? null,
      aReponse: t.aReponse === true,
      revision: typeof t.revision === "number" ? t.revision : 0,
    };
  } catch {
    return null;
  }
}

export interface ResultatDemande {
  code?: string;
  rappel?: "aucun" | "coche" | "inaccessible";
  fil?: string;
}

export function lireResultat(json: string | null): ResultatDemande {
  if (!json) return {};
  try {
    const r = JSON.parse(json) as ResultatDemande;
    return r && typeof r === "object" ? r : {};
  } catch {
    return {};
  }
}

/** Le texte de l'accusé : le succès réel, l'étape qui attend, ou l'erreur précise. Jamais d'erreur brute. */
export function texteResultat(demande: Pick<DemandeLue, "type" | "etat" | "resultat">, titre: string): { texte: string; erreur: boolean } | null {
  const r = lireResultat(demande.resultat);
  if (demande.etat === "confirmee") {
    switch (demande.type) {
      case "fermer":
        if (r.rappel === "coche") return { texte: `Validé et fermé : ${titre}. Le rappel d’origine est coché.`, erreur: false };
        if (r.rappel === "inaccessible") return { texte: `Validé et fermé : ${titre}. Le rappel d’origine reste à cocher : il n’a pas pu être atteint.`, erreur: true };
        return { texte: `Validé et fermé : ${titre}.`, erreur: false };
      case "supprimer":
        return { texte: `Ticket supprimé : ${titre}`, erreur: false };
      case "rouvrir":
        return { texte: `Ticket rouvert : ${titre}`, erreur: false };
      case "priorite":
        return { texte: `Priorité changée : ${titre}`, erreur: false };
      case "etape":
        return { texte: `Remis à faire : ${titre}`, erreur: false };
      default:
        return null;
    }
  }
  if (demande.etat !== "echouee") return null;
  switch (r.code) {
    case "conflit":
      return { texte: `${titre} a changé entre-temps : rien n’a été fait. Relis-le et réessaie.`, erreur: true };
    case "retrait":
      return { texte: `${titre} n’est plus sur l’ordinateur.`, erreur: true };
    case "deja-confie":
      return { texte: `${titre} est déjà confié.`, erreur: true };
    case "rappel-inaccessible":
      return { texte: `Ce rappel n’est plus sur l’ordinateur : attribution à réessayer.`, erreur: true };
    default:
      return { texte: `L’ordinateur n’a pas pu le faire : ${titre}. Tu peux réessayer.`, erreur: true };
  }
}

export type ConfieA = { roleId: string; fil: string | null; etat: "attente" | "confie" | "fait" | "a-reessayer" };

/** Le temps pour la copie d'un fil tout juste créé d'arriver dans le compte. Au-delà, un fil absent a été retiré. */
const COPIE_ATTENDUE_MS = 2 * 60 * 1000;

const copieAttendue = (d: DemandeLue, maintenant: number) => d.etat === "confirmee" && maintenant - (d.finiLe ?? 0) < COPIE_ATTENDUE_MS;

/**
 * À qui un rappel est confié, d'après la copie du compte (son fil) et les demandes : un fil ouvert d'abord,
 * puis une demande qui attend ou un échec à réessayer, puis un fil fermé. La source du téléphone (`poste`)
 * devient `local` ici, au pont.
 */
export function confieA(rappel: { source: "compte" | "poste"; id: string }, conversations: ConversationLue[] | undefined, demandes: DemandeLue[] | undefined, maintenant: number = Date.now()): ConfieA | null {
  const source = rappel.source === "poste" ? "local" : "compte";
  const dessus = (conversations ?? []).flatMap((c) => {
    const t = lireTicket(c.ticket);
    return t?.rappel?.source === source && t.rappel.id === rappel.id ? [{ c, t }] : [];
  });
  const ouvert = dessus.find(({ t }) => t.statut === "ouvert");
  if (ouvert) return { roleId: ouvert.c.roleIds[0] ?? "principal", fil: ouvert.c.origine, etat: "confie" };
  for (const d of demandes ?? []) {
    if (d.type !== "confier") continue;
    let v: { roleId?: string; rappel?: { source?: string; id?: string } };
    try {
      v = JSON.parse(d.valeur) as typeof v;
    } catch {
      continue;
    }
    if (v.rappel?.source !== source || v.rappel.id !== rappel.id || !v.roleId) continue;
    if (d.etat === "en-attente" || d.etat === "traitement") return { roleId: v.roleId, fil: null, etat: "attente" };
    if (d.etat === "echouee") return { roleId: v.roleId, fil: null, etat: "a-reessayer" };
    if (copieAttendue(d, maintenant) && !dessus.some(({ c }) => c.origine === d.conversationOrigine)) return { roleId: v.roleId, fil: d.conversationOrigine, etat: "confie" };
    break;
  }
  const ferme = dessus[0];
  return ferme ? { roleId: ferme.c.roleIds[0] ?? "principal", fil: ferme.c.origine, etat: "fait" } : null;
}
