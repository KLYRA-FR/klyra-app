import { FICHES, LIBELLES_STATUT_EXECUTION, nomNoeud } from "@/components/workflows/catalogue";
import { libelleFrequence } from "@/lib/planning";
import { ErreurPoste } from "@/lib/poste/types";
import type { Chantier } from "@/lib/workflows/chantiers";
import { texteSortie } from "@/lib/workflows/moteur";
import type { Frequence } from "@/types/domain";
import {
  estEtape,
  liensBoucle,
  type Branche,
  type EtapeWorkflow,
  type Graphe,
  type ExecutionWorkflow,
  type Noeud,
  type SourceExecution,
  type StatutEtape,
  type StatutExecution,
  type TypeNoeud,
  type Valeur,
  type VersionWorkflow,
  type Workflow,
} from "@/types/workflows";

/**
 * Un workflow lu sur le téléphone (spec mobile T-18, T-19). Le canevas devient une suite d'étapes
 * numérotées dans l'ordre des liens, les branches d'une condition en retrait. Ce fichier est partagé
 * par le geste de l'ordinateur (ce qu'il envoie, ce qu'il accepte de modifier) et par l'écran.
 */

/** Une sortie d'étape envoyée au téléphone : le début seulement, le reste est dans la conversation. */
export const SORTIE_MAX = 4000;
const TEXTE_MAX = 100_000;

/** Ce que l'ordinateur envoie d'un nœud : ni taille ni verrou, rien du dessin. */
export interface NoeudLu {
  id: string;
  type: TypeNoeud;
  at: { x: number; y: number };
  champs: Record<string, Valeur>;
  frequence?: Frequence;
}

export interface LienLu {
  id: string;
  de: string;
  vers: string;
  branche?: Branche;
}

export interface EtapeLue {
  id: string;
  noeudId: string;
  passe: number;
  statut: StatutEtape;
  sortie: string;
  branche: Branche | null;
  erreur: string | null;
  debut: string;
  fin: string | null;
}

export interface ResumeExecution {
  id: string;
  numero: number;
  source: SourceExecution;
  statut: StatutExecution;
  erreur: string | null;
  debut: string;
  fin: string | null;
  seule: boolean;
  chatId: string | null;
  faits: number;
  /** L'étape où elle attend ton accord, ou celle de l'échec. */
  arret: string | null;
}

export interface ExecutionLue extends ResumeExecution {
  etapes: EtapeLue[];
}

export interface AgentWorkflow {
  id: string;
  name: string;
  tag: string;
  teinte: string;
  actif: boolean;
}

/**
 * Un agent construit ce workflow en ce moment (cf. `src/lib/workflows/chantiers.ts`) : ce que le
 * téléphone en montre, sans le dessin. Le graphe en cours est celui de `noeuds` et `liens`.
 */
export interface ChantierLu {
  agent: { id: string; name: string; teinte: string };
  /** Un workflow que l'agent crée : il n'existe pas encore sur l'ordinateur. */
  nouveau: boolean;
  /** ecrit : l'agent écrit encore ; pose : l'app pose les étapes ; fini : enregistré à l'instant. */
  phase: Chantier["phase"];
  /** Les étapes posées par l'agent, et celles déjà là qu'il change. */
  nouveaux: string[];
  modifies: string[];
  /** L'étape qu'il écrit (pour un lien : celle où il arrive). */
  enEcriture: string | null;
  /** Ses derniers gestes, le plus récent d'abord (« Ajoute Maquette »). */
  gestes: string[];
  etapes: number;
  liens: number;
}

/** Réponse de `workflows.liste` (T-18). */
export interface LigneWorkflow {
  id: string;
  titre: string;
  majLe: string;
  declencheur: string;
  etapes: number;
  derniere: ResumeExecution | null;
  /** Un agent le construit (absent d'un ordinateur d'avant cette version). */
  chantier?: ChantierLu | null;
}

/** Réponse de `workflows.lire` (T-19). */
export interface WorkflowLu {
  id: string;
  titre: string;
  majLe: string;
  noeuds: NoeudLu[];
  liens: LienLu[];
  prochaines: Record<string, string>;
  /** La version regardée, en lecture seule ; null : le workflow actuel. */
  version: { id: string; at: string; raison: VersionWorkflow["raison"] } | null;
  executions: ResumeExecution[];
  /** Exécutions au-delà de celles envoyées. */
  plus: number;
  /** Celle dont les étapes sont montrées : la demandée, sinon celle en cours, sinon la dernière. */
  vue: ExecutionLue | null;
  enCours: string | null;
  agents: AgentWorkflow[];
  /** Un agent le construit : `noeuds` et `liens` sont alors son graphe en cours. */
  chantier?: ChantierLu | null;
}

export interface VersionLue {
  id: string;
  at: string;
  raison: VersionWorkflow["raison"];
  etapes: number;
  /** Elle est identique au workflow tel qu'il est maintenant. */
  actuelle?: boolean;
}

/* ─── Ce que l'ordinateur envoie ───────────────────────────────── */

export function noeudLu(n: Noeud): NoeudLu {
  return { id: n.id, type: n.type, at: { x: n.at.x, y: n.at.y }, champs: { ...n.champs }, ...(n.frequence ? { frequence: n.frequence } : {}) };
}

export function etapeLue(e: EtapeWorkflow): EtapeLue {
  const sortie = texteSortie(e);
  return {
    id: e.id,
    noeudId: e.noeudId,
    passe: e.passe,
    statut: e.statut,
    sortie: sortie.length > SORTIE_MAX ? `${sortie.slice(0, SORTIE_MAX)}…` : sortie,
    branche: e.branche,
    erreur: e.erreur,
    debut: e.debut,
    fin: e.fin,
  };
}

export function resumeExecution(e: ExecutionWorkflow, noeuds: readonly Noeud[]): ResumeExecution {
  const arret = e.etapes.find((s) => s.statut === "approbation" || s.statut === "erreur");
  const noeud = arret && noeuds.find((n) => n.id === arret.noeudId);
  return {
    id: e.id,
    numero: e.numero,
    source: e.source,
    statut: e.statut,
    erreur: e.erreur,
    debut: e.debut,
    fin: e.fin,
    seule: !!e.seule,
    chatId: e.chatId,
    faits: e.etapes.filter((s) => s.statut === "fait").length,
    arret: noeud ? nomNoeud(noeud) : null,
  };
}

export const enCoursExecution = (e: { statut: StatutExecution }) => e.statut === "en-cours" || e.statut === "approbation";

/** Le déclencheur d'un workflow en mots, pour la liste (T-18). */
export function libelleDeclencheur(noeuds: readonly NoeudLu[]): string {
  const declencheurs = noeuds.filter((n) => n.type === "declencheur").sort(parPosition);
  if (!declencheurs.length) return "Sans déclencheur";
  const premier = libelleUnDeclencheur(declencheurs[0]);
  return declencheurs.length > 1 ? `${premier} · +${declencheurs.length - 1}` : premier;
}

export function libelleUnDeclencheur(n: NoeudLu): string {
  const type = typeof n.champs.declencheur === "string" ? n.champs.declencheur : "manuel";
  if (type === "planifie") return `Planifié · ${libelleFrequence(n.frequence ?? { type: "jour", heure: "09:00" })}`;
  return type === "webhook" ? "Webhook" : "Manuel";
}

export function ligneWorkflow(wf: Workflow, executions: readonly ExecutionWorkflow[]): LigneWorkflow {
  const siennes = executions.filter((e) => e.workflowId === wf.id).sort((a, b) => b.debut.localeCompare(a.debut));
  const derniere = siennes.find(enCoursExecution) ?? siennes[0];
  return {
    id: wf.id,
    titre: wf.titre,
    majLe: wf.majLe,
    declencheur: libelleDeclencheur(wf.graphe.noeuds),
    etapes: wf.graphe.noeuds.filter((n) => estEtape(n.type)).length,
    derniere: derniere ? resumeExecution(derniere, wf.graphe.noeuds) : null,
  };
}

/* ─── Un agent construit ───────────────────────────────────────── */

/** Les gestes gardés pour le téléphone : les trois derniers, comme la pastille du bureau. */
const GESTES_LUS = 3;

/** Ce que l'ordinateur envoie d'un chantier. `agent` : son nom et sa teinte, lus dans l'équipe. */
export function chantierLu(c: Chantier, agent: { name: string; teinte: string } | null): ChantierLu {
  const lien = c.enEcriture ? c.graphe.liens.find((l) => l.id === c.enEcriture) : null;
  const enEcriture = lien ? lien.vers : c.enEcriture && c.graphe.noeuds.some((n) => n.id === c.enEcriture) ? c.enEcriture : null;
  return {
    agent: { id: c.roleId, name: agent?.name ?? c.roleId, teinte: agent?.teinte ?? "bleu-k1" },
    nouveau: c.nouveau,
    phase: c.phase,
    nouveaux: c.nouveaux,
    modifies: c.modifies,
    enEcriture: c.phase === "fini" ? null : enEcriture,
    gestes: c.gestes.slice(-GESTES_LUS).reverse().map((g) => g.texte),
    etapes: c.nouveaux.length,
    liens: c.liensNouveaux.length,
  };
}

/** Le chantier de ce workflow, s'il y en a un (le plus récent, s'il y en avait deux). */
export function chantierDuWorkflow(chantiers: readonly Chantier[], id: string): Chantier | null {
  return [...chantiers].filter((c) => c.workflowId === id).sort((a, b) => b.debut - a.debut)[0] ?? null;
}

/** La ligne de la liste d'un workflow que l'agent crée : il n'est pas encore enregistré. */
export function ligneChantier(c: Chantier, lu: ChantierLu, maintenant: string): LigneWorkflow {
  return {
    id: c.workflowId,
    titre: c.titre,
    majLe: maintenant,
    declencheur: libelleDeclencheur(c.graphe.noeuds),
    etapes: c.graphe.noeuds.filter((n) => estEtape(n.type)).length,
    derniere: null,
    chantier: lu,
  };
}

/**
 * La liste du téléphone (`workflows.liste`) : en tête, les workflows qu'un agent crée en ce moment
 * (pas encore enregistrés), puis tous les autres, le dernier modifié d'abord, avec leur chantier.
 */
export function listeWorkflows(
  workflows: readonly Workflow[],
  executions: readonly ExecutionWorkflow[],
  chantiers: readonly Chantier[],
  agentDe: (id: string) => { name: string; teinte: string } | null,
  maintenant: string,
): LigneWorkflow[] {
  const nouveaux = chantiers
    .filter((c) => c.nouveau && !workflows.some((w) => w.id === c.workflowId))
    .sort((a, b) => b.debut - a.debut)
    .map((c) => ligneChantier(c, chantierLu(c, agentDe(c.roleId)), maintenant));
  const lignes = [...workflows]
    .sort((a, b) => b.majLe.localeCompare(a.majLe))
    .map((wf) => {
      const c = chantierDuWorkflow(chantiers, wf.id);
      return { ...ligneWorkflow(wf, executions), ...(c ? { chantier: chantierLu(c, agentDe(c.roleId)) } : {}) };
    });
  return [...nouveaux, ...lignes];
}

/** Les nœuds et liens envoyés au téléphone, d'un graphe (celui du workflow, ou du chantier). */
export function grapheLu(g: Graphe): { noeuds: NoeudLu[]; liens: LienLu[] } {
  return { noeuds: g.noeuds.map(noeudLu), liens: g.liens.map((l) => ({ id: l.id, de: l.de, vers: l.vers, ...(l.branche ? { branche: l.branche } : {}) })) };
}

/** Ce que la construction fait d'une étape, sur le téléphone. */
export function etatChantier(c: ChantierLu | null | undefined, noeudId: string): "fantome" | "ecrit" | "modif" | "ne" | null {
  if (!c) return null;
  const nouvelle = c.nouveaux.includes(noeudId);
  if (!nouvelle && !c.modifies.includes(noeudId)) return null;
  if (c.phase === "fini") return "ne";
  if (c.enEcriture === noeudId) return "ecrit";
  return nouvelle ? "fantome" : "modif";
}

/** La relecture du téléphone : chaque seconde pendant qu'un agent construit, sinon toutes les 4 s pendant une exécution. */
export const RELECTURE_CHANTIER_MS = 1000;
export const enTravaux = (c: ChantierLu | null | undefined) => !!c && c.phase !== "fini";

/** « Attend ton accord · 3/8 », « Réussie », « Échec ». */
export function libelleExecution(e: ResumeExecution, total: number): string {
  return enCoursExecution(e) ? `${LIBELLES_STATUT_EXECUTION[e.statut]} · ${e.faits}/${total}` : LIBELLES_STATUT_EXECUTION[e.statut];
}

/** La dernière exécution d'une ligne de la liste : l'accord attendu est nommé (E7-26). */
export function libelleDerniere(d: ResumeExecution, total: number): { texte: string; accent: boolean } {
  if (d.statut === "approbation") return { texte: `Attend ton accord${d.arret ? ` · ${d.arret}` : ""}`, accent: true };
  if (d.statut === "en-cours") return { texte: libelleExecution(d, total), accent: true };
  return { texte: libelleExecution(d, total), accent: false };
}

/** Le nom d'un fichier, jamais son chemin (socle § 8). */
export const nomFichier = (chemin: string) => chemin.split(/[\\/]/).filter(Boolean).at(-1) ?? "";

/* ─── La mise à plat ───────────────────────────────────────────── */

export type LigneEtape =
  | { genre: "etape"; noeud: NoeudLu; numero: number; niveau: number }
  /** « Si oui », suivi des étapes propres à cette branche, un niveau plus loin. */
  | { genre: "branche"; branche: Branche; niveau: number }
  /** Un lien qui ne suit pas l'ordre : une branche qui rejoint plus loin, ou un retour en arrière (boucle). */
  | { genre: "saut"; niveau: number; branche: Branche | null; retour: boolean; vers: { id: string; numero: number; nom: string } };

export interface WorkflowAPlat {
  lignes: LigneEtape[];
  /** Notes, textes et formes : pour les gens, hors des étapes. */
  annotations: NoeudLu[];
}

/** L'ordre de lecture du canevas : de gauche à droite, puis de haut en bas. */
function parPosition(a: NoeudLu, b: NoeudLu): number {
  return a.at.x - b.at.x || a.at.y - b.at.y;
}

type Brouillon =
  | { genre: "etape"; noeud: NoeudLu; niveau: number }
  | { genre: "branche"; branche: Branche; niveau: number }
  | { genre: "saut"; niveau: number; branche: Branche | null; retour: boolean; vers: string };

/**
 * Les étapes dans l'ordre des liens. Les liens qui ferment une boucle (`liensBoucle`) sont mis de
 * côté : le reste est sans boucle et se lit dans l'ordre topologique, en prenant parmi les étapes
 * prêtes la plus à gauche du canevas. Après une condition, ce que seule la branche Oui atteint,
 * puis ce que seule la branche Non atteint, en retrait ; ce que les deux atteignent reprend au
 * niveau de la condition. Un retour en arrière devient une ligne « ↳ retour à l'étape N ».
 */
export function miseAPlat(noeuds: readonly NoeudLu[], liens: readonly LienLu[]): WorkflowAPlat {
  const etapes = noeuds.filter((n) => estEtape(n.type));
  const annotations = noeuds.filter((n) => !estEtape(n.type)).sort(parPosition);
  const parId = new Map(etapes.map((n) => [n.id, n]));
  const utiles = liens.filter((l) => parId.has(l.de) && parId.has(l.vers) && l.de !== l.vers);
  const boucles = liensBoucle(etapes, utiles.map((l) => ({ ...l, port: "texte" as const })));
  const avant = utiles.filter((l) => !boucles.has(l.id));
  const sortants = new Map<string, LienLu[]>();
  for (const l of utiles) sortants.set(l.de, [...(sortants.get(l.de) ?? []), l]);

  /* Ordre topologique, sans les boucles. */
  const entrees = new Map(etapes.map((n) => [n.id, 0]));
  for (const l of avant) entrees.set(l.vers, (entrees.get(l.vers) ?? 0) + 1);
  const pretes = etapes.filter((n) => entrees.get(n.id) === 0);
  const ordre: NoeudLu[] = [];
  while (pretes.length) {
    pretes.sort(parPosition);
    const n = pretes.shift()!;
    ordre.push(n);
    for (const l of sortants.get(n.id) ?? []) {
      if (boucles.has(l.id)) continue;
      const reste = (entrees.get(l.vers) ?? 1) - 1;
      entrees.set(l.vers, reste);
      if (reste === 0) pretes.push(parId.get(l.vers)!);
    }
  }
  /* Par sécurité : rien ne se perd si un lien a échappé au tri. */
  for (const n of [...etapes].sort(parPosition)) if (!ordre.includes(n)) ordre.push(n);

  const atteint = (departs: string[]) => {
    const vus = new Set<string>();
    const pile = [...departs];
    while (pile.length) {
      const id = pile.pop()!;
      if (vus.has(id)) continue;
      vus.add(id);
      for (const l of sortants.get(id) ?? []) if (!boucles.has(l.id)) pile.push(l.vers);
    }
    return vus;
  };

  const brouillon: Brouillon[] = [];
  const emettre = (liste: NoeudLu[], niveau: number) => {
    const restants = [...liste];
    while (restants.length) {
      const n = restants.shift()!;
      brouillon.push({ genre: "etape", noeud: n, niveau });
      const dehors = sortants.get(n.id) ?? [];
      const branches = n.type === "condition" ? dehors.filter((l) => l.branche) : [];
      if (branches.length) {
        const portee = (b: Branche) => atteint(branches.filter((l) => l.branche === b && !boucles.has(l.id)).map((l) => l.vers));
        const oui = portee("oui");
        const non = portee("non");
        for (const b of ["oui", "non"] as const) {
          const siens = branches.filter((l) => l.branche === b);
          if (!siens.length) continue;
          const [ici, ailleurs] = b === "oui" ? [oui, non] : [non, oui];
          const propres = restants.filter((x) => ici.has(x.id) && !ailleurs.has(x.id));
          if (propres.length) {
            brouillon.push({ genre: "branche", branche: b, niveau: niveau + 1 });
            for (const x of propres) restants.splice(restants.indexOf(x), 1);
            emettre(propres, niveau + 1);
          }
          const dedans = new Set(propres.map((x) => x.id));
          for (const l of siens) if (!dedans.has(l.vers)) brouillon.push({ genre: "saut", niveau: niveau + 1, branche: b, retour: boucles.has(l.id), vers: l.vers });
        }
      }
      for (const l of dehors) if (boucles.has(l.id) && !branches.includes(l)) brouillon.push({ genre: "saut", niveau: niveau + 1, branche: null, retour: true, vers: l.vers });
    }
  };
  emettre(ordre, 0);

  const numeros = new Map<string, number>();
  for (const ligne of brouillon) if (ligne.genre === "etape") numeros.set(ligne.noeud.id, numeros.size + 1);
  const lignes = brouillon.map((ligne): LigneEtape => {
    if (ligne.genre === "etape") return { ...ligne, numero: numeros.get(ligne.noeud.id)! };
    if (ligne.genre === "branche") return ligne;
    const cible = parId.get(ligne.vers)!;
    return { ...ligne, vers: { id: cible.id, numero: numeros.get(cible.id) ?? 0, nom: nomNoeud(cible) } };
  });
  return { lignes, annotations };
}

/** Le dernier passage de chaque nœud dans une exécution (un tour de boucle remplace le précédent). */
export function etatsEtapes(execution: { etapes: readonly EtapeLue[] } | null): Map<string, EtapeLue> {
  const etats = new Map<string, EtapeLue>();
  for (const e of execution?.etapes ?? []) etats.set(e.noeudId, e);
  return etats;
}

/** Ce qui arrive à une étape (ce qu'une approbation te demande de valider) : les sorties de ce qui y entre. */
export function entreeEtape(noeudId: string, liens: readonly LienLu[], etats: Map<string, EtapeLue>): string {
  return liens
    .filter((l) => l.vers === noeudId)
    .map((l) => etats.get(l.de))
    .filter((e): e is EtapeLue => e?.statut === "fait" && !!e.sortie)
    .map((e) => e.sortie)
    .join("\n\n");
}

/* ─── Les notes, textes et formes ──────────────────────────────── */

/** « 2 notes sur le canevas », « 1 note et 1 forme sur le canevas ». */
export function libelleAnnotations(annotations: readonly NoeudLu[]): string | null {
  if (!annotations.length) return null;
  const mots: Partial<Record<TypeNoeud, [string, string]>> = { note: ["note", "notes"], texte: ["texte", "textes"], forme: ["forme", "formes"] };
  const parties = (["note", "texte", "forme"] as const)
    .map((type) => [annotations.filter((n) => n.type === type).length, mots[type]!] as const)
    .filter(([nombre]) => nombre > 0)
    .map(([nombre, [un, plusieurs]]) => `${nombre} ${nombre > 1 ? plusieurs : un}`);
  const liste = parties.length > 1 ? `${parties.slice(0, -1).join(", ")} et ${parties.at(-1)}` : parties[0];
  return `${liste} sur le canevas`;
}

const NOMS_FORMES: Record<string, string> = {
  rectangle: "Rectangle",
  cercle: "Cercle",
  losange: "Losange",
  triangle: "Triangle",
  "triangle-inverse": "Triangle inversé",
  ovale: "Ovale",
  etoile: "Étoile",
};

/** Une note, un texte ou une forme en une ligne de texte. */
export function texteAnnotation(n: NoeudLu): string {
  const texte = typeof n.champs.texte === "string" ? n.champs.texte.trim() : "";
  if (n.type === "forme") {
    const forme = NOMS_FORMES[String(n.champs.forme)] ?? FICHES.forme.titre;
    return texte ? `${forme} : ${texte}` : forme;
  }
  return texte || (n.type === "note" ? "Note vide" : "Texte vide");
}

/* ─── Le contenu d'une étape ───────────────────────────────────── */

export type ChampEtape = { cle: string; libelle: string } & (
  | { genre: "texte"; lignes: number; placeholder: string }
  | { genre: "choix"; options: readonly { id: string; nom: string }[] }
  | { genre: "agent" }
  | { genre: "modele" }
);

/**
 * Ce que le téléphone peut modifier dans une étape : son contenu, comme sur la carte du canevas.
 * La structure (nœuds, liens, place) et les fichiers d'une ressource restent sur l'ordinateur.
 */
export const CHAMPS_ETAPE: Record<TypeNoeud, readonly ChampEtape[]> = {
  declencheur: [
    {
      cle: "declencheur",
      libelle: "Déclencheur",
      genre: "choix",
      options: [
        { id: "manuel", nom: "Manuel" },
        { id: "planifie", nom: "Planifié" },
        { id: "webhook", nom: "Webhook" },
      ],
    },
  ],
  prompt: [{ cle: "texte", libelle: "Prompt", genre: "texte", lignes: 4, placeholder: "Saisis ton prompt ici" }],
  ressource: [],
  agent: [
    { cle: "agent", libelle: "Agent", genre: "agent" },
    { cle: "tache", libelle: "Tâche", genre: "texte", lignes: 4, placeholder: "Dis à l’agent quoi faire" },
  ],
  llm: [
    { cle: "modele", libelle: "Modèle", genre: "modele" },
    {
      cle: "effort",
      libelle: "Effort",
      genre: "choix",
      options: [
        { id: "", nom: "Effort par défaut" },
        { id: "low", nom: "Effort bas" },
        { id: "medium", nom: "Effort moyen" },
        { id: "high", nom: "Effort élevé" },
      ],
    },
    { cle: "prompt", libelle: "Prompt", genre: "texte", lignes: 4, placeholder: "Saisis ton prompt ici" },
    { cle: "systeme", libelle: "Prompt système (facultatif)", genre: "texte", lignes: 2, placeholder: "Prompt système (facultatif)" },
  ],
  image: [
    { cle: "description", libelle: "Description", genre: "texte", lignes: 3, placeholder: "Décris l’image" },
    {
      cle: "proportions",
      libelle: "Proportions",
      genre: "choix",
      options: [
        { id: "carre", nom: "Carré" },
        { id: "paysage", nom: "Paysage" },
        { id: "large", nom: "Large" },
        { id: "portrait", nom: "Portrait" },
      ],
    },
  ],
  condition: [{ cle: "regle", libelle: "Règle", genre: "texte", lignes: 3, placeholder: "Décris quand l’exécution prend la branche Oui" }],
  approbation: [{ cle: "question", libelle: "Question", genre: "texte", lignes: 3, placeholder: "Demande-moi avant de continuer" }],
  sortie: [
    {
      cle: "cible",
      libelle: "Envoyer vers",
      genre: "choix",
      options: [
        { id: "notification", nom: "Notification" },
        { id: "conversation", nom: "Conversation" },
        { id: "fichier", nom: "Fichier" },
      ],
    },
    { cle: "titre", libelle: "Titre", genre: "texte", lignes: 1, placeholder: "Titre de la notification" },
    { cle: "chemin", libelle: "Chemin du fichier", genre: "texte", lignes: 1, placeholder: "Chemin du fichier (ex. ~/Documents/rapport.md)" },
  ],
  note: [],
  texte: [],
  forme: [],
};

export const modifiable = (type: TypeNoeud) => CHAMPS_ETAPE[type].length > 0;

export interface PatchEtape {
  champs: Record<string, Valeur>;
  frequence?: Frequence;
}

const illisible = () => new ErreurPoste("arguments", "Demande illisible.");
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Une fréquence de déclencheur planifié (`Frequence`), vérifiée champ par champ. */
export function lireFrequence(valeur: unknown): Frequence {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) throw illisible();
  const f = valeur as Record<string, unknown>;
  const heure = () => {
    if (typeof f.heure !== "string" || !HEURE.test(f.heure)) throw new ErreurPoste("frequence", "Choisis une heure au format HH:mm.");
    return f.heure;
  };
  const jour = (max: number) => {
    if (typeof f.jour !== "number" || !Number.isInteger(f.jour) || f.jour < 1 || f.jour > max) throw illisible();
    return f.jour;
  };
  switch (f.type) {
    case "manuel":
    case "heure":
      return { type: f.type };
    case "jour":
    case "jours-ouvres":
      return { type: f.type, heure: heure() };
    case "semaine":
      return { type: "semaine", jour: jour(7), heure: heure() };
    case "mois":
      return { type: "mois", jour: jour(28), heure: heure() };
    default:
      throw illisible();
  }
}

/**
 * Le contenu d'une étape envoyé par le téléphone : seulement les champs de son type, des valeurs
 * de la bonne forme, un agent actif, un modèle connu. Tout le reste est refusé.
 */
export function lirePatchEtape(type: TypeNoeud, valeur: unknown, connus: { agents: readonly string[]; modeles: readonly string[] }): PatchEtape {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) throw illisible();
  const brut = valeur as Record<string, unknown>;
  if (!modifiable(type)) throw new ErreurPoste("structure", "Cette étape se modifie sur l’ordinateur.");
  const champs: Record<string, Valeur> = {};
  const recus = brut.champs ?? {};
  if (typeof recus !== "object" || recus === null || Array.isArray(recus)) throw illisible();
  for (const [cle, v] of Object.entries(recus)) {
    const champ = CHAMPS_ETAPE[type].find((c) => c.cle === cle);
    if (!champ || typeof v !== "string") throw illisible();
    if (champ.genre === "texte" && v.length > TEXTE_MAX) throw new ErreurPoste("trop-long", "Ce texte dépasse 100 000 caractères.");
    if (champ.genre === "choix" && !champ.options.some((o) => o.id === v)) throw illisible();
    if (champ.genre === "agent" && !connus.agents.includes(v)) throw new ErreurPoste("agent", "Choisis un agent actif.");
    if (champ.genre === "modele" && !connus.modeles.includes(v)) throw illisible();
    champs[cle] = v;
  }
  const patch: PatchEtape = { champs };
  if (brut.frequence !== undefined) {
    if (type !== "declencheur") throw illisible();
    patch.frequence = lireFrequence(brut.frequence);
  }
  if (!Object.keys(champs).length && !patch.frequence) throw new ErreurPoste("arguments", "Rien à modifier.");
  return patch;
}

/**
 * L'étape a changé sur l'ordinateur depuis que le téléphone l'a lue : un des champs envoyés n'a plus
 * la valeur lue (`avant`). Un champ que le téléphone ne touche pas peut changer sans conflit.
 */
export function conflitEtape(noeud: Pick<Noeud, "champs" | "frequence">, patch: PatchEtape, avant: { champs: Record<string, unknown>; frequence?: unknown }): boolean {
  for (const cle of Object.keys(patch.champs)) if ((noeud.champs[cle] ?? "") !== (avant.champs[cle] ?? "")) return true;
  if (patch.frequence && JSON.stringify(noeud.frequence ?? null) !== JSON.stringify(avant.frequence ?? null)) return true;
  return false;
}

export function appliquerPatch<N extends Pick<Noeud, "champs" | "frequence">>(noeud: N, patch: PatchEtape): N {
  return { ...noeud, champs: { ...noeud.champs, ...patch.champs }, ...(patch.frequence ? { frequence: patch.frequence } : {}) };
}

/** La copie d'un workflow (« Dupliquer »), comme au bureau : même graphe et même projet, sans historique. */
export function copieWorkflow(wf: Workflow, id: string, maintenant: string): Workflow {
  return { id, titre: `Copie de ${wf.titre}`, graphe: wf.graphe, projectId: wf.projectId, creeLe: maintenant, majLe: maintenant, versions: [] };
}

/** « Rendre actuelle » : l'actuel part dans l'historique (au plus 50 versions), la version choisie devient le graphe. */
export function restaurerVersion(wf: Workflow, versionId: string, idCopie: string, maintenant: string): Workflow {
  const version = wf.versions.find((v) => v.id === versionId);
  if (!version) throw new ErreurPoste("introuvable", "Cette version n’existe plus.");
  return { ...wf, graphe: version.graphe, versions: [{ id: idCopie, at: maintenant, raison: "restauration" as const, graphe: wf.graphe }, ...wf.versions].slice(0, 50) };
}
