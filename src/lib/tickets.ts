import type { Chat, EtapeTicket, Fil, Message } from "@/types/domain";

/**
 * Les tickets : un ticket = un fil. Le fil garde son étape (à faire, en cours,
 * bloqué, à valider) ; « terminé », c'est un fil fermé (archivé).
 *
 * Les règles :
 * - un fil créé sans message est « à faire » ;
 * - une réponse commence dans le fil (ton message, ecrire_dans_fil, l'agent qui
 *   reprend de lui-même) : « en cours », la raison de blocage s'efface ;
 * - la réponse finit sans erreur : « à valider », sauf si l'étape a été posée
 *   exprès pendant la réponse (outil mettre_a_jour_fil) ;
 * - elle finit en erreur : « bloqué », avec l'erreur ; arrêtée : « bloqué », « Arrêté » ;
 * - fermer = terminé ; rouvrir reprend à « à valider » (ou « à faire » sans réponse) ;
 * - un fil d'avant les tickets reçoit son étape au chargement, sans changer le format du fichier.
 *
 * Qui peut quoi (outils des agents) : l'agent du fil et celui qui l'a lancé
 * mettent l'étape à jour ; seul celui qui l'a lancé le ferme. Un fil ouvert par
 * la personne, c'est elle qui le valide.
 */

export type ColonneTicket = EtapeTicket | "termine";

/** Ce qu'on donne à un fil à sa création ou après : priorité, échéance, projet, rappel d'origine. */
export type ChampsTicket = Partial<Pick<Fil, "priorite" | "echeance" | "projetId" | "rappel">>;

export const COLONNES: ColonneTicket[] = ["a-faire", "en-cours", "bloque", "a-valider", "termine"];

export const LIBELLES_ETAPES: Record<ColonneTicket, string> = {
  "a-faire": "à faire",
  "en-cours": "en cours",
  bloque: "bloqué",
  "a-valider": "à valider",
  termine: "terminé",
};

/** L'erreur que renvoie Claude Code quand la personne arrête la réponse (electron/claude.ts). */
export const ERREUR_ARRET = "Arrêté par toi.";

const RAISON_MAX = 200;
const propre = (texte: string) => texte.replace(/\s+/g, " ").trim().slice(0, RAISON_MAX);

/** La colonne d'un fil sur le tableau ; null : supprimé, il n'apparaît nulle part. */
export function colonneTicket(fil: Fil, travaille: boolean): ColonneTicket | null {
  if (fil.statut === "archive") return fil.supprime ? null : "termine";
  if (travaille) return "en-cours";
  return fil.etape ?? "a-faire";
}

/** L'étape d'un fil qui n'en a pas encore : « à valider » s'il a déjà une réponse. */
export const etapeDeReprise = (aReponse: boolean): EtapeTicket => (aReponse ? "a-valider" : "a-faire");

const aUneReponse = (chatId: string, messages: Message[]) =>
  messages.some((m) => m.chatId === chatId && m.author.kind === "role" && m.statut !== "en-cours");

/**
 * Au chargement : les fils sans étape en reçoivent une, et un fil resté « en cours »
 * sur ce PC (l'app s'est fermée pendant la réponse) passe « bloqué ». Rend le même
 * tableau si rien ne change.
 */
export function avecEtapes(chats: Chat[], messages: Message[]): Chat[] {
  let change = false;
  const suite = chats.map((c) => {
    if (!c.fil || c.fil.statut === "archive") return c;
    if (!c.fil.etape) {
      change = true;
      return { ...c, fil: { ...c.fil, etape: etapeDeReprise(aUneReponse(c.id, messages)) } };
    }
    if (c.fil.etape === "en-cours" && !c.fil.etapePosee && !c.lieu) {
      change = true;
      return { ...c, fil: { ...c.fil, etape: "bloque" as const, raison: "Réponse interrompue : l’app s’est fermée" } };
    }
    return c;
  });
  return change ? suite : chats;
}

/** Une réponse commence dans le fil. */
export function auDebut(fil: Fil): Fil {
  if (fil.statut === "archive") return fil;
  return { ...fil, etape: "en-cours", raison: null, etapePosee: false };
}

/** La réponse du fil est finie. */
export function apresReponse(fil: Fil, fin: { ok: boolean; erreur?: string }): Fil {
  if (fil.statut === "archive") return fil;
  if (!fin.ok) {
    const raison = fin.erreur === ERREUR_ARRET ? "Arrêté" : `Erreur : ${fin.erreur?.trim() || "inconnue"}`;
    return { ...fil, etape: "bloque", raison: propre(raison), etapePosee: false };
  }
  // Posée exprès : elle reste, et le reste jusqu'à la prochaine réponse (même après un redémarrage).
  if (fil.etapePosee) return fil;
  return { ...fil, etape: "a-valider", raison: null };
}

/** L'étape posée exprès (agent ou tableau). La raison ne vaut que pour « bloqué ». */
export function poserEtape(fil: Fil, etape: EtapeTicket, raison?: string | null): Fil {
  return { ...fil, etape, raison: etape === "bloque" ? propre(raison ?? "") || null : null, etapePosee: true };
}

/** Le fil fermé : terminé (ou supprimé, retiré des archivés). */
export function ferme(fil: Fil, supprime: boolean, maintenant: Date): Fil {
  return { ...fil, statut: "archive", supprime, fermeLe: maintenant.toISOString() };
}

/** Le fil rouvert reprend où il en était. */
export function rouvert(fil: Fil, aReponse: boolean): Fil {
  return { ...fil, statut: "ouvert", supprime: false, etape: etapeDeReprise(aReponse), raison: null, etapePosee: false, fermeLe: null };
}

export const peutMettreAJour = (fil: Fil, appelant: string) => fil.roleId === appelant || fil.lancePar?.roleId === appelant;
export const peutFermer = (fil: Fil, appelant: string) => fil.lancePar?.roleId === appelant;

/* ─── Lecture des arguments des outils ─────────────────────────── */

const sansAccents = (texte: string) => texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** L'état que l'agent peut poser : bloqué, à valider ou en cours (« terminé » passe par fermer_fil). */
export function lireEtatOutil(valeur: unknown): Exclude<EtapeTicket, "a-faire"> {
  const v = sansAccents(String(valeur ?? "")).replace(/[\s_]+/g, "-");
  if (v === "bloque") return "bloque";
  if (v === "a-valider") return "a-valider";
  if (v === "en-cours") return "en-cours";
  throw new Error(`État « ${String(valeur ?? "")} » inconnu : bloque, a-valider ou en-cours. Pour terminer, fermer_fil.`);
}

/** Priorité 0 à 3 ; absente : undefined. */
export function lirePriorite(valeur: unknown): Fil["priorite"] {
  if (valeur === undefined || valeur === null || valeur === "") return undefined;
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 0 || n > 3) throw new Error("La priorité va de 0 (aucune) à 3 (haute).");
  return n as 0 | 1 | 2 | 3;
}

/** Échéance « 2026-11-05 » ; absente : undefined. */
export function lireEcheance(valeur: unknown): string | undefined {
  if (valeur === undefined || valeur === null || valeur === "") return undefined;
  const v = String(valeur).trim();
  const [a, m, j] = v.split("-").map(Number);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(Date.UTC(a!, m! - 1, j!)) : null;
  if (!date || date.getUTCMonth() !== m! - 1 || date.getUTCDate() !== j) throw new Error(`Échéance « ${v} » invalide : une date au format 2026-11-05.`);
  return v;
}

/* ─── Liste et lignes ──────────────────────────────────────────── */

/** L'ordre de lister_fils et du planning : ce qui attend quelqu'un d'abord. */
const ORDRE: ColonneTicket[] = ["bloque", "en-cours", "a-valider", "a-faire", "termine"];

type FilChat = Chat & { fil: Fil };

/** Trie les fils : par colonne (bloqués, en cours, à valider, à faire), puis priorité, échéance et création. */
export function trierTickets<T extends FilChat>(fils: T[], travaille: (id: string) => boolean): T[] {
  const rang = (c: T) => ORDRE.indexOf(colonneTicket(c.fil, travaille(c.id)) ?? "termine");
  return [...fils].sort(
    (a, b) =>
      rang(a) - rang(b) ||
      (b.fil.priorite ?? 0) - (a.fil.priorite ?? 0) ||
      (a.fil.echeance ?? "9999").localeCompare(b.fil.echeance ?? "9999") ||
      a.fil.creeLe.localeCompare(b.fil.creeLe),
  );
}

/* ─── Le tableau ───────────────────────────────────────────────── */

export interface FiltresTickets {
  /** Un agent ; null : tous. */
  agent: string | null;
  /** Un projet ; null : tous. */
  projet: string | null;
  /** Qui l'a ouvert : toi, un agent, ou tous. */
  origine: "tous" | "moi" | "agents";
}

export const FILTRES_PAR_DEFAUT: FiltresTickets = { agent: null, projet: null, origine: "tous" };

/** Les fils fermés depuis moins de 7 jours restent dans Terminé ; les autres, sur demande. */
export const JOURS_TERMINES = 7;

const fermeLe = (c: FilChat) => c.fil.fermeLe ?? c.updatedAt;

/** Les fils de chaque colonne, filtrés et triés. Terminé : du plus récent au plus ancien. */
export function tableauTickets(
  chats: Chat[],
  travaille: (id: string) => boolean,
  filtres: FiltresTickets,
  maintenant: Date,
  tousTermines = false,
): { colonnes: Record<ColonneTicket, FilChat[]>; termines: number } {
  const limite = new Date(maintenant.getTime() - JOURS_TERMINES * 86_400_000).toISOString();
  const fils = chats.filter(
    (c): c is FilChat =>
      !!c.fil &&
      (!filtres.agent || c.fil.roleId === filtres.agent) &&
      (!filtres.projet || c.fil.projetId === filtres.projet) &&
      (filtres.origine === "tous" || (filtres.origine === "moi") === !c.fil.lancePar),
  );
  const colonnes = Object.fromEntries(COLONNES.map((c) => [c, [] as FilChat[]])) as Record<ColonneTicket, FilChat[]>;
  for (const c of trierTickets(fils, travaille)) {
    const colonne = colonneTicket(c.fil, travaille(c.id));
    if (colonne) colonnes[colonne].push(c);
  }
  colonnes.termine.sort((a, b) => fermeLe(b).localeCompare(fermeLe(a)));
  const termines = colonnes.termine.length;
  if (!tousTermines) colonnes.termine = colonnes.termine.filter((c) => fermeLe(c) >= limite);
  return { colonnes, termines };
}

const PRIORITES = ["", "priorité basse", "priorité moyenne", "priorité haute"];

/** Une ligne de ticket, pour les agents : « Rapport hebdo (klyra-fil-…) · Hugo · bloqué : attend l'accès · priorité moyenne · échéance 2026-11-05 · projet Klyra.fr ». */
export function ligneTicket(chat: FilChat, contexte: { travaille: boolean; agent: string; projet?: string | null; lancePar?: string | null }): string {
  const colonne = colonneTicket(chat.fil, contexte.travaille) ?? "termine";
  const etat = colonne === "bloque" && chat.fil.raison ? `bloqué : ${chat.fil.raison}` : LIBELLES_ETAPES[colonne];
  return [
    `${chat.title} (${chat.id})`,
    contexte.agent,
    etat,
    PRIORITES[chat.fil.priorite ?? 0],
    chat.fil.echeance && `échéance ${chat.fil.echeance}`,
    contexte.projet && `projet ${contexte.projet}`,
    contexte.lancePar && `lancé par ${contexte.lancePar}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
