/**
 * La fiche d'un projet sur le téléphone (lot 6, § 2) : brief, agents et travaux, lus sur l'ordinateur.
 * Les travaux viennent du journal de ce PC (`superagent.projection` et `.preuves`), jamais du titre des
 * chats. Ce qui part au téléphone est une vue courte et lisible : pas d'identifiant de travail, de
 * référence d'état ni de référence de preuve (un chemin peut s'y trouver) ; l'identifiant du fil reste,
 * il sert au lien « Ouvrir le fil » et ne s'affiche jamais. Une source absente est dite, pas mise à zéro.
 * Cette vue répond à une demande du téléphone : elle passe par `demandesPoste`, le temps de la réponse,
 * comme un fichier lu (M-7, effacée à la lecture ou à l'expiration) ; rien du journal n'est copié au compte.
 */

import type { ProjetModifiable } from "./dossiers";

/** Ce que le journal répond (`bridge.superagent`), réduit à ce que la fiche lit. */
export interface JournalTravaux {
  projection: (projectId: string | null) => Promise<ReponseJournal<ProjectionJournal>>;
  preuves: (workId: string) => Promise<ReponseJournal<unknown>>;
}

type ReponseJournal<T> = { ok: true; data: T } | { ok: false; message: string };

interface LigneJournal {
  work_id: string;
  fil_id: string | null;
  titre: string;
  owner_agent_id: string | null;
  status: string;
  deadline_at: string | null;
  last_progress_at?: string | null;
  couts?: { unite: string; total: number }[];
}

export interface ProjectionJournal {
  travaux: LigneJournal[];
  alertes: { work_id: string; type: string; motif: string; prochain_geste: string }[];
  evenements?: { event_id: string; work_id: string; type: string; resume: string; quand?: string | null }[];
  couverture: string;
}

interface PreuvesJournal {
  operations: { status: string }[];
  checkpoints: { observed_at: string }[];
}

export interface AgentFiche {
  /** Pour l'avatar et le lien vers sa fiche ; jamais affiché. */
  id: string;
  nom: string;
  role: string;
}

export type TonTravail = "neutre" | "bleue" | "orange";

export interface SuiviTravail {
  genre: "alerte" | "verification" | "commentaire" | "preuves";
  texte: string;
  /** La ligne dessous : le prochain geste, ou une heure. */
  detail: string | null;
  /** L'heure de ce fait (ISO), s'il en a une. */
  quand: string | null;
}

export interface TravailFiche {
  /** Le rang dans la liste : une clé d'affichage, pas un identifiant du journal. */
  cle: string;
  titre: string;
  statut: string;
  ton: TonTravail;
  /** Le nom du responsable, null s'il n'est plus dans les agents actifs. */
  agent: string | null;
  echeance: string | null;
  derniereNouvelle: string | null;
  fini: boolean;
  /** Le coût mesuré, en clair (« 0,84 $ ») ; null s'il n'est pas mesuré. */
  cout: string | null;
  /** L'alerte qui reste ouverte, pour la ligne de la liste. */
  alerte: string | null;
  filId: string | null;
  suivi: SuiviTravail[];
}

/** Une section indisponible n'est pas « aucun travail » (§ 2). */
export type TravauxFiche = { etat: "ok"; liste: TravailFiche[]; coupes: number } | { etat: "indisponible"; raison: string };

export interface FicheProjet {
  brief: string;
  /** Null : l'ordinateur n'a pas su les nommer ; la zone le dit plutôt que de montrer un vide. */
  agents: AgentFiche[] | null;
  travaux: TravauxFiche;
  /** Faux : le projet vit sur un serveur, rien ne se fait « sur ton Mac » directement. */
  surPoste: boolean;
}

/** Modifier : Enregistrer reste inactif tant que rien n'a changé (E6-33) ; ✕ ferme alors sans demander (E6-35). */
export function projetModifie(initial: ProjetModifiable, valeurs: ProjetModifiable): boolean {
  return (Object.keys(initial) as (keyof ProjetModifiable)[]).some((cle) => initial[cle] !== valeurs[cle]);
}

/** Au-delà, la fiche dit combien de travaux ne sont pas montrés. */
export const TRAVAUX_MAX = 40;

const STATUTS_TRAVAIL: Record<string, { libelle: string; ton: TonTravail }> = {
  active: { libelle: "En cours", ton: "bleue" },
  waiting: { libelle: "En attente", ton: "neutre" },
  waiting_machine: { libelle: "En attente d’une machine", ton: "neutre" },
  suspended: { libelle: "Suspendu", ton: "neutre" },
  cancelled: { libelle: "Annulé", ton: "neutre" },
  done: { libelle: "Terminé", ton: "neutre" },
  blocked: { libelle: "Bloqué", ton: "orange" },
  reconciliation_required: { libelle: "À rapprocher", ton: "orange" },
};

export function statutTravail(status: string): { libelle: string; ton: TonTravail } {
  return STATUTS_TRAVAIL[status] ?? { libelle: "Inconnu", ton: "neutre" };
}

/**
 * Un texte du journal pour l'écran (socle § 8) : sans identifiant de fil ni chemin système, sans le mot
 * interne du moteur de surveillance. Sa phrase qui parle du moteur est retirée, le reste reste tel quel.
 */
export function texteLisible(brut: string): string {
  return brut
    .split(/(?<=[.!?])\s+/)
    .filter((phrase) => !/watchdog/i.test(phrase))
    .join(" ")
    .replace(/klyra-fil-[\w-]+/g, "ce fil")
    .replace(/(?:[a-z]:[\\/]|~?\/)[^\s"'«»]*[\\/][^\s"'«»]*/gi, "un fichier")
    .replace(/\s+/g, " ")
    .trim();
}

/** Après « À surveiller : », la phrase continue en minuscule ; un sigle garde ses capitales. */
function suite(texte: string): string {
  return /^\p{Lu}\p{Ll}/u.test(texte) ? texte.charAt(0).toLowerCase() + texte.slice(1) : texte;
}

function montant(total: number, unite: string): string {
  const u = unite.trim().toLowerCase();
  const nombre = total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (u === "usd" || u === "$") return `${nombre} $`;
  if (u === "eur" || u === "€") return `${nombre} €`;
  return `${total.toLocaleString("fr-FR")} ${unite}`;
}

function estPreuves(valeur: unknown): valeur is PreuvesJournal {
  const p = valeur as PreuvesJournal | null;
  return !!p && typeof p === "object" && Array.isArray(p.operations) && Array.isArray(p.checkpoints);
}

/** « Preuves : 2 opérations constatées, 1 point de contrôle. » Rien de constaté : pas de ligne. */
function lignePreuves(preuves: PreuvesJournal): SuiviTravail | null {
  const constatees = preuves.operations.filter((o) => o.status === "succeeded").length;
  const points = preuves.checkpoints.length;
  if (constatees === 0 && points === 0) return null;
  const parts = [
    constatees ? `${constatees} opération${constatees > 1 ? "s" : ""} constatée${constatees > 1 ? "s" : ""}` : null,
    points ? `${points} point${points > 1 ? "s" : ""} de contrôle` : null,
  ].filter(Boolean);
  return { genre: "preuves", texte: `Preuves : ${parts.join(", ")}.`, detail: null, quand: preuves.checkpoints.at(-1)?.observed_at ?? null };
}

/** Une ligne du journal, avec ses alertes, ses vérifications et ses preuves, telle que le téléphone la lit. */
export function travailFiche(ligne: LigneJournal, rang: number, projection: ProjectionJournal, preuves: unknown, nomAgent: (id: string) => string | null): TravailFiche {
  const statut = statutTravail(ligne.status);
  const alertes = projection.alertes.filter((a) => a.work_id === ligne.work_id);
  const suivi: SuiviTravail[] = alertes.map((a) => ({
    genre: "alerte",
    texte: `À surveiller : ${suite(texteLisible(a.motif))}`,
    detail: texteLisible(a.prochain_geste) ? `Prochain geste : ${suite(texteLisible(a.prochain_geste))}` : null,
    quand: null,
  }));
  for (const e of projection.evenements ?? []) {
    if (e.work_id !== ligne.work_id) continue;
    suivi.push({ genre: e.type === "fin_verification" ? "verification" : "commentaire", texte: `${e.type === "fin_verification" ? "Vérification" : "Commentaire"} : ${suite(texteLisible(e.resume))}`, detail: null, quand: e.quand ?? null });
  }
  const preuve = estPreuves(preuves) ? lignePreuves(preuves) : null;
  if (preuve) suivi.push(preuve);
  const couts = ligne.couts ?? [];
  return {
    cle: String(rang),
    titre: texteLisible(ligne.titre) || "Sans titre",
    statut: statut.libelle,
    ton: statut.ton,
    agent: ligne.owner_agent_id ? nomAgent(ligne.owner_agent_id) : null,
    echeance: ligne.deadline_at,
    derniereNouvelle: ligne.last_progress_at ?? null,
    fini: ligne.status === "done",
    cout: couts.length ? couts.map((c) => montant(c.total, c.unite)).join(" · ") : null,
    alerte: alertes[0] ? texteLisible(alertes[0].motif) : null,
    filId: ligne.fil_id,
    suivi,
  };
}

/** Les travaux d'un projet, lus dans le journal. Tout ce qui empêche de le lire devient une section indisponible. */
export async function travauxDuJournal(journal: JournalTravaux | null, projetId: string, ton: string, nomAgent: (id: string) => string | null = () => null): Promise<TravauxFiche> {
  if (!journal) return { etat: "indisponible", raison: "Les travaux se lisent dans l’app de bureau." };
  const indisponible: TravauxFiche = { etat: "indisponible", raison: `Le journal des travaux n’a pas pu être lu sur ${ton}.` };
  const reponse = await journal.projection(projetId).catch(() => null);
  if (!reponse?.ok || !Array.isArray(reponse.data?.travaux) || reponse.data.couverture !== "ok") return indisponible;
  const projection = reponse.data;
  const lignes = projection.travaux.slice(0, TRAVAUX_MAX);
  const preuves = await Promise.all(lignes.map((l) => journal.preuves(l.work_id).then((r) => (r.ok ? r.data : null), () => null)));
  return {
    etat: "ok",
    liste: lignes.map((ligne, i) => travailFiche(ligne, i, projection, preuves[i], nomAgent)),
    coupes: Math.max(0, projection.travaux.length - lignes.length),
  };
}

const deux = (n: number) => String(n).padStart(2, "0");
const JOURS_COURTS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function dateSure(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ecartJours(d: Date, maintenant: number): number {
  const m = new Date(maintenant);
  return Math.round((new Date(m.getFullYear(), m.getMonth(), m.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
}

/** « ven. 6 nov. ». */
export function jourCourt(iso: string | null | undefined): string | null {
  const d = dateSure(iso);
  return d ? `${JOURS_COURTS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}` : null;
}

/** « il y a 2 h », « il y a 5 min », « à l'instant », puis le jour. */
export function ilYa(iso: string | null | undefined, maintenant: number): string | null {
  const d = dateSure(iso);
  if (!d) return null;
  const minutes = Math.floor((maintenant - d.getTime()) / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 24 * 60) return `il y a ${Math.floor(minutes / 60)} h`;
  return jourCourt(iso);
}

/** « Aujourd'hui, 11:02 », « Hier, 17:40 », « ven. 6 nov., 09:00 ». */
export function quandLisible(iso: string | null | undefined, maintenant: number): string | null {
  const d = dateSure(iso);
  if (!d) return null;
  const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}`;
  const jours = ecartJours(d, maintenant);
  if (jours === 0) return `Aujourd’hui, ${heure}`;
  if (jours === 1) return `Hier, ${heure}`;
  return `${jourCourt(iso)}, ${heure}`;
}

/** « fini à 17:40 », « fini hier à 17:40 », « fini le 2 nov. ». */
export function libelleFini(iso: string | null | undefined, maintenant: number): string | null {
  const d = dateSure(iso);
  if (!d) return null;
  const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}`;
  const jours = ecartJours(d, maintenant);
  if (jours === 0) return `fini à ${heure}`;
  if (jours === 1) return `fini hier à ${heure}`;
  return `fini le ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/** La ligne 2 d'un travail dans la liste : le responsable, puis ce qui compte le plus (alerte, fin, échéance). */
export function ligneTravail(travail: TravailFiche, maintenant: number): string {
  const detail = travail.alerte
    ? `à surveiller : ${suite(travail.alerte.replace(/\.$/, ""))}`
    : travail.fini
      ? libelleFini(travail.derniereNouvelle, maintenant)
      : travail.echeance
        ? `échéance ${jourCourt(travail.echeance)}`
        : null;
  return [travail.agent, detail].filter(Boolean).join(" · ");
}
