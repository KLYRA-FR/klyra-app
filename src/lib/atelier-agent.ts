import type { AjoutFiche, BrouillonAgent, DemandesEpreuve, MajAtelier, Message, RoleTeinte, RoutineProposee, VoisinAgent } from "@/types/domain";
import type { RoutineInput, RoutineSchedule } from "@/types/routines";
import { PILIERS_LISTE, type CasEpreuve, type PilierListe, type ResultatCas } from "../../electron/epreuve";
import { serializeAgentFile, setFields } from "./agent-file";
import { comparable, identifiantDe, nomPropre } from "./noms-agents";
import { jetonsEstimes, SEUIL_FICHE_LONGUE } from "./poids-fiche";

/**
 * L'atelier d'un agent, dans la conversation avec l'assistant. L'assistant pose une question à la
 * fois (avec des réponses toutes prêtes, outil `proposer_choix`) et complète la carte de l'agent à
 * chaque réponse (outil `proposer_agent`). Chaque appel est gardé tel quel dans le fil ; la carte
 * les plie dans l'ordre. Rien n'est écrit sur le disque avant « Créer l'agent ».
 */

/* ─── Lecture des outils ──────────────────────────────────────────── */

const texte = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : undefined);

/** Une liste de phrases : 10 au plus, 300 caractères chacune. Une phrase seule compte comme une liste. */
function liste(v: unknown): string[] | undefined {
  const brut = typeof v === "string" ? [v] : Array.isArray(v) ? v : undefined;
  if (!brut) return undefined;
  return brut
    .map((x) => texte(x, 300) ?? "")
    .filter(Boolean)
    .slice(0, 10);
}

/** L'identifiant proposé : minuscules, chiffres et tirets (comme l'éditeur). */
export const identifiantPropre = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const MODELES = ["opus", "sonnet", "haiku"] as const;

function lireEpreuve(v: unknown): DemandesEpreuve | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const e = { normal: texte(o.normal, 300) ?? "", floue: texte(o.floue, 300) ?? "", horsMetier: texte(o.horsMetier, 300) ?? "" };
  return e.normal && e.floue && e.horsMetier ? e : undefined;
}

function lireVoisins(v: unknown): VoisinAgent[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ id: identifiantPropre(texte(x.id, 64) ?? ""), raison: texte(x.raison, 200) ?? "" }))
    .filter((x) => x.id && x.raison)
    .slice(0, 3);
}

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
function lireRoutine(v: unknown): RoutineProposee | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const q = (o.quand && typeof o.quand === "object" ? o.quand : {}) as Record<string, unknown>;
  const type = q.type;
  const heure = typeof q.heure === "string" && HEURE.test(q.heure) ? q.heure : "09:00";
  const nom = texte(o.nom, 80) ?? "";
  const consigne = texte(o.consigne, 2000) ?? "";
  if (!nom || !consigne || (type !== "jour" && type !== "jours-ouvres" && type !== "semaine" && type !== "mois")) return undefined;
  const jour = typeof q.jour === "number" && Number.isInteger(q.jour) ? q.jour : 1;
  if (type === "semaine" && (jour < 1 || jour > 7)) return undefined;
  if (type === "mois" && (jour < 1 || jour > 28)) return undefined;
  return { nom, consigne, quand: type === "semaine" || type === "mois" ? { type, heure, jour } : { type, heure } };
}

/** Ce qu'un appel à `proposer_agent` apprend ; `null` s'il n'apprend rien. */
export function lireMajAtelier(entree: Record<string, unknown>): MajAtelier | null {
  const maj: MajAtelier = {};
  if (entree.nouveau === true) maj.nouveau = true;
  const id = texte(entree.id, 64);
  if (id !== undefined) maj.id = identifiantPropre(id);
  const nom = texte(entree.nom, 60);
  if (nom !== undefined) maj.nom = nom;
  const role = texte(entree.role, 40);
  if (role !== undefined) maj.role = role;
  const mission = texte(entree.mission, 400);
  if (mission !== undefined) maj.mission = mission;
  const description = texte(entree.description, 1200);
  if (description !== undefined) maj.description = description;
  for (const cle of ["declencheurs", "livrables", "methode", "limites", "verification"] as const) {
    const l = liste(entree[cle]);
    if (l !== undefined) maj[cle] = l;
  }
  if (typeof entree.consignes === "string") maj.consignes = entree.consignes.trim().slice(0, 40_000);
  if (MODELES.includes(entree.modele as (typeof MODELES)[number])) maj.modele = entree.modele as MajAtelier["modele"];
  const epreuve = lireEpreuve(entree.epreuve);
  if (epreuve) maj.epreuve = epreuve;
  const voisins = lireVoisins(entree.voisins);
  if (voisins) maj.voisins = voisins;
  const routine = lireRoutine(entree.routine);
  if (routine) maj.routine = routine;
  return Object.keys(maj).length ? maj : null;
}

export const BROUILLON_VIDE: BrouillonAgent = {
  id: "",
  nom: "",
  role: "",
  mission: "",
  description: "",
  declencheurs: [],
  livrables: [],
  methode: [],
  limites: [],
  verification: [],
  consignes: "",
  modele: "",
  epreuve: null,
  voisins: [],
  routine: null,
};

/** La carte après un appel : chaque champ donné remplace le précédent, `nouveau` repart de zéro. */
export function appliquerMaj(brouillon: BrouillonAgent, maj: MajAtelier): BrouillonAgent {
  const { nouveau, ...champs } = maj;
  const depart = nouveau ? BROUILLON_VIDE : brouillon;
  return { ...depart, ...Object.fromEntries(Object.entries(champs).filter(([, v]) => v !== undefined)) };
}

/** Les phrases ajoutées par la personne : à la suite de leur pilier, une seule fois, quoi que l'assistant écrive ensuite. */
export function appliquerAjouts(b: BrouillonAgent, ajouts: AjoutFiche[]): BrouillonAgent {
  if (!ajouts.length) return b;
  const suite = { ...b };
  for (const { pilier, texte: t } of ajouts) {
    if (!suite[pilier].some((x) => comparable(x) === comparable(t))) suite[pilier] = [...suite[pilier], t];
  }
  return suite;
}

/* ─── Les cinq piliers ────────────────────────────────────────────── */

export const PILIERS = [
  { cle: "mission", titre: "Sa mission" },
  { cle: "declencheurs", titre: "Quand l’appeler" },
  { cle: "livrables", titre: "Ce qu’il livre" },
  { cle: "limites", titre: "Ses limites" },
  { cle: "verification", titre: "Comment il vérifie" },
] as const;
export type Pilier = (typeof PILIERS)[number]["cle"];

/** Une fiche écrite d'un bloc par l'assistant : ses sections disent quels piliers elle couvre. */
const SECTIONS: Record<Exclude<Pilier, "mission">, RegExp> = {
  declencheurs: /^##\s+.*(quand|m[’']appeler)/im,
  livrables: /^##\s+.*(livr|je rends|ce que je produis)/im,
  limites: /^##\s+.*(ne fais pas|limites|accord)/im,
  verification: /^##\s+.*(crit[eè]res|v[ée]rifi)/im,
};

export function piliersRemplis(b: BrouillonAgent): Set<Pilier> {
  const remplis = new Set<Pilier>();
  if (b.mission || b.description) remplis.add("mission");
  for (const cle of ["declencheurs", "livrables", "limites", "verification"] as const) {
    if (b[cle].length || SECTIONS[cle].test(b.consignes)) remplis.add(cle);
  }
  return remplis;
}

/* ─── La fiche qui sera écrite ────────────────────────────────────── */

const minusculeInitiale = (s: string) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const sansPoint = (s: string) => s.replace(/[.\s]+$/, "");

/** Le corps de la fiche : celui écrit par l'assistant, sinon composé avec les piliers. */
export function corpsFiche(b: BrouillonAgent): string {
  if (b.consignes) return b.consignes;
  const nom = nomPropre(b.nom) || "Nouvel agent";
  const blocs = [b.role ? `# ${nom} — ${b.role}` : `# ${nom}`];
  if (b.mission) blocs.push(b.mission);
  const section = (titre: string, items: string[], numerotee = false) => {
    if (items.length) blocs.push(`## ${titre}\n\n${items.map((t, i) => (numerotee ? `${i + 1}. ${t}` : `- ${t}`)).join("\n")}`);
  };
  section("Quand m’appeler", b.declencheurs);
  section("Ce que je livre", b.livrables);
  section("Comment je travaille", b.methode, true);
  section("Ce que je ne fais pas", b.limites);
  section("Critères de sortie", b.verification);
  return blocs.join("\n\n");
}

/** La description de l'en-tête : ce que Claude lit pour choisir l'agent. */
export function descriptionFiche(b: BrouillonAgent): string {
  if (b.description) return b.description;
  const quand = b.declencheurs.length
    ? ` Appelle ${nomPropre(b.nom) || "cet agent"} : ${b.declencheurs.map((d) => minusculeInitiale(sansPoint(d))).join(" ; ")}.`
    : "";
  return `${b.role ? `${b.role} — ` : ""}${b.mission}${quand}`.trim();
}

/** L'identifiant qu'il recevrait, avant de vérifier qu'il est libre. */
export const identifiantPropose = (b: BrouillonAgent) => b.id || identifiantDe(b.nom) || "agent";

/** Le fichier complet, tel que « Créer l'agent » l'écrira (sans mémoire, comme un nouvel agent de l'éditeur). */
export function ficheAgent(b: BrouillonAgent, id: string): string {
  return serializeAgentFile({
    frontmatter: setFields(
      { entries: [] },
      {
        name: id,
        displayName: nomPropre(b.nom) || undefined,
        description: descriptionFiche(b).replace(/\s*\n\s*/g, " "),
        model: b.modele || "opus",
      },
    ),
    body: corpsFiche(b),
  });
}

/** Le poids de la fiche, relue à chaque appel de l'agent (même estimation que l'éditeur). */
export const jetonsBrouillon = (b: BrouillonAgent) => jetonsEstimes(ficheAgent(b, identifiantPropose(b)));

/** Ce qui manque pour créer l'agent ; vide : il peut naître. */
export function manques(b: BrouillonAgent): string[] {
  return [
    !nomPropre(b.nom) && "un prénom",
    !b.role && "un rôle court",
    !(b.mission || b.description) && "sa mission",
  ].filter((m): m is string => !!m);
}

/** Ce que l'outil répond à l'assistant : où en est la carte, ce qu'il reste à demander. */
export function retourAtelier(b: BrouillonAgent, ajouts: AjoutFiche[] = []): string {
  const remplis = piliersRemplis(b);
  const reste = PILIERS.filter((p) => !remplis.has(p.cle)).map((p) => p.titre.toLowerCase());
  const jetons = jetonsBrouillon(b);
  const manque = manques(b);
  return [
    `Carte de ${nomPropre(b.nom) || "l’agent"} à jour : ${remplis.size}/5 piliers${reste.length ? ` (reste : ${reste.join(", ")})` : ""}.`,
    `Fiche estimée à ~${jetons} jetons, relus à chaque appel de l’agent${jetons > SEUIL_FICHE_LONGUE ? " : au-delà de 1 500, resserre-la" : ""}.`,
    ajouts.length ? `La personne a ajouté à la fiche (gardé, inutile de le répéter) : ${ajouts.map((a) => `« ${a.texte} »`).join(", ")}.` : "",
    remplis.size === 5 && !b.epreuve ? "Propose ensuite trois demandes pour la mettre à l’épreuve (epreuve : une normale, une floue, une hors de son métier)." : "",
    manque.length
      ? `Pour la créer, il manque : ${manque.join(", ")}.`
      : "Elle la met à l’épreuve et la crée sur la carte, ou l’ajuste dans l’éditeur : ne dis pas qu’il est créé avant qu’elle l’ait fait.",
  ]
    .filter(Boolean)
    .join(" ");
}

/* ─── L'épreuve et la suite ───────────────────────────────────────── */

/** Les trois demandes de l'épreuve, dans l'ordre. */
export function casEpreuve(b: BrouillonAgent): CasEpreuve[] | null {
  if (!b.epreuve) return null;
  return [
    { type: "normal", demande: b.epreuve.normal },
    { type: "floue", demande: b.epreuve.floue },
    { type: "hors-metier", demande: b.epreuve.horsMetier },
  ];
}

/** Les piliers dont un essai raté demande une correction pas encore ajoutée (leur étoile clignote). */
export function piliersEnAlerte(resultats: ResultatCas[] | null, ajouts: AjoutFiche[]): Set<Pilier> {
  const alerte = new Set<Pilier>();
  for (const r of resultats ?? []) {
    if (r.verdict !== "ko" || !r.correction) continue;
    const { pilier, texte: t } = r.correction;
    if (pilier === "methode") continue;
    if (!ajouts.some((a) => a.pilier === pilier && comparable(a.texte) === comparable(t))) alerte.add(pilier);
  }
  return alerte;
}

export const estPilierListe = (p: string): p is PilierListe => (PILIERS_LISTE as string[]).includes(p);

const PLANNING: Record<RoutineProposee["quand"]["type"], (q: RoutineProposee["quand"]) => RoutineSchedule> = {
  jour: (q) => ({ kind: "daily", time: q.heure }),
  "jours-ouvres": (q) => ({ kind: "weekdays", time: q.heure }),
  semaine: (q) => ({ kind: "weekly", weekday: q.jour ?? 1, time: q.heure }),
  mois: (q) => ({ kind: "monthly", day: q.jour ?? 1, time: q.heure }),
};

/** La routine proposée, prête à relire dans Automatisations (jamais enregistrée d'office). */
export function routineProposee(b: BrouillonAgent, agentId: string, fuseau: string): RoutineInput | null {
  if (!b.routine) return null;
  return {
    agentId,
    name: b.routine.nom,
    instruction: b.routine.consigne,
    schedule: PLANNING[b.routine.quand.type](b.routine.quand),
    timezone: fuseau,
    missedPolicy: "skip",
    active: true,
  };
}

/* ─── Le fil plié ─────────────────────────────────────────────────── */

export interface EtatAtelier {
  /** La série de cartes : l'étape de son premier appel. */
  serie: string;
  /** La carte avant cet appel (vide au premier de la série), et après. */
  avant: BrouillonAgent;
  apres: BrouillonAgent;
  /** Le dernier appel de sa série : lui seul montre la carte entière. */
  dernier: boolean;
  /** La couleur choisie sur la carte (la dernière de la série) ; sinon celle que l'app lui donnera. */
  teinte: RoleTeinte | null;
  /** L'agent créé depuis cette série. */
  cree: string | null;
  /** La dernière série de la conversation ; une plus ancienne, jamais créée, a été remplacée. */
  courante: boolean;
  /** Cet appel est encore en cours d'écriture par le modèle. */
  provisoire: boolean;
  /** Les phrases ajoutées par la personne dans la série (déjà dans `apres`). */
  ajouts: AjoutFiche[];
  /** La dernière épreuve passée dans la série. */
  resultats: ResultatCas[] | null;
}

/**
 * Tous les appels de l'atelier d'une conversation, pliés dans l'ordre. Une série repart de zéro
 * après un agent créé, ou quand l'assistant demande une carte neuve (`nouveau`).
 */
export function plierAteliers(messages: Message[]): Map<string, EtatAtelier> {
  const etats = new Map<string, EtatAtelier>();
  let serie: EtatAtelier[] = [];
  let derniere: EtatAtelier[] = [];
  let courant = BROUILLON_VIDE;
  let ajouts: AjoutFiche[] = [];
  const clore = () => {
    if (serie.length) derniere = serie;
    const teinte = serie.reduce<RoleTeinte | null>((t, e) => e.teinte ?? t, null);
    const cree = serie.reduce<string | null>((c, e) => e.cree ?? c, null);
    const resultats = serie.reduce<ResultatCas[] | null>((r, e) => e.resultats ?? r, null);
    serie.forEach((e, i) => {
      e.teinte = teinte;
      e.cree = cree;
      e.resultats = resultats;
      e.ajouts = ajouts;
      e.dernier = i === serie.length - 1;
    });
    serie = [];
    ajouts = [];
    courant = BROUILLON_VIDE;
  };
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "atelier-agent") continue;
      if (part.maj.nouveau || serie.some((e) => e.cree)) clore();
      const avant = serie.at(-1)?.apres ?? BROUILLON_VIDE;
      courant = appliquerMaj(courant, part.maj);
      ajouts = [...ajouts, ...(part.ajouts ?? [])];
      const etat: EtatAtelier = {
        serie: serie[0]?.serie ?? part.etapeId,
        avant,
        apres: appliquerAjouts(courant, ajouts),
        dernier: false,
        teinte: part.teinte ?? null,
        cree: part.cree ?? null,
        courante: false,
        provisoire: !!part.provisoire,
        ajouts: [],
        resultats: part.resultats ?? null,
      };
      serie.push(etat);
      etats.set(part.etapeId, etat);
    }
  }
  clore();
  derniere.forEach((e) => (e.courante = true));
  return etats;
}

/** La carte en cours de la conversation (celle que l'appel suivant complétera), et ce que la personne y a ajouté. */
export function atelierEnCours(messages: Message[]): { brouillon: BrouillonAgent; ajouts: AjoutFiche[] } {
  const etats = [...plierAteliers(messages).values()];
  const dernier = etats.at(-1);
  return dernier && !dernier.cree ? { brouillon: dernier.apres, ajouts: dernier.ajouts } : { brouillon: BROUILLON_VIDE, ajouts: [] };
}

export const brouillonEnCours = (messages: Message[]) => atelierEnCours(messages).brouillon;

/** Les piliers que cet appel vient de remplir. */
export function piliersNouveaux(etat: Pick<EtatAtelier, "avant" | "apres">): Pilier[] {
  const avant = piliersRemplis(etat.avant);
  return [...piliersRemplis(etat.apres)].filter((p) => !avant.has(p));
}

/* ─── Réponses toutes prêtes ──────────────────────────────────────── */

export interface Choix {
  question: string;
  options: string[];
  multiple: boolean;
}

/** Les réponses proposées par `proposer_choix` : 2 à 6, distinctes, 120 caractères au plus. */
export function lireChoix(entree: Record<string, unknown>): Choix | null {
  if (!Array.isArray(entree.options)) return null;
  const vues = new Set<string>();
  const options = entree.options
    .map((o) => texte(o, 120) ?? "")
    .filter((o) => {
      const cle = comparable(o);
      if (!cle || vues.has(cle)) return false;
      vues.add(cle);
      return true;
    });
  if (options.length < 2 || options.length > 6) return null;
  return { question: texte(entree.question, 300) ?? "", options, multiple: entree.multiple === true };
}

/** Le message envoyé quand on choisit : les réponses, dans l'ordre proposé. */
export const texteDuChoix = (choisies: string[]) => choisies.join(" · ");

/** Les options que la réponse de la personne reprend (pour les montrer choisies). */
export function optionsRetenues(options: string[], reponse: string): Set<string> {
  const r = comparable(reponse);
  return new Set(options.filter((o) => r.includes(comparable(o))));
}
