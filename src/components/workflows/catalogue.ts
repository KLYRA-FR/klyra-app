import type { IconName } from "@/components/icons/Icon";
import { poste } from "@/lib/plateforme";
import type { RoleTeinte } from "@/types/domain";
import type { Noeud, StatutEtape, StatutExecution, TypeNoeud, Valeur } from "@/types/workflows";

/** Ce que le menu d'ajout et les cartes savent de chaque nœud. */
export interface FicheNoeud {
  type: TypeNoeud;
  titre: string;
  /** Ce qu'il fait, en une ligne, dans le menu d'ajout. */
  aide: string;
  icone: IconName;
  groupe: "entrees" | "etapes" | "flux" | "annotations";
  /** Largeur par défaut ; les notes, textes et formes ont aussi une hauteur. */
  largeur: number;
  hauteur?: number;
  champs: Record<string, Valeur>;
  /** Pas encore utilisable : affiché grisé dans le menu. */
  bientot?: string;
}

export const FICHES: Record<TypeNoeud, FicheNoeud> = {
  declencheur: {
    type: "declencheur",
    titre: "Déclencheur",
    aide: "Lance le workflow : à la main, à heure fixe ou par un webhook.",
    icone: "lightning-01",
    groupe: "flux",
    largeur: 280,
    champs: { declencheur: "manuel" },
  },
  prompt: {
    type: "prompt",
    titre: "Prompt",
    aide: "Un texte que tu écris, passé aux étapes suivantes.",
    icone: "text-input-01",
    groupe: "entrees",
    largeur: 280,
    champs: { texte: "" },
  },
  ressource: {
    type: "ressource",
    titre: "Ressource",
    aide: `Des fichiers de ${poste.ton}, passés aux étapes suivantes.`,
    icone: "file-01",
    groupe: "entrees",
    largeur: 280,
    champs: { chemins: "" },
  },
  agent: {
    type: "agent",
    titre: "Agent",
    aide: "Un agent de l’équipe fait une tâche avec ce qu’il reçoit.",
    icone: "users-profiles-01",
    groupe: "etapes",
    largeur: 300,
    champs: { agent: "principal", tache: "" },
  },
  llm: {
    type: "llm",
    titre: "LLM",
    aide: "Un appel direct au modèle, sans outils.",
    icone: "stars",
    groupe: "etapes",
    largeur: 300,
    champs: { prompt: "", systeme: "", modele: "sonnet", effort: "" },
  },
  image: {
    type: "image",
    titre: "Image",
    aide: "Génère une image à partir d’une description.",
    icone: "image-01",
    groupe: "etapes",
    largeur: 280,
    champs: { description: "", proportions: "carre" },
    bientot: "Aucun modèle d’image n’est encore branché à l’app.",
  },
  condition: {
    type: "condition",
    titre: "Condition",
    aide: "Juge ce qu’elle reçoit et prend la branche Oui ou Non.",
    icone: "git-branch-02",
    groupe: "flux",
    largeur: 280,
    champs: { regle: "" },
  },
  approbation: {
    type: "approbation",
    titre: "Approbation",
    aide: "Attend ton accord avant de continuer.",
    icone: "shield-check",
    groupe: "flux",
    largeur: 280,
    champs: { question: "" },
  },
  sortie: {
    type: "sortie",
    titre: "Sortie",
    aide: "Envoie le résultat : notification, conversation ou fichier.",
    icone: "send-01",
    groupe: "flux",
    largeur: 280,
    champs: { cible: "notification", titre: "", chemin: "" },
  },
  note: {
    type: "note",
    titre: "Note",
    aide: "Une note adhésive pour l’équipe.",
    icone: "note-01",
    groupe: "annotations",
    largeur: 200,
    hauteur: 160,
    champs: { texte: "", teinte: "jaune", montrerAuteur: true },
  },
  texte: {
    type: "texte",
    titre: "Texte",
    aide: "Un texte libre sur le canevas.",
    icone: "type-01",
    groupe: "annotations",
    largeur: 240,
    champs: { texte: "", corps: "corps", alignement: "gauche", gras: false },
  },
  forme: {
    type: "forme",
    titre: "Forme",
    aide: "Un rectangle, un cercle, un losange…",
    icone: "square",
    groupe: "annotations",
    largeur: 160,
    hauteur: 120,
    champs: { forme: "rectangle", texte: "", teinte: "bleu-k1" },
  },
};

export const GROUPES: { id: FicheNoeud["groupe"]; titre: string }[] = [
  { id: "entrees", titre: "Entrées" },
  { id: "etapes", titre: "Étapes" },
  { id: "flux", titre: "Flux" },
];

export const FORMES = [
  { id: "rectangle", nom: "Rectangle" },
  { id: "cercle", nom: "Cercle" },
  { id: "losange", nom: "Losange" },
  { id: "triangle", nom: "Triangle" },
  { id: "triangle-inverse", nom: "Triangle inversé" },
  { id: "ovale", nom: "Ovale" },
  { id: "etoile", nom: "Étoile" },
] as const;

/** Les teintes des notes et des formes : les pastels des agents (palette des stickers). */
export const TEINTES: { id: RoleTeinte; nom: string }[] = [
  { id: "jaune", nom: "Jaune" },
  { id: "orange", nom: "Orange" },
  { id: "rouge", nom: "Rouge" },
  { id: "rose", nom: "Rose" },
  { id: "bleu-k1", nom: "Bleu" },
  { id: "bleu-k3", nom: "Sarcelle" },
  { id: "vert", nom: "Vert" },
];

/** Les couleurs du dessin à main levée. */
export const ENCRES = [
  { id: "encre", nom: "Par défaut", valeur: "#303030" },
  { id: "bleu", nom: "Bleu", valeur: "#003FE4" },
  { id: "orange", nom: "Orange", valeur: "#FC5404" },
  { id: "vert", nom: "Vert", valeur: "#47B59B" },
  { id: "rose", nom: "Rose", valeur: "#C484BE" },
];

export function nouveauNoeud(type: TypeNoeud, at: { x: number; y: number }, auteur?: string): Noeud {
  const f = FICHES[type];
  return {
    id: crypto.randomUUID(),
    type,
    at: { x: Math.round(at.x), y: Math.round(at.y) },
    ...(f.hauteur ? { taille: { l: f.largeur, h: f.hauteur } } : {}),
    champs: { ...f.champs, ...(type === "note" && auteur ? { auteur } : {}) },
    ...(type === "declencheur" ? { frequence: { type: "jour" as const, heure: "09:00" } } : {}),
  };
}

export const LIBELLES_STATUT_ETAPE: Record<StatutEtape, string> = {
  "en-cours": "En cours",
  approbation: "En attente",
  fait: "Fait",
  erreur: "Échec",
  arrete: "Arrêtée",
  ignore: "Ignorée",
};

export const LIBELLES_STATUT_EXECUTION: Record<StatutExecution, string> = {
  "en-cours": "En cours",
  approbation: "Attend ton accord",
  fait: "Réussie",
  erreur: "Échec",
  arrete: "Arrêtée",
};

/** Le nom affiché d'un nœud : son titre à lui, sinon celui de son type. */
export function nomNoeud(n: Noeud): string {
  const propre = typeof n.champs.nom === "string" ? n.champs.nom.trim() : "";
  return propre || FICHES[n.type].titre;
}

/** Hauteur où partent et arrivent les liens, depuis le haut de la carte. */
export const ANCRE_PORT = 22;
/** La seconde sortie d'une condition (branche Non). */
export const ANCRE_NON = 52;

export function largeurNoeud(n: Noeud): number {
  return n.taille?.l ?? FICHES[n.type].largeur;
}
