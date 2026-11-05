import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { tableauTickets, FILTRES_PAR_DEFAUT, etapeDeReprise, type ColonneTicket } from "@/lib/tickets";
import type { Chat, Fil } from "@/types/domain";
import { activiteDe, tachesDe, type ConversationLue } from "./chats";

/**
 * Tickets sur le téléphone (lot 4), sans React. Un ticket reste un fil : les étapes, le tri et les
 * terminés sont ceux du bureau (`tableauTickets`), lus sur la copie du compte. L'état confirmé vient de
 * cette copie ; une demande en cours se montre à part (contrat des lots 3 et 4, règle 2).
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

export interface LigneTicket {
  conversation: ConversationLue;
  ticket: TicketCopie;
  colonne: ColonneTicket;
  roleId: string;
}

/** L'ordre des sections sur le téléphone : la prochaine décision d'abord. */
export const COLONNES_TELEPHONE: ColonneTicket[] = ["a-valider", "bloque", "en-cours", "a-faire", "termine"];

export const NOMS_COLONNES: Record<ColonneTicket, string> = {
  "a-valider": "À valider",
  bloque: "Bloqué",
  "en-cours": "En cours",
  "a-faire": "À faire",
  termine: "Terminé",
};

/** Un travail se dit en cours sur un signe frais de l'ordinateur ; sinon l'étape confirmée reste telle quelle (E4-16). */
const travaille = (c: ConversationLue, posteOuvert: boolean) => {
  const a = activiteDe(c);
  return posteOuvert && !!a && a.etat !== "question";
};

/** Le tableau du bureau, sur la copie du compte. */
export function tableauTelephone(
  conversations: ConversationLue[],
  { posteOuvert, maintenant, tousTermines = false }: { posteOuvert: boolean; maintenant: Date; tousTermines?: boolean },
): { colonnes: Record<ColonneTicket, LigneTicket[]>; termines: number } {
  const parId = new Map<string, { conversation: ConversationLue; ticket: TicketCopie }>();
  const chats: Chat[] = [];
  for (const c of conversations) {
    const ticket = lireTicket(c.ticket);
    if (!ticket) continue;
    parId.set(c.origine, { conversation: c, ticket });
    chats.push({
      id: c.origine,
      updatedAt: ticket.fermeLe ?? c.misAJour,
      fil: {
        roleId: c.roleIds[0] ?? "principal",
        statut: ticket.statut,
        creeLe: ticket.creeLe,
        /* Une copie sans étape (fil d'avant les tickets) : la même reprise qu'au bureau. */
        etape: ticket.etape ?? etapeDeReprise(ticket.aReponse),
        priorite: ticket.priorite,
        echeance: ticket.echeance,
        fermeLe: ticket.fermeLe,
      },
    } as unknown as Chat);
  }
  const estEnTravail = (id: string) => {
    const lu = parId.get(id);
    return !!lu && travaille(lu.conversation, posteOuvert);
  };
  const { colonnes, termines } = tableauTickets(chats, estEnTravail, FILTRES_PAR_DEFAUT, maintenant, tousTermines);
  const sortie = Object.fromEntries(
    COLONNES_TELEPHONE.map((col) => [
      col,
      colonnes[col].map((chat): LigneTicket => {
        const lu = parId.get(chat.id)!;
        return { conversation: lu.conversation, ticket: lu.ticket, colonne: col, roleId: chat.fil.roleId };
      }),
    ]),
  ) as Record<ColonneTicket, LigneTicket[]>;
  return { colonnes: sortie, termines };
}

/** Ce que l'écran peut conclure (contrat, règle 6) : un vrai vide demande un poste qui connaît le contrat. */
export function disponibilite(conversations: ConversationLue[] | undefined): "chargement" | "compatible" | "ancien" | "rien" {
  if (conversations === undefined) return "chargement";
  if (conversations.length === 0) return "rien";
  return conversations.some((c) => (c.contratTickets ?? 0) >= 1) ? "compatible" : "ancien";
}

/** Les tickets confirmés à valider : le compte de Plus et son point. Inconnu si le contrat manque : rien, pas zéro. */
export function nombreAValider(conversations: ConversationLue[] | undefined, posteOuvert: boolean): number | null {
  if (disponibilite(conversations) !== "compatible") return null;
  return tableauTelephone(conversations ?? [], { posteOuvert, maintenant: new Date() }).colonnes["a-valider"].length;
}

/** La demande en cours sur ce fil, la plus récente : ni confirmée ni échouée. */
export function demandeEnCours(demandes: DemandeLue[] | undefined, origine: string): DemandeLue | null {
  return (demandes ?? []).find((d) => d.conversationOrigine === origine && (d.etat === "en-attente" || d.etat === "traitement")) ?? null;
}

const VERBES: Record<DemandeLue["type"], string> = {
  fermer: "Fermeture demandée",
  supprimer: "Suppression demandée",
  rouvrir: "Réouverture demandée",
  priorite: "Priorité demandée",
  etape: "Retour à faire demandé",
  confier: "Attribution demandée",
};

/** « Fermeture demandée · attend ton Mac » : jamais présenté comme fait (E4-16). */
export function texteAttente(demande: DemandeLue, sur: string, posteOuvert: boolean): string {
  return posteOuvert ? `${VERBES[demande.type]}…` : `${VERBES[demande.type]} · attend ${sur}`;
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

/** La progression d'un ticket : ses tâches faites sur le total, si elle est connue. */
export function progression(c: ConversationLue): { faites: number; total: number } | null {
  const taches = tachesDe(c);
  return taches.length ? { faites: taches.filter((t) => t.statut === "fait").length, total: taches.length } : null;
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

/** « 13:08 », « hier, 17:20 », « 4 nov., 18:42 » : un moment passé, l'heure toujours écrite. */
export function libelleMoment(date: string | number, maintenant: Date = new Date()): string {
  const d = new Date(date);
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86_400_000);
  if (ecart <= 0) return heure;
  if (ecart === 1) return `hier, ${heure}`;
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${heure}`;
}

/** Au-delà, la dernière réponse s'annonce coupée et mène au fil : un extrait ne passe pas pour le résultat entier (E4-05). */
const EXTRAIT_MAX = 600;

export function extraitBorne(texte: string): { texte: string; coupe: boolean } {
  const propre = texte.replace(/[*`#>_]/g, "").trim();
  return propre.length <= EXTRAIT_MAX ? { texte: propre, coupe: false } : { texte: `${propre.slice(0, EXTRAIT_MAX).trimEnd()}…`, coupe: true };
}

/** La dernière demande finie sur ce fil, si elle dit une erreur : le détail la montre et l'action reste à reprendre. */
export function derniereErreur(demandes: DemandeLue[] | undefined, origine: string, titre: string): string | null {
  const derniere = (demandes ?? []).find((d) => d.conversationOrigine === origine);
  if (!derniere) return null;
  const resultat = texteResultat(derniere, titre);
  return resultat?.erreur ? resultat.texte : null;
}

/** Une demande Confier sur ce fil attend, ou vient d'être confirmée : sa copie arrive, ce n'est pas un ticket perdu. */
export function ticketAttendu(demandes: DemandeLue[] | undefined, origine: string, maintenant: number = Date.now()): boolean {
  return (demandes ?? []).some((d) => d.type === "confier" && d.conversationOrigine === origine && (d.etat === "en-attente" || d.etat === "traitement" || copieAttendue(d, maintenant)));
}
