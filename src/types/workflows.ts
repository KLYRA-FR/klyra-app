import type { Frequence } from "./domain";

/**
 * Les workflows : un canevas de nœuds qu'un déclencheur lance. Chaque étape
 * passe sa sortie aux suivantes le long des liens. Les notes, textes et formes
 * sont pour les gens : une exécution ne passe jamais par eux.
 */

export const TYPES_NOEUD = [
  "declencheur",
  "prompt",
  "ressource",
  "agent",
  "llm",
  "image",
  "condition",
  "approbation",
  "sortie",
  "note",
  "texte",
  "forme",
] as const;
export type TypeNoeud = (typeof TYPES_NOEUD)[number];

export const ANNOTATIONS = ["note", "texte", "forme"] as const satisfies readonly TypeNoeud[];

export type TypePort = "texte" | "image" | "fichier";
export type Branche = "oui" | "non";
export type TypeDeclencheur = "manuel" | "planifie" | "webhook";
export type CibleSortie = "notification" | "conversation" | "fichier";
export type Valeur = string | number | boolean;

export interface Point {
  x: number;
  y: number;
}

export interface Noeud {
  id: string;
  type: TypeNoeud;
  /** Le coin haut gauche, dans le monde du canevas. */
  at: Point;
  /** Taille choisie à la main (notes, formes, textes) ; absente : la taille par défaut. */
  taille?: { l?: number; h?: number };
  verrouille?: boolean;
  /**
   * Ce que le nœud garde, par nom :
   * - declencheur : `declencheur` (TypeDeclencheur) ; la fréquence est `frequence`.
   * - prompt : `texte`. ressource : `chemins` (un par ligne).
   * - agent : `agent`, `tache`. llm : `prompt`, `systeme`, `modele`, `effort`.
   * - image : `description`, `proportions`.
   * - condition : `regle`. approbation : `question`.
   * - sortie : `cible` (CibleSortie), `titre`, `chemin`.
   * - note : `texte`, `teinte`, `auteur`, `montrerAuteur`. texte : `texte`, `corps`, `alignement`, `gras`, `teinte`.
   * - forme : `forme`, `texte`, `teinte`.
   */
  champs: Record<string, Valeur>;
  /** Quand un déclencheur planifié part. */
  frequence?: Frequence;
}

export interface Lien {
  id: string;
  de: string;
  vers: string;
  port: TypePort;
  /** La branche d'une condition d'où part le lien. */
  branche?: Branche;
}

/** Un trait dessiné à main levée sur le canevas. */
export interface Trait {
  id: string;
  outil: "stylo" | "marqueur";
  teinte: string;
  epaisseur: number;
  points: Point[];
}

/** Tout ce qu'un enregistrement écrit. Les nœuds sont dans l'ordre d'empilement : le dernier est dessus. */
export interface Graphe {
  noeuds: Noeud[];
  liens: Lien[];
  traits: Trait[];
}

export interface VersionWorkflow {
  id: string;
  at: string;
  /** auto : toutes les 5 min d'édition ; restauration : avant de rendre une version actuelle ; execution : avant un lancement. */
  raison: "auto" | "restauration" | "execution";
  graphe: Graphe;
}

export interface Workflow {
  id: string;
  titre: string;
  graphe: Graphe;
  /** Le projet où travaillent ses agents (dossier, conversation). */
  projectId: string | null;
  creeLe: string;
  majLe: string;
  versions: VersionWorkflow[];
  /** Prochain départ de chaque déclencheur planifié, par id de nœud. */
  prochaines?: Record<string, string>;
  /** Le secret de l'adresse webhook locale, par id de nœud. */
  webhooks?: Record<string, string>;
}

export type StatutExecution = "en-cours" | "approbation" | "fait" | "erreur" | "arrete";
export type StatutEtape = "en-cours" | "approbation" | "fait" | "erreur" | "arrete" | "ignore";
export type SourceExecution = "manuel" | "planifie" | "webhook";

/** Un essai d'un nœud. */
export interface EtapeWorkflow {
  id: string;
  noeudId: string;
  /** 1 au premier passage, 2 au deuxième tour d'une boucle… */
  passe: number;
  statut: StatutEtape;
  sortie: string | null;
  fichiers?: string[];
  /** La réponse d'une condition. */
  branche: Branche | null;
  erreur: string | null;
  debut: string;
  fin: string | null;
}

export interface ExecutionWorkflow {
  id: string;
  workflowId: string;
  numero: number;
  /** Null : tout le workflow lancé à la main. */
  declencheurId: string | null;
  /** Une seule étape lancée hors exécution. */
  seule?: string;
  source: SourceExecution;
  statut: StatutExecution;
  erreur: string | null;
  debut: string;
  fin: string | null;
  etapes: EtapeWorkflow[];
  /** La conversation où ses agents ont travaillé. */
  chatId: string | null;
}

/** Les types de port que chaque nœud reçoit et envoie. */
export const PORTS: Readonly<Record<TypeNoeud, { entree: readonly TypePort[]; sortie: readonly TypePort[] }>> = {
  declencheur: { entree: [], sortie: ["texte"] },
  prompt: { entree: [], sortie: ["texte"] },
  ressource: { entree: [], sortie: ["fichier"] },
  agent: { entree: ["texte", "image", "fichier"], sortie: ["texte"] },
  llm: { entree: ["texte", "image", "fichier"], sortie: ["texte"] },
  image: { entree: ["texte", "image"], sortie: ["image"] },
  condition: { entree: ["texte"], sortie: ["texte"] },
  approbation: { entree: ["texte"], sortie: ["texte"] },
  sortie: { entree: ["texte", "image", "fichier"], sortie: [] },
  note: { entree: [], sortie: [] },
  texte: { entree: [], sortie: [] },
  forme: { entree: [], sortie: [] },
};

export function estEtape(type: TypeNoeud): boolean {
  return !(ANNOTATIONS as readonly TypeNoeud[]).includes(type);
}

const MOTS_PORT: Record<TypePort, string> = { texte: "du texte", image: "une image", fichier: "un fichier" };

/** Pourquoi on ne peut pas relier deux nœuds, ou null quand on peut. */
export function problemeLien(de: Noeud, vers: Noeud, liens: Lien[], branche?: Branche): string | null {
  if (de.id === vers.id) return "Un nœud ne peut pas se relier à lui-même";
  if (!estEtape(de.type) || !estEtape(vers.type)) return "Les notes, textes et formes ne se relient pas";
  const port = PORTS[de.type].sortie[0];
  if (!port) return "Ce nœud n’a pas de sortie";
  if (!PORTS[vers.type].entree.length) return "Ce nœud n’a pas d’entrée";
  if (!PORTS[vers.type].entree.includes(port)) return `Reçoit ${PORTS[vers.type].entree.map((p) => MOTS_PORT[p]).join(" ou ")}, pas ${MOTS_PORT[port]}`;
  if (liens.some((l) => l.de === de.id && l.vers === vers.id && l.branche === branche)) return "Déjà relié";
  return null;
}

/**
 * Les liens qui reviennent vers une étape d'avant et ferment une boucle. Un
 * parcours en profondeur depuis les nœuds où rien n'entre, puis les autres,
 * dans l'ordre du canevas : un lien vers un nœud qu'on est encore en train de
 * parcourir ferme une boucle. Sans eux, le graphe n'a pas de boucle.
 */
export function liensBoucle(noeuds: readonly { id: string }[], liens: readonly Lien[]): Set<string> {
  const suivants = new Map<string, Lien[]>();
  const entres = new Set<string>();
  for (const l of liens) {
    suivants.set(l.de, [...(suivants.get(l.de) ?? []), l]);
    entres.add(l.vers);
  }
  const boucles = new Set<string>();
  const finis = new Set<string>();
  const ouverts = new Set<string>();
  const departs = [...noeuds.filter((n) => !entres.has(n.id)), ...noeuds.filter((n) => entres.has(n.id))];
  for (const { id } of departs) {
    if (finis.has(id)) continue;
    const pile = [{ id, i: 0 }];
    ouverts.add(id);
    for (let haut = pile.at(-1); haut; haut = pile.at(-1)) {
      const l = suivants.get(haut.id)?.[haut.i];
      if (!l) {
        pile.pop();
        ouverts.delete(haut.id);
        finis.add(haut.id);
        continue;
      }
      haut.i += 1;
      if (ouverts.has(l.vers)) boucles.add(l.id);
      else if (!finis.has(l.vers)) {
        ouverts.add(l.vers);
        pile.push({ id: l.vers, i: 0 });
      }
    }
  }
  return boucles;
}

export const GRAPHE_VIDE: Graphe = { noeuds: [], liens: [], traits: [] };
