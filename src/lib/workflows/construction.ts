import { FICHES, largeurNoeud, nomNoeud } from "@/components/workflows/catalogue";
import { texteSortie } from "@/lib/workflows/moteur";
import type { Frequence } from "@/types/domain";
import {
  estEtape,
  liensBoucle,
  problemeLien,
  type Branche,
  type ExecutionWorkflow,
  type Graphe,
  type Lien,
  type Noeud,
  type Point,
  type TypeNoeud,
  type Valeur,
  type Workflow,
} from "@/types/workflows";

/**
 * Un agent construit un workflow (outil `construire_workflow`, cf. `electron/workflows-outils.ts`) :
 * ce qu'il demande est lu, vérifié, puis posé sur le graphe, étape par étape. Les nouvelles cartes
 * sont placées toutes seules, en colonnes qui suivent les liens. Le même calcul sert à l'aperçu en
 * direct (l'entrée de l'outil pendant que le modèle l'écrit, `partielle`) et à l'enregistrement :
 * ce que la personne a vu s'écrire est exactement ce qui est gardé. Pur, sans React ni Electron.
 */

/** Les types qu'un agent pose. Image : aucun modèle branché ; texte et forme : pour les gens. */
export const TYPES_AGENT = ["declencheur", "prompt", "ressource", "agent", "llm", "condition", "approbation", "sortie", "note"] as const satisfies readonly TypeNoeud[];

/** Les champs que chaque type garde, sous le nom que l'agent écrit. `nom` vaut pour tous. */
const CHAMPS: Partial<Record<TypeNoeud, readonly string[]>> = {
  declencheur: ["declencheur"],
  prompt: ["texte"],
  ressource: ["chemins"],
  agent: ["agent", "tache"],
  llm: ["prompt", "systeme", "modele", "effort"],
  condition: ["regle"],
  approbation: ["question"],
  sortie: ["cible", "titre", "chemin"],
  note: ["texte", "teinte"],
};

const ENUMS: Record<string, readonly string[]> = {
  declencheur: ["manuel", "planifie", "webhook"],
  cible: ["notification", "conversation", "fichier"],
  modele: ["haiku", "sonnet", "opus", "fable"],
  effort: ["low", "medium", "high", "xhigh", "max"],
  teinte: ["jaune", "orange", "rouge", "rose", "bleu-k1", "bleu-k3", "vert"],
};

const ID_NOUVEAU = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TEXTE_MAX = 8000;
export const ETAPES_MAX = 40;
const LIENS_MAX = 80;

/* Le placement : les colonnes suivent les liens, les cartes d'une colonne s'empilent. */
const ECART_X = 80;
const ECART_Y = 40;
const ORIGINE: Point = { x: 40, y: 80 };
const HAUTEUR: Partial<Record<TypeNoeud, number>> = { agent: 250, llm: 250, sortie: 210, declencheur: 190, note: 160 };
export const hauteurEstimee = (n: Noeud) => n.taille?.h ?? HAUTEUR[n.type] ?? 180;

export interface EtapeDemandee {
  id: string;
  type?: TypeNoeud;
  nom?: string;
  champs: Record<string, Valeur>;
  frequence?: Frequence;
}

export interface Demande {
  workflow: string | null;
  titre: string | null;
  projet: string | null;
  etapes: EtapeDemandee[];
  liens: { de: string; vers: string; branche?: Branche }[];
  retirer: string[];
  delier: { de: string; vers: string }[];
}

/** Une ligne du journal de la construction, dans l'ordre où elle se fait (montrée sur la page). */
export type Geste =
  | { type: "titre"; texte: string }
  | { type: "ajout"; id: string; texte: string }
  | { type: "modif"; id: string; texte: string }
  | { type: "retrait"; id: string; texte: string }
  | { type: "lien"; id: string; de: string; vers: string; texte: string }
  | { type: "delien"; de: string; vers: string; texte: string };

export interface Construction {
  graphe: Graphe;
  titre: string | null;
  /** Les étapes posées par cette construction (nouvelles cartes). */
  nouveaux: string[];
  /** Les étapes déjà là que la construction modifie. */
  modifies: string[];
  /** Les liens posés par cette construction. */
  liensNouveaux: string[];
  gestes: Geste[];
  /** Ce qui ne peut pas être fait ; une construction finale avec des problèmes n'est pas enregistrée. */
  problemes: string[];
  /** La carte ou le lien que l'agent est en train d'écrire (aperçu en direct seulement). */
  enEcriture: string | null;
}

const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const chaine = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function lireFrequence(v: unknown): Frequence | null {
  if (!estObjet(v)) return null;
  const heure = /^([01]\d|2[0-3]):[0-5]\d$/.test(chaine(v.heure)) ? chaine(v.heure) : "09:00";
  const jour = typeof v.jour === "number" ? Math.round(v.jour) : Number.parseInt(chaine(v.jour), 10);
  switch (v.type) {
    case "heure":
      return { type: "heure" };
    case "jour":
      return { type: "jour", heure };
    case "jours-ouvres":
      return { type: "jours-ouvres", heure };
    case "semaine":
      return { type: "semaine", jour: jour >= 1 && jour <= 7 ? jour : 1, heure };
    case "mois":
      return { type: "mois", jour: jour >= 1 && jour <= 28 ? jour : 1, heure };
    default:
      return null;
  }
}

/**
 * Ce que l'agent a écrit, mis en forme. `partielle` : l'entrée en cours d'écriture. Une étape n'y
 * compte qu'une fois son id écrit en entier (une autre clé le suit), un lien qu'une fois de et vers là.
 */
export function lireDemande(args: Record<string, unknown>, partielle = false): Demande {
  const liste = (v: unknown) => (Array.isArray(v) ? v : []);
  const etapes: EtapeDemandee[] = [];
  for (const brut of liste(args.etapes)) {
    if (!estObjet(brut)) continue;
    const cles = Object.keys(brut);
    if (partielle && (cles.indexOf("id") === -1 || cles.indexOf("id") === cles.length - 1)) continue;
    const id = chaine(brut.id);
    if (!id) continue;
    const champs: Record<string, Valeur> = {};
    for (const [cle, v] of Object.entries(brut)) {
      if (cle === "id" || cle === "type" || cle === "frequence") continue;
      if (cle === "chemins" && Array.isArray(v)) champs.chemins = v.filter((x) => typeof x === "string").join("\n");
      else if (typeof v === "string") champs[cle] = v.slice(0, TEXTE_MAX);
    }
    const type = chaine(brut.type) as TypeNoeud;
    const frequence = lireFrequence(brut.frequence);
    etapes.push({ id, ...(type ? { type } : {}), ...(typeof champs.nom === "string" ? { nom: champs.nom } : {}), champs, ...(frequence ? { frequence } : {}) });
  }
  const liens: Demande["liens"] = [];
  for (const brut of liste(args.liens)) {
    if (!estObjet(brut) || !chaine(brut.de) || !chaine(brut.vers)) continue;
    const branche = brut.branche === "oui" || brut.branche === "non" ? brut.branche : undefined;
    liens.push({ de: chaine(brut.de), vers: chaine(brut.vers), ...(branche ? { branche } : {}) });
  }
  return {
    workflow: chaine(args.workflow) || null,
    titre: chaine(args.titre).slice(0, 120) || null,
    projet: chaine(args.projet) || null,
    etapes,
    liens,
    retirer: liste(args.retirer).map(chaine).filter(Boolean),
    delier: liste(args.delier).filter(estObjet).map((l) => ({ de: chaine(l.de), vers: chaine(l.vers) })).filter((l) => l.de && l.vers),
  };
}

/** Ce que l'app sait de l'équipe pour vérifier une étape agent : les agents actifs. */
export interface ContexteConstruction {
  agents: { id: string; nom: string }[];
}

const nomDe = (n: Noeud) => nomNoeud(n);

/** Les champs d'une étape demandée, gardés pour son type ; une valeur hors liste est un problème. */
function champsPour(type: TypeNoeud, e: EtapeDemandee, ctx: ContexteConstruction, problemes: string[]): Record<string, Valeur> {
  const permis = new Set([...(CHAMPS[type] ?? []), "nom"]);
  const garde: Record<string, Valeur> = {};
  for (const [cle, v] of Object.entries(e.champs)) {
    if (!permis.has(cle)) continue;
    const valeur = typeof v === "string" ? v : String(v);
    if (ENUMS[cle] && !ENUMS[cle].includes(valeur)) {
      problemes.push(`« ${e.id} » : ${cle} vaut ${ENUMS[cle].join(", ")}, pas « ${valeur} ».`);
      continue;
    }
    if (cle === "agent" && !ctx.agents.some((a) => a.id === valeur)) {
      problemes.push(`« ${e.id} » : aucun agent actif « ${valeur} ». Agents actifs : ${ctx.agents.map((a) => a.id).join(", ")}.`);
      continue;
    }
    garde[cle] = valeur;
  }
  return garde;
}

/** Un identifiant de lien stable : le même lien a le même id dans l'aperçu et à l'enregistrement. */
const idLien = (de: string, vers: string, branche?: Branche) => `${de}~${vers}${branche ? `~${branche}` : ""}`;

/**
 * Pose la demande sur le graphe, dans l'ordre : titre, étapes, liens, retraits. Les nouvelles cartes
 * sont placées à la fin, d'après les liens (`placer`). En aperçu (`partielle`), ce qui ne va pas est
 * laissé de côté sans bruit ; sinon, chaque problème est dit.
 */
export function construire(base: Graphe, demande: Demande, ctx: ContexteConstruction, partielle = false): Construction {
  const problemes: string[] = [];
  const gestes: Geste[] = [];
  const noeuds = [...base.noeuds];
  let liens = [...base.liens];
  const nouveaux: string[] = [];
  const modifies: string[] = [];
  const liensNouveaux: string[] = [];
  const index = new Map(noeuds.map((n, i) => [n.id, i]));
  const trouver = (id: string) => {
    const i = index.get(id);
    return i === undefined ? null : noeuds[i];
  };

  if (demande.titre) gestes.push({ type: "titre", texte: `Nomme le workflow « ${demande.titre} »` });
  if (demande.etapes.length > ETAPES_MAX) problemes.push(`Au plus ${ETAPES_MAX} étapes par appel.`);
  if (demande.liens.length > LIENS_MAX) problemes.push(`Au plus ${LIENS_MAX} liens par appel.`);

  for (const e of demande.etapes.slice(0, ETAPES_MAX)) {
    const existant = trouver(e.id);
    if (existant) {
      if (!estEtape(existant.type) && existant.type !== "note") {
        problemes.push(`« ${e.id} » est une annotation de la personne : l'agent n'y touche pas.`);
        continue;
      }
      if (e.type && e.type !== existant.type) {
        problemes.push(`« ${e.id} » est une étape ${FICHES[existant.type].titre.toLowerCase()} : on ne change pas son type (retire-la, puis ajoutes-en une autre).`);
        continue;
      }
      if (existant.verrouille) {
        problemes.push(`« ${e.id} » est verrouillée par la personne.`);
        continue;
      }
      const champs = champsPour(existant.type, e, ctx, problemes);
      const suite: Noeud = {
        ...existant,
        champs: { ...existant.champs, ...champs },
        ...(existant.type === "declencheur" && e.frequence ? { frequence: e.frequence } : {}),
      };
      noeuds[index.get(e.id)!] = suite;
      if (!nouveaux.includes(e.id) && !modifies.includes(e.id)) modifies.push(e.id);
      gestes.push({ type: "modif", id: e.id, texte: `Modifie ${nomDe(suite)}` });
      continue;
    }
    if (!e.type) {
      if (!partielle) problemes.push(`« ${e.id} » n'existe pas : donne son type pour l'ajouter.`);
      continue;
    }
    if (!(TYPES_AGENT as readonly string[]).includes(e.type)) {
      problemes.push(`« ${e.id} » : type ${e.type} inconnu. Types : ${TYPES_AGENT.join(", ")}.`);
      continue;
    }
    if (!ID_NOUVEAU.test(e.id)) {
      problemes.push(`« ${e.id} » : un id en minuscules, chiffres et tirets (40 caractères au plus).`);
      continue;
    }
    const fiche = FICHES[e.type];
    const champs = champsPour(e.type, e, ctx, problemes);
    const noeud: Noeud = {
      id: e.id,
      type: e.type,
      at: { ...ORIGINE },
      ...(fiche.hauteur ? { taille: { l: fiche.largeur, h: fiche.hauteur } } : {}),
      champs: { ...fiche.champs, ...(e.type === "agent" ? { agent: "" } : {}), ...champs },
      ...(e.type === "declencheur" ? { frequence: e.frequence ?? { type: "jour" as const, heure: "09:00" } } : {}),
    };
    index.set(noeud.id, noeuds.length);
    noeuds.push(noeud);
    nouveaux.push(noeud.id);
    gestes.push({ type: "ajout", id: noeud.id, texte: `Ajoute ${nomDe(noeud)}` });
  }

  for (const l of demande.liens.slice(0, LIENS_MAX)) {
    const de = trouver(l.de);
    const vers = trouver(l.vers);
    if (!de || !vers) {
      if (!partielle) problemes.push(`Lien ${l.de} → ${l.vers} : ${!de ? l.de : l.vers} n'existe pas.`);
      continue;
    }
    const branche = de.type === "condition" ? l.branche : undefined;
    if (de.type === "condition" && !branche) {
      if (!partielle) problemes.push(`Lien ${l.de} → ${l.vers} : une condition sort par la branche oui ou non.`);
      continue;
    }
    const probleme = problemeLien(de, vers, liens, branche);
    if (probleme === "Déjà relié") continue;
    if (probleme) {
      problemes.push(`Lien ${l.de} → ${l.vers} : ${probleme.charAt(0).toLowerCase()}${probleme.slice(1)}.`);
      continue;
    }
    const lien: Lien = { id: idLien(de.id, vers.id, branche), de: de.id, vers: vers.id, port: portSortie(de), ...(branche ? { branche } : {}) };
    if (liens.some((x) => x.id === lien.id)) continue;
    liens.push(lien);
    liensNouveaux.push(lien.id);
    gestes.push({ type: "lien", id: lien.id, de: de.id, vers: vers.id, texte: `Relie ${nomDe(de)}${branche ? ` (${branche})` : ""} à ${nomDe(vers)}` });
  }

  for (const l of demande.delier) {
    const avant = liens.length;
    liens = liens.filter((x) => !(x.de === l.de && x.vers === l.vers));
    if (liens.length === avant) {
      if (!partielle) problemes.push(`Aucun lien ${l.de} → ${l.vers} à retirer.`);
      continue;
    }
    gestes.push({ type: "delien", de: l.de, vers: l.vers, texte: `Retire le lien ${l.de} → ${l.vers}` });
  }

  const retires = new Set<string>();
  for (const id of demande.retirer) {
    const n = trouver(id);
    if (!n) {
      if (!partielle) problemes.push(`Aucune étape « ${id} » à retirer.`);
      continue;
    }
    if (n.verrouille) {
      problemes.push(`« ${id} » est verrouillée par la personne.`);
      continue;
    }
    retires.add(id);
    gestes.push({ type: "retrait", id, texte: `Retire ${nomDe(n)}` });
  }

  const restants = noeuds.filter((n) => !retires.has(n.id));
  const liensRestants = liens.filter((l) => !retires.has(l.de) && !retires.has(l.vers));
  const garde = (ids: string[]) => ids.filter((id) => !retires.has(id));
  const graphe = placer({ noeuds: restants, liens: liensRestants, traits: base.traits }, garde(nouveaux));
  const derniereEtape = demande.etapes.at(-1)?.id ?? null;
  const dernierLien = demande.liens.at(-1);
  return {
    graphe,
    titre: demande.titre,
    nouveaux: garde(nouveaux),
    modifies: garde(modifies),
    liensNouveaux: liensNouveaux.filter((id) => liensRestants.some((l) => l.id === id)),
    gestes,
    problemes,
    enEcriture: !partielle ? null : dernierLien ? idLien(dernierLien.de, dernierLien.vers, dernierLien.branche) : derniereEtape,
  };
}

/** Le port d'un lien : celui de la sortie de sa source. */
function portSortie(n: Noeud): Lien["port"] {
  return n.type === "ressource" ? "fichier" : n.type === "image" ? "image" : "texte";
}

/**
 * Place les nouvelles cartes. Chaque carte a une colonne (le plus long chemin depuis le départ, sans
 * les boucles ; une entrée sans lien en amont se met juste avant ce qu'elle alimente). Une carte va à
 * droite de ce qui y entre, sinon à gauche de ce qu'elle alimente, sinon à la suite de la carte
 * nouvelle d'avant ; puis elle descend jusqu'à une place libre. Les cartes déjà là ne bougent pas.
 */
export function placer(graphe: Graphe, nouveaux: string[]): Graphe {
  if (!nouveaux.length) return graphe;
  const parId = new Map(graphe.noeuds.map((n) => [n.id, n]));
  const etapes = graphe.noeuds.filter((n) => estEtape(n.type));
  const boucles = liensBoucle(etapes, graphe.liens);
  const utiles = graphe.liens.filter((l) => !boucles.has(l.id) && parId.has(l.de) && parId.has(l.vers));
  const avant = (id: string) => utiles.filter((l) => l.vers === id).map((l) => l.de);
  const apres = (id: string) => utiles.filter((l) => l.de === id).map((l) => l.vers);

  /* Les colonnes : le plus long chemin, en suivant les liens (le graphe sans boucles est acyclique). */
  const colonne = new Map<string, number>();
  const calculer = (id: string, pile = new Set<string>()): number => {
    const connu = colonne.get(id);
    if (connu !== undefined) return connu;
    if (pile.has(id)) return 0;
    pile.add(id);
    const amont = avant(id);
    const c = amont.length ? Math.max(...amont.map((a) => calculer(a, pile) + 1)) : 0;
    pile.delete(id);
    colonne.set(id, c);
    return c;
  };
  for (const n of etapes) calculer(n.id);
  /* Une entrée sans amont va juste avant la première carte qu'elle alimente. */
  for (const n of etapes) {
    if (avant(n.id).length) continue;
    const aval = apres(n.id).map((id) => colonne.get(id) ?? 0);
    if (aval.length) colonne.set(n.id, Math.max(0, Math.min(...aval) - 1));
  }
  /* Une carte nouvelle sans aucun lien suit la nouvelle d'avant (l'aperçu, avant que les liens arrivent). */
  let precedente: string | null = null;
  for (const id of nouveaux) {
    if (!avant(id).length && !apres(id).length && precedente) colonne.set(id, (colonne.get(precedente) ?? 0) + 1);
    precedente = id;
  }

  const places = new Map<string, Point>();
  for (const n of graphe.noeuds) if (!nouveaux.includes(n.id)) places.set(n.id, n.at);
  const boite = (id: string, at: Point) => {
    const n = parId.get(id)!;
    return { x: at.x, y: at.y, l: largeurNoeud(n), h: hauteurEstimee(n) };
  };
  const chevauche = (id: string, at: Point) => {
    const b = boite(id, at);
    for (const [autre, p] of places) {
      const o = boite(autre, p);
      if (b.x < o.x + o.l + ECART_X / 2 && o.x < b.x + b.l + ECART_X / 2 && b.y < o.y + o.h + ECART_Y && o.y < b.y + b.h + ECART_Y) return true;
    }
    return false;
  };
  /* Là où commence ce qui est ajouté sans attache : à droite de ce qui existe. */
  const existants = [...places.entries()];
  const depart: Point = existants.length
    ? { x: Math.max(...existants.map(([id, p]) => p.x + largeurNoeud(parId.get(id)!))) + ECART_X * 2, y: Math.min(...existants.map(([, p]) => p.y)) }
    : ORIGINE;

  const ordre = [...nouveaux].sort((a, b) => (colonne.get(a) ?? 0) - (colonne.get(b) ?? 0) || nouveaux.indexOf(a) - nouveaux.indexOf(b));
  let derniere: string | null = null;
  for (const id of ordre) {
    const n = parId.get(id)!;
    const amont = avant(id).filter((a) => places.has(a));
    const aval = apres(id).filter((a) => places.has(a));
    let at: Point;
    if (amont.length) {
      at = {
        x: Math.max(...amont.map((a) => places.get(a)!.x + largeurNoeud(parId.get(a)!))) + ECART_X,
        y: Math.min(...amont.map((a) => places.get(a)!.y)),
      };
    } else if (aval.length) {
      at = { x: Math.min(...aval.map((a) => places.get(a)!.x)) - largeurNoeud(n) - ECART_X, y: Math.min(...aval.map((a) => places.get(a)!.y)) };
    } else if (derniere && !avant(id).length && !apres(id).length) {
      const p = places.get(derniere)!;
      at = { x: p.x + largeurNoeud(parId.get(derniere)!) + ECART_X, y: p.y };
    } else {
      at = { x: depart.x + (colonne.get(id) ?? 0) * (300 + ECART_X), y: depart.y };
    }
    at = { x: Math.round(at.x), y: Math.round(at.y) };
    for (let i = 0; i < 200 && chevauche(id, at); i++) at = { ...at, y: at.y + ECART_Y };
    places.set(id, at);
    derniere = id;
  }
  return { ...graphe, noeuds: graphe.noeuds.map((n) => (places.has(n.id) && nouveaux.includes(n.id) ? { ...n, at: places.get(n.id)! } : n)) };
}

/**
 * Les états successifs d'une construction, un par geste (une carte, puis un lien…) : la page les
 * joue l'un après l'autre quand l'agent n'a pas été vu en train d'écrire (autre moteur, VPS).
 * Les cartes ont déjà leur place finale : rien ne saute.
 */
export function etatsSuccessifs(base: Graphe, c: Construction): Graphe[] {
  const finaux = new Map(c.graphe.noeuds.map((n) => [n.id, n]));
  const etats: Graphe[] = [];
  let noeuds = [...base.noeuds];
  let liens = [...base.liens];
  for (const g of c.gestes) {
    if (g.type === "ajout" && finaux.has(g.id)) noeuds = [...noeuds, finaux.get(g.id)!];
    else if (g.type === "modif" && finaux.has(g.id)) noeuds = noeuds.map((n) => (n.id === g.id ? finaux.get(g.id)! : n));
    else if (g.type === "lien") {
      const l = c.graphe.liens.find((x) => x.id === g.id);
      if (l) liens = [...liens, l];
    } else if (g.type === "retrait") {
      noeuds = noeuds.filter((n) => n.id !== g.id);
      liens = liens.filter((l) => l.de !== g.id && l.vers !== g.id);
    } else if (g.type === "delien") liens = liens.filter((l) => !(l.de === g.de && l.vers === g.vers));
    else continue;
    etats.push({ noeuds, liens: liens.filter((l) => noeuds.some((n) => n.id === l.de) && noeuds.some((n) => n.id === l.vers)), traits: base.traits });
  }
  etats.push(c.graphe);
  return etats;
}

/* ─── Ce que l'agent lit ─────────────────────────────────────── */

const fmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const court = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const STATUTS_EXEC: Record<ExecutionWorkflow["statut"], string> = {
  "en-cours": "en cours",
  approbation: "attend l'accord de la personne",
  fait: "réussie",
  erreur: "échec",
  arrete: "arrêtée",
};

/** Ce qui empêcherait le workflow de tourner, ou de faire ce qu'on attend. */
export function problemesWorkflow(g: Graphe, ctx: ContexteConstruction): string[] {
  const etapes = g.noeuds.filter((n) => estEtape(n.type));
  const p: string[] = [];
  if (!etapes.length) p.push("Aucune étape.");
  else if (!etapes.some((n) => n.type === "declencheur")) p.push("Pas de déclencheur : le lancement part des étapes où rien n'entre.");
  for (const n of etapes) {
    const c = n.champs;
    const entre = g.liens.some((l) => l.vers === n.id);
    const sort = g.liens.some((l) => l.de === n.id);
    if (n.type === "agent" && !ctx.agents.some((a) => a.id === c.agent)) p.push(`${n.id} : agent ${c.agent ? `« ${String(c.agent)} » inactif ou inconnu` : "à choisir"}.`);
    if (n.type === "agent" && !String(c.tache ?? "").trim() && !entre) p.push(`${n.id} : ni tâche ni entrée.`);
    if (n.type === "condition" && !String(c.regle ?? "").trim()) p.push(`${n.id} : règle vide.`);
    if (n.type === "sortie" && c.cible === "fichier" && !String(c.chemin ?? "").trim()) p.push(`${n.id} : chemin du fichier vide.`);
    if (n.type === "ressource" && !String(c.chemins ?? "").trim()) p.push(`${n.id} : aucun fichier.`);
    if (n.type !== "declencheur" && n.type !== "prompt" && n.type !== "ressource" && !entre) p.push(`${n.id} : rien n'y entre.`);
    if (n.type !== "sortie" && !sort && etapes.length > 1) p.push(`${n.id} : sa sortie ne va nulle part.`);
  }
  return p;
}

const statut = (wf: Workflow, executions: ExecutionWorkflow[]) => executions.find((e) => e.workflowId === wf.id);

/** Une ligne de `lister_workflows`. `executions` : les plus récentes d'abord. */
export function ligneWorkflow(wf: Workflow, executions: ExecutionWorkflow[], projet: string | null): string {
  const n = wf.graphe.noeuds.filter((x) => estEtape(x.type)).length;
  const e = statut(wf, executions);
  return [
    `- « ${wf.titre} » (id ${wf.id})`,
    `${n} étape${n > 1 ? "s" : ""}`,
    projet ? `projet ${projet}` : null,
    e ? `dernière exécution n°${e.numero} : ${STATUTS_EXEC[e.statut]}, ${fmt.format(new Date(e.debut))}` : "jamais lancé",
  ]
    .filter(Boolean)
    .join(" · ");
}

function decrireEtape(n: Noeud, nomAgent: (id: string) => string): string {
  const c = n.champs;
  const s = (k: string) => (typeof c[k] === "string" ? String(c[k]).trim() : "");
  const nom = s("nom") ? ` « ${s("nom")} »` : "";
  const champs = (CHAMPS[n.type] ?? [])
    .filter((k) => s(k))
    .map((k) => `${k} : ${k === "agent" ? `${s(k)} (${nomAgent(s(k))})` : court(s(k).replace(/\s+/g, " "), 240)}`);
  const frequence = n.type === "declencheur" && c.declencheur === "planifie" && n.frequence ? [`frequence : ${JSON.stringify(n.frequence)}`] : [];
  return `- ${n.id} [${n.type}]${nom}${[...champs, ...frequence].length ? ` — ${[...champs, ...frequence].join(" ; ")}` : ""}`;
}

/** Le texte de `lire_workflow` : étapes, liens, problèmes, et une exécution étape par étape. */
export function decrireWorkflow(
  wf: Workflow,
  exec: ExecutionWorkflow | null,
  o: { ctx: ContexteConstruction; projet: string | null; nomAgent: (id: string) => string },
): string {
  const g = wf.graphe;
  const parId = new Map(g.noeuds.map((n) => [n.id, n]));
  const etapes = g.noeuds.filter((n) => estEtape(n.type));
  const boucles = liensBoucle(etapes, g.liens);
  const lignes = [`Workflow « ${wf.titre} » (id ${wf.id})${o.projet ? `, projet ${o.projet}` : ""}.`, "", "Étapes :"];
  lignes.push(...(etapes.length ? etapes.map((n) => decrireEtape(n, o.nomAgent)) : ["(aucune)"]));
  const notes = g.noeuds.filter((n) => n.type === "note" && String(n.champs.texte ?? "").trim());
  if (notes.length) lignes.push("", "Notes :", ...notes.map((n) => `- ${n.id} : ${court(String(n.champs.texte).replace(/\s+/g, " "), 200)}`));
  lignes.push("", "Liens :");
  const liens = g.liens.filter((l) => parId.has(l.de) && parId.has(l.vers));
  lignes.push(...(liens.length ? liens.map((l) => `- ${l.de} ${l.branche ? `—${l.branche}→` : "→"} ${l.vers}${boucles.has(l.id) ? " (boucle)" : ""}`) : ["(aucun)"]));
  const problemes = problemesWorkflow(g, o.ctx);
  if (problemes.length) lignes.push("", "À régler :", ...problemes.map((p) => `- ${p}`));
  if (!exec) {
    lignes.push("", "Jamais lancé.");
    return lignes.join("\n");
  }
  const qui = exec.lancePar ? `, lancée par ${o.nomAgent(exec.lancePar.roleId)}` : exec.source === "planifie" ? ", planifiée" : exec.source === "webhook" ? ", par webhook" : "";
  lignes.push("", `Exécution n°${exec.numero} (id ${exec.id}) : ${STATUTS_EXEC[exec.statut]}${qui}, ${fmt.format(new Date(exec.debut))}.`);
  if (exec.erreur) lignes.push(`Erreur : ${exec.erreur}`);
  for (const e of exec.etapes) {
    const n = parId.get(e.noeudId);
    const nom = n ? `${n.id}${String(n.champs.nom ?? "").trim() ? ` « ${String(n.champs.nom).trim()} »` : ""}` : e.noeudId;
    const sortie = texteSortie(e);
    const detail = e.statut === "approbation" ? "attend l'accord de la personne" : e.statut === "fait" ? "fait" : e.statut === "erreur" ? `échec : ${e.erreur ?? ""}` : e.statut === "en-cours" ? "en cours" : e.statut === "ignore" ? "ignorée (branche non suivie)" : "arrêtée";
    lignes.push(`- ${nom}${e.passe > 1 ? ` (tour ${e.passe})` : ""} : ${detail}${e.branche ? `, branche ${e.branche}` : ""}${sortie && e.statut === "fait" ? `\n  ${court(sortie.replace(/\n+/g, " ⏎ "), 600)}` : ""}`);
  }
  if (exec.chatId) lignes.push("", `Les étapes agent ont travaillé dans la conversation ${exec.chatId}.`);
  return lignes.join("\n");
}

/** La réponse de `construire_workflow` : ce qui a été fait, et ce qui reste à régler. */
export function reponseConstruction(wf: Workflow, c: Construction, nouveau: boolean, ctx: ContexteConstruction): string {
  const ajouts = c.gestes.filter((g) => g.type === "ajout").length;
  const modifs = c.modifies.length;
  const liens = c.liensNouveaux.length;
  const retraits = c.gestes.filter((g) => g.type === "retrait").length;
  const fait = [
    ajouts && `${ajouts} étape${ajouts > 1 ? "s" : ""} ajoutée${ajouts > 1 ? "s" : ""}`,
    modifs && `${modifs} modifiée${modifs > 1 ? "s" : ""}`,
    liens && `${liens} lien${liens > 1 ? "s" : ""}`,
    retraits && `${retraits} retirée${retraits > 1 ? "s" : ""}`,
  ].filter(Boolean);
  const reste = problemesWorkflow(wf.graphe, ctx);
  return [
    `${nouveau ? "Workflow créé" : "Workflow modifié"} : « ${wf.titre} » (id ${wf.id})${fait.length ? `, ${fait.join(", ")}` : ""}. La personne l'a vu se construire sur sa page Workflows.${nouveau ? "" : " L'état d'avant est gardé dans ses versions."}`,
    reste.length ? `À régler avant de le lancer :\n${reste.map((p) => `- ${p}`).join("\n")}` : "Prêt à être lancé (lancer_workflow), si la personne le demande.",
  ].join("\n");
}
