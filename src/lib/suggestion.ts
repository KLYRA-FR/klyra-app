/**
 * La réponse suggérée dans le champ d'une conversation, façon texte fantôme :
 * calculée à la fin d'une réponse d'agent (jamais pendant la frappe), sur les
 * derniers messages, sans chemin ni secret. Tab l'insère (sans envoyer), toute
 * frappe ou Échap l'efface. Règles pures et minuterie d'annulation ; l'appel au
 * modèle est dans electron/claude.ts (`suggererReponse`), les règles du texte
 * dans electron/suggestion.ts.
 */
import type { Message, MessagePart } from "@/types/domain";
import { ECHANGES_MAX, TEXTE_ECHANGE_MAX, type EchangeSuggestion } from "../../electron/suggestion";
import { sansCheminNiSecret } from "./copie-compte";

export type { EchangeSuggestion };

/** Ce qui attend une réponse de la personne ailleurs que dans le champ : pas de suggestion par-dessus. */
const PARTIES_INTERACTIVES: ReadonlySet<MessagePart["type"]> = new Set([
  "carte",
  "choix",
  "coffre-demande",
  "autorisation",
  "proposition-agent",
  "atelier-agent",
  "atelier-equipe",
  "options",
  "actions",
]);

const texteDe = (m: Message) =>
  m.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n")
    .trim();

const masques = (t: string) => t.split("•••").length - 1;

/**
 * Les derniers échanges, prêts à partir : textes seuls, chemins réduits.
 * null si l'un d'eux contient un secret (on ne suggère rien autour d'un secret).
 */
export function echangesPourSuggestion(messages: readonly Message[]): EchangeSuggestion[] | null {
  const recents = messages.filter((m) => !m.compaction && !m.compactionAuto && texteDe(m)).slice(-ECHANGES_MAX);
  const echanges: EchangeSuggestion[] = [];
  for (const m of recents) {
    const brut = texteDe(m).slice(0, TEXTE_ECHANGE_MAX);
    const propre = sansCheminNiSecret(brut);
    if (masques(propre) > masques(brut)) return null;
    echanges.push({ auteur: m.author.kind === "user" ? "moi" : "agent", texte: propre });
  }
  return echanges;
}

export interface EtatConversation {
  /** Le réglage (Réglages › Général). Coupé : aucun appel. */
  actives: boolean;
  /** Un agent travaille, ou des messages attendent leur tour. */
  occupe: boolean;
  /** Ce qui est déjà écrit dans le champ. */
  texte: string;
}

/** La dernière réponse d'agent, finie, sans carte ni demande en attente : une suggestion a du sens. */
export function peutSuggerer(messages: readonly Message[], etat: EtatConversation): boolean {
  if (!etat.actives || etat.occupe || etat.texte.trim()) return false;
  const dernier = messages.at(-1);
  if (!dernier || dernier.author.kind !== "role" || dernier.statut !== "fait") return false;
  if (dernier.compaction || dernier.compactionAuto || !texteDe(dernier)) return false;
  return !dernier.parts.some((p) => PARTIES_INTERACTIVES.has(p.type));
}

/**
 * Vrai quand la réponse vue en cours d'écriture vient de finir : la suggestion
 * naît à ce moment-là seulement (ouvrir une ancienne conversation ne coûte rien).
 */
export function reponseVientDeFinir(vueEnCours: string | null, dernier: Message | undefined): boolean {
  return !!vueEnCours && !!dernier && dernier.id === vueEnCours && dernier.statut === "fait";
}

export interface Touche {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/**
 * Ce que fait une touche quand une suggestion est montrée. Tab seul l'insère,
 * seulement champ vide et suggestion visible ; sinon Tab garde son rôle
 * (passer au contrôle suivant). Échap l'efface. null : la touche suit son cours.
 */
export function actionTouche(touche: Touche, etat: { vide: boolean; suggestion: string | null }): "inserer" | "ignorer" | null {
  if (!etat.suggestion || !etat.vide || touche.isComposing) return null;
  const modifiee = touche.shiftKey || touche.altKey || touche.ctrlKey || touche.metaKey;
  if (touche.key === "Tab" && !modifiee) return "inserer";
  if (touche.key === "Escape" && !modifiee) return "ignorer";
  return null;
}

export interface MoteurSuggestion {
  demander: (id: string, echanges: EchangeSuggestion[]) => Promise<string | null>;
  annuler: (id: string) => void;
}

/**
 * Une demande à la fois : la suivante, une frappe, l'envoi ou un autre fil
 * annulent la précédente, et une réponse arrivée trop tard est ignorée. Une
 * même réponse d'agent ne déclenche qu'une demande (Échap ne la relance pas).
 */
export class Suggesteur {
  private enCours: string | null = null;
  private readonly faites = new Set<string>();
  private courante: string | null = null;

  constructor(
    private readonly moteur: MoteurSuggestion,
    private readonly surChangement: (suggestion: string | null) => void,
  ) {}

  get suggestion(): string | null {
    return this.courante;
  }

  /** Demande une suggestion pour cette réponse (`id` : conversation et message), une seule fois. */
  lancer(id: string, echanges: EchangeSuggestion[]): void {
    if (this.faites.has(id) || !echanges.length) return;
    this.annuler();
    this.faites.add(id);
    this.enCours = id;
    void this.moteur.demander(id, echanges).then(
      (r) => {
        if (this.enCours !== id) return;
        this.enCours = null;
        this.montrer(r);
      },
      () => {
        if (this.enCours === id) this.enCours = null;
      },
    );
  }

  /** Arrête la demande en cours et efface la suggestion montrée. */
  annuler(): void {
    if (this.enCours) this.moteur.annuler(this.enCours);
    this.enCours = null;
    this.montrer(null);
  }

  /** La suggestion insérée : elle disparaît, la phrase est rendue. */
  prendre(): string | null {
    const s = this.courante;
    this.montrer(null);
    return s;
  }

  private montrer(s: string | null): void {
    if (s === this.courante) return;
    this.courante = s;
    this.surChangement(s);
  }
}
