import type { BrouillonAgent, MajAtelier, Message, RoleTeinte } from "@/types/domain";
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
};

/** La carte après un appel : chaque champ donné remplace le précédent, `nouveau` repart de zéro. */
export function appliquerMaj(brouillon: BrouillonAgent, maj: MajAtelier): BrouillonAgent {
  const { nouveau, ...champs } = maj;
  const depart = nouveau ? BROUILLON_VIDE : brouillon;
  return { ...depart, ...Object.fromEntries(Object.entries(champs).filter(([, v]) => v !== undefined)) };
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
export function retourAtelier(b: BrouillonAgent): string {
  const remplis = piliersRemplis(b);
  const reste = PILIERS.filter((p) => !remplis.has(p.cle)).map((p) => p.titre.toLowerCase());
  const jetons = jetonsBrouillon(b);
  const manque = manques(b);
  return [
    `Carte de ${nomPropre(b.nom) || "l’agent"} à jour : ${remplis.size}/5 piliers${reste.length ? ` (reste : ${reste.join(", ")})` : ""}.`,
    `Fiche estimée à ~${jetons} jetons, relus à chaque appel de l’agent${jetons > SEUIL_FICHE_LONGUE ? " : au-delà de 1 500, resserre-la" : ""}.`,
    manque.length
      ? `Pour la créer, il manque : ${manque.join(", ")}.`
      : "Elle la crée d’un clic sur la carte (« Créer l’agent ») ou l’ajuste dans l’éditeur : ne dis pas qu’il est créé avant qu’elle l’ait fait.",
  ].join(" ");
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
  const clore = () => {
    if (serie.length) derniere = serie;
    const teinte = serie.reduce<RoleTeinte | null>((t, e) => e.teinte ?? t, null);
    const cree = serie.reduce<string | null>((c, e) => e.cree ?? c, null);
    serie.forEach((e, i) => {
      e.teinte = teinte;
      e.cree = cree;
      e.dernier = i === serie.length - 1;
    });
    serie = [];
    courant = BROUILLON_VIDE;
  };
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "atelier-agent") continue;
      if (part.maj.nouveau || serie.some((e) => e.cree)) clore();
      const apres = appliquerMaj(courant, part.maj);
      const etat: EtatAtelier = {
        serie: serie[0]?.serie ?? part.etapeId,
        avant: courant,
        apres,
        dernier: false,
        teinte: part.teinte ?? null,
        cree: part.cree ?? null,
        courante: false,
      };
      serie.push(etat);
      etats.set(part.etapeId, etat);
      courant = apres;
    }
  }
  clore();
  derniere.forEach((e) => (e.courante = true));
  return etats;
}

/** La carte en cours de la conversation (celle que l'appel suivant complétera), ou une carte vide. */
export function brouillonEnCours(messages: Message[]): BrouillonAgent {
  const etats = [...plierAteliers(messages).values()];
  const dernier = etats.at(-1);
  return dernier && !dernier.cree ? dernier.apres : BROUILLON_VIDE;
}

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
