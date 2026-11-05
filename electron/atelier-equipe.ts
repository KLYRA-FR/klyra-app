import {
  appliquerMaj,
  BROUILLON_VIDE,
  comparable,
  identifiantDe,
  identifiantPropre,
  jetonsBrouillon,
  lireMajAtelier,
  manques,
  nomPropre,
  piliersRemplis,
  PILIERS,
  type BrouillonAgent,
  type MajAtelier,
  type MembreEquipe,
  type VoisinAgent,
} from "./atelier-agent";

/**
 * L'atelier d'une équipe, dans la conversation avec l'assistant : il comprend l'activité de la
 * personne, puis compose avec elle plusieurs agents d'un coup (outil `proposer_equipe`). Chaque appel
 * est gardé tel quel dans le fil ; la carte d'équipe les plie dans l'ordre. Rien n'est écrit sur le
 * disque avant « Créer l'équipe ». Un membre s'affine avec l'atelier d'un agent (`proposer_agent`,
 * même identifiant) : créé par sa propre carte, il est déjà dans l'équipe quand elle naît.
 *
 * Module pur, le même pour ce PC (electron/ia.ts, l'écran par src/lib/atelier-equipe.ts) et pour un
 * VPS (généré en serveur/atelier-equipe.mjs par scripts/serveur-genere.mjs).
 */

/* ─── Les formes ──────────────────────────────────────────────────── */

/** Ce qu'un appel apprend d'un membre : les champs de l'atelier d'un agent, ou son retrait. */
export type MajMembre = Omit<MajAtelier, "nouveau" | "epreuve" | "voisins" | "routine" | "consignes"> & { retirer?: boolean };

/** Une demande réelle de la personne, et l'agent qui en serait seul responsable (un membre, un agent actif, ou l'assistant). */
export interface ExempleEquipe {
  demande: string;
  membre: string;
}

/**
 * Ce qu'un appel à `proposer_equipe` apprend. `membres` : chaque membre donné complète celui qui a
 * le même identifiant (ou le même prénom), les autres restent ; `existants` et `exemples` remplacent
 * les précédents ; `nouveau` repart d'une carte vide.
 */
export interface MajEquipe {
  nouveau?: boolean;
  nom?: string;
  but?: string;
  membres?: MajMembre[];
  existants?: VoisinAgent[];
  exemples?: ExempleEquipe[];
}

/** Un membre de l'équipe en préparation : sa clé (son identifiant, qui ne change plus) et sa carte. */
export interface MembreBrouillon {
  cle: string;
  agent: BrouillonAgent;
}

export interface BrouillonEquipe {
  nom: string;
  but: string;
  membres: MembreBrouillon[];
  /** Ses agents actifs qui gardent leur place dans cette équipe, et ce qu'ils y font. */
  existants: VoisinAgent[];
  exemples: ExempleEquipe[];
}

export const EQUIPE_VIDE: BrouillonEquipe = { nom: "", but: "", membres: [], existants: [], exemples: [] };

/** Au-delà, une équipe se pilote mal : l'assistant ne confie que trois travaux à la fois. */
export const MAX_MEMBRES = 6;

/* ─── L'outil de l'assistant ──────────────────────────────────────── */

const tableau = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const OUTIL_EQUIPE = {
  name: "proposer_equipe",
  description:
    "Montre et complète, dans la conversation, la carte d'une équipe d'agents à créer avec la personne : un agent par métier, ses agents actifs qui en font partie, et qui serait responsable de quelques-unes de ses vraies demandes. Appelle-le après chaque réponse utile, avec seulement ce que tu viens d'apprendre : un membre donné complète celui qui a le même id (garde-le d'un appel à l'autre), les autres restent ; retirer: true l'enlève. C'est la personne qui choisit qui garder et crée l'équipe d'un clic sur la carte : rien n'est créé par cet outil. Phrases courtes, écrites comme les fiches les diront. N'y répète pas ce que l'app donne déjà à chaque agent.",
  inputSchema: {
    type: "object",
    properties: {
      nouveau: { type: "boolean", description: "true pour commencer la carte d'une autre équipe." },
      nom: { type: "string", description: "Le nom de l'équipe (ex. Studio contenu)." },
      but: { type: "string", description: "Ce que l'équipe fait pour elle, en une phrase." },
      membres: {
        type: "array",
        description: `Les agents à créer, ${MAX_MEMBRES} au plus : chacun un métier distinct.`,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Identifiant stable : minuscules, chiffres et tirets. Sinon tiré du prénom." },
            nom: { type: "string", description: "Son prénom." },
            role: { type: "string", description: "Son rôle court." },
            mission: { type: "string", description: "Sa mission, en une phrase." },
            declencheurs: tableau("Quand l'appeler."),
            livrables: tableau("Ce qu'il rend."),
            methode: tableau("Comment il travaille : 3 à 5 règles."),
            limites: tableau("Ce qu'il ne fait pas, ou seulement avec l'accord de la personne."),
            verification: tableau("Comment il vérifie son travail."),
            modele: { type: "string", enum: ["opus", "sonnet", "haiku"], description: "Seulement si la personne l'a choisi." },
            retirer: { type: "boolean", description: "true pour le retirer de l'équipe." },
          },
        },
      },
      existants: {
        type: "array",
        description: "Ses agents actifs qui font partie de cette équipe, tels quels.",
        items: { type: "object", properties: { id: { type: "string" }, raison: { type: "string", description: "Ce qu'il y fait, en une phrase." } }, required: ["id", "raison"] },
      },
      exemples: {
        type: "array",
        description: "3 à 5 de ses vraies demandes, chacune avec l'agent qui en serait seul responsable (id d'un membre, d'un agent actif, ou principal pour toi).",
        items: { type: "object", properties: { demande: { type: "string" }, membre: { type: "string" } }, required: ["demande", "membre"] },
      },
    },
  },
};

/** Ce que l'assistant apprend de l'atelier d'équipe, avec celui d'un agent (CONSIGNE_ATELIER). */
export const CONSIGNE_EQUIPE = `Pour composer une équipe (plusieurs agents d'un coup) : demande d'abord ce qui revient dans sa semaine, une question à la fois (proposer_choix), puis montre et complète l'équipe avec proposer_equipe : 2 à 5 agents d'un métier chacun, sans doublon de ses agents actifs. Elle la crée sur la carte ; un membre s'affine dans son propre atelier (proposer_agent, même id).`;

/* ─── Lecture de l'outil ──────────────────────────────────────────── */

const texte = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : undefined);

/** La clé d'un membre : son identifiant, sinon tiré de son prénom. */
export const cleMembre = (m: { id?: string; nom?: string }) => (m.id ? identifiantPropre(m.id) : "") || (m.nom ? identifiantDe(m.nom) : "");

function lireMembre(v: unknown): MajMembre | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  // Les champs d'un agent, lus comme dans son atelier (sans ce qui n'a pas sa place dans une équipe).
  const { nouveau: _n, epreuve: _e, voisins: _v, routine: _r, consignes: _c, ...champs } = lireMajAtelier(o) ?? {};
  void _n;
  void _e;
  void _v;
  void _r;
  void _c;
  const membre: MajMembre = { ...champs, ...(o.retirer === true ? { retirer: true } : {}) };
  return cleMembre(membre) ? membre : null;
}

/** Ce qu'un appel à `proposer_equipe` apprend ; `null` s'il n'apprend rien. */
export function lireMajEquipe(entree: Record<string, unknown>): MajEquipe | null {
  const maj: MajEquipe = {};
  if (entree.nouveau === true) maj.nouveau = true;
  const nom = texte(entree.nom, 60);
  if (nom !== undefined) maj.nom = nom;
  const but = texte(entree.but, 300);
  if (but !== undefined) maj.but = but;
  if (Array.isArray(entree.membres)) {
    const membres = entree.membres.map(lireMembre).filter((m): m is MajMembre => !!m);
    if (membres.length) maj.membres = membres.slice(0, MAX_MEMBRES * 2);
  }
  if (Array.isArray(entree.existants)) {
    maj.existants = entree.existants
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
      .map((x) => ({ id: identifiantPropre(texte(x.id, 64) ?? ""), raison: texte(x.raison, 200) ?? "" }))
      .filter((x) => x.id && x.raison)
      .slice(0, 6);
  }
  if (Array.isArray(entree.exemples)) {
    maj.exemples = entree.exemples
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
      .map((x) => ({ demande: texte(x.demande, 200) ?? "", membre: texte(x.membre, 64) ?? "" }))
      .filter((x) => x.demande && x.membre)
      .slice(0, 6);
  }
  return Object.keys(maj).length ? maj : null;
}

/* ─── La carte après un appel ─────────────────────────────────────── */

/** Le membre que désigne une clé ou un prénom. */
function trouverMembre(membres: MembreBrouillon[], m: { id?: string; nom?: string }): number {
  const cle = cleMembre(m);
  const parCle = membres.findIndex((x) => x.cle === cle);
  if (parCle !== -1 || m.id) return parCle;
  const nom = m.nom ? comparable(m.nom) : "";
  return nom ? membres.findIndex((x) => comparable(x.agent.nom) === nom) : -1;
}

/** Le responsable d'un exemple, ramené à une clé connue (membre, agent actif, assistant) si possible. */
function cleResponsable(b: Pick<BrouillonEquipe, "membres">, membre: string): string {
  const cible = comparable(membre);
  const parCle = identifiantPropre(membre);
  const m = b.membres.find((x) => x.cle === parCle || comparable(x.agent.nom) === cible);
  if (m) return m.cle;
  return parCle;
}

/** La carte après un appel : chaque membre donné complète le sien, `nouveau` repart de zéro. */
export function appliquerMajEquipe(brouillon: BrouillonEquipe, maj: MajEquipe): BrouillonEquipe {
  const depart = maj.nouveau ? EQUIPE_VIDE : brouillon;
  let membres = depart.membres;
  for (const m of maj.membres ?? []) {
    const i = trouverMembre(membres, m);
    if (m.retirer) {
      if (i !== -1) membres = membres.filter((_, j) => j !== i);
      continue;
    }
    const { retirer: _r, ...champs } = m;
    void _r;
    if (i === -1) {
      const cle = cleMembre(m);
      membres = [...membres, { cle, agent: { ...appliquerMaj(BROUILLON_VIDE, champs), id: cle } }];
    } else {
      // L'identifiant d'un membre ne change plus : un autre id donné n'en fait pas un autre agent.
      const { id: _id, ...reste } = champs;
      void _id;
      membres = membres.map((x, j) => (j === i ? { ...x, agent: { ...appliquerMaj(x.agent, reste), id: x.cle } } : x));
    }
  }
  const suite: BrouillonEquipe = {
    nom: maj.nom ?? depart.nom,
    but: maj.but ?? depart.but,
    membres,
    existants: maj.existants ?? depart.existants,
    exemples: depart.exemples,
  };
  const exemples = maj.exemples ?? depart.exemples;
  return { ...suite, exemples: exemples.map((e) => ({ ...e, membre: cleResponsable(suite, e.membre) })) };
}

/* ─── Ce que la carte montre ──────────────────────────────────────── */

/** Les jetons de toutes les fiches de l'équipe (chacune relue quand son agent est appelé). */
export const jetonsEquipe = (b: BrouillonEquipe, membres: MembreBrouillon[] = b.membres) => membres.reduce((t, m) => t + jetonsBrouillon(m.agent), 0);

/** Ce qui manque à chaque membre pour naître (vide : il peut naître). */
export const manquesMembre = (m: MembreBrouillon) => manques(m.agent);

/** Ce qui manque à l'équipe pour naître, avec les membres choisis. */
export function manquesEquipe(b: BrouillonEquipe, choisis: MembreBrouillon[]): string[] {
  if (!choisis.length) return [b.membres.length ? "au moins un agent gardé" : "au moins un agent"];
  return choisis.flatMap((m) => {
    const manque = manquesMembre(m);
    return manque.length ? [`${manque.join(", ")} à ${nomPropre(m.agent.nom) || m.cle}`] : [];
  });
}

/* ─── Vérifier un appel, suivre une conversation ──────────────────── */

const nomsPris = (equipe: MembreEquipe[], nom: string) => {
  const cible = comparable(nom);
  return cible ? (equipe.find((m) => [m.id, ...m.noms].some((n) => comparable(n) === cible)) ?? null) : null;
};

/**
 * Ce qui refuse un appel : un membre nouveau dont l'identifiant ou le prénom est déjà dans Mes agents
 * (il va dans `existants`), deux membres du même prénom, un agent cité hors de l'équipe, trop de membres.
 * Un membre déjà sur la carte reste accepté s'il a été créé entre-temps par sa propre carte.
 */
export function refusEquipe(maj: MajEquipe, avant: BrouillonEquipe, apres: BrouillonEquipe, equipe: MembreEquipe[]): string | null {
  const deja = new Set((maj.nouveau ? EQUIPE_VIDE : avant).membres.map((m) => m.cle));
  for (const m of maj.membres ?? []) {
    if (m.retirer) continue;
    const i = trouverMembre(apres.membres, m);
    const cle = i === -1 ? cleMembre(m) : apres.membres[i].cle;
    if (deja.has(cle)) continue;
    if (equipe.some((e) => e.id === cle)) return `« ${cle} » est déjà dans Mes agents : mets-le dans existants, ou donne un autre id.`;
    const pris = m.nom ? nomsPris(equipe, m.nom) : null;
    if (pris) return `Elle a déjà un agent qui s’appelle ${pris.noms[0] ?? pris.id} : mets-le dans existants, ou propose un autre prénom.`;
  }
  if (apres.membres.length > MAX_MEMBRES) return `${MAX_MEMBRES} agents au plus dans une équipe : regroupe des métiers, ou retire un membre.`;
  const vus = new Map<string, string>();
  for (const m of apres.membres) {
    const nom = comparable(m.agent.nom);
    if (!nom) continue;
    if (vus.has(nom)) return `Deux agents s’appellent ${nomPropre(m.agent.nom)} : donne-leur deux prénoms.`;
    vus.set(nom, m.cle);
  }
  const inconnu = apres.existants.find((v) => !equipe.some((e) => e.id === v.id));
  if (inconnu) return `« ${inconnu.id} » n’est pas un de ses agents actifs : ne cite dans existants que ceux de Mes agents.`;
  const connus = new Set(["principal", ...apres.membres.map((m) => m.cle), ...equipe.map((e) => e.id)]);
  const perdu = apres.exemples.find((e) => !connus.has(e.membre));
  if (perdu) return `« ${perdu.membre} » n’est ni un membre de l’équipe ni un de ses agents : donne pour chaque exemple l’id de son responsable.`;
  return null;
}

/** Ce que l'outil répond à l'assistant : où en est l'équipe, ce qu'il reste à demander. */
export function retourEquipe(b: BrouillonEquipe): string {
  const membres = b.membres.map((m) => {
    const remplis = piliersRemplis(m.agent);
    const reste = PILIERS.filter((p) => !remplis.has(p.cle)).map((p) => p.titre.toLowerCase());
    return `${nomPropre(m.agent.nom) || m.cle} (${m.cle}${m.agent.role ? `, ${m.agent.role}` : ""}) ${remplis.size}/5${reste.length ? `, reste : ${reste.join(", ")}` : ""}`;
  });
  const manque = b.membres.flatMap((m) => {
    const l = manquesMembre(m);
    return l.length ? [`${nomPropre(m.agent.nom) || m.cle} : ${l.join(", ")}`] : [];
  });
  const jetons = jetonsEquipe(b);
  return [
    `Équipe${b.nom ? ` « ${b.nom} »` : ""} à jour : ${b.membres.length} agent${b.membres.length > 1 ? "s" : ""}${membres.length ? ` — ${membres.join(" ; ")}` : ""}.`,
    b.existants.length ? `Avec ses agents actifs : ${b.existants.map((e) => e.id).join(", ")}.` : "",
    b.membres.length ? `Fiches estimées à ~${jetons} jetons en tout, chacune relue quand son agent est appelé.` : "",
    manque.length ? `Pour naître, il manque : ${manque.join(" ; ")}.` : "",
    b.membres.length >= 2 && b.exemples.length < 3 ? "Ajoute 3 à 5 de ses vraies demandes dans exemples, chacune avec son responsable." : "",
    "Elle choisit qui garder et crée l’équipe sur la carte : ne dis pas qu’elle est créée avant qu’elle l’ait fait.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** L'agent d'un membre est maintenant dans l'équipe (créé sur le PC, par la carte d'équipe ou la sienne). */
export const membreNe = (m: MembreBrouillon, equipe: MembreEquipe[]) =>
  !!m.agent.nom && equipe.some((e) => e.id === m.cle && e.noms.some((n) => comparable(n) === comparable(m.agent.nom)));

/**
 * Un appel de plus dans une conversation suivie par un serveur (un VPS n'a pas le fil) : la carte
 * repart de zéro avec `nouveau`, ou quand un de ses agents est maintenant dans l'équipe (créée sur le PC).
 */
export function suivreEquipe(suivi: BrouillonEquipe, maj: MajEquipe, equipe: MembreEquipe[]): BrouillonEquipe {
  const nee = suivi.membres.some((m) => membreNe(m, equipe));
  return appliquerMajEquipe(nee ? EQUIPE_VIDE : suivi, maj);
}

const REFUS_VIDE = "Rien à mettre sur la carte : donne au moins un champ (nom, but, membres, existants, exemples).";

/**
 * Un appel à `proposer_equipe`, le même sur ce PC et sur un VPS : ce que l'outil répond à l'assistant,
 * refus compris, et la carte suivie après l'appel (les réponses toutes prêtes restent à appelAtelier).
 */
export function appelEquipe(args: Record<string, unknown>, suivi: BrouillonEquipe, equipe: MembreEquipe[]): { texte: string; erreur: boolean; suivi: BrouillonEquipe } {
  const maj = lireMajEquipe(args);
  if (!maj) return { texte: REFUS_VIDE, erreur: true, suivi };
  const apres = suivreEquipe(suivi, maj, equipe);
  const avant = suivi.membres.some((m) => membreNe(m, equipe)) ? EQUIPE_VIDE : suivi;
  const refus = refusEquipe(maj, avant, apres, equipe);
  if (refus) return { texte: refus, erreur: true, suivi };
  return { texte: retourEquipe(apres), erreur: false, suivi: apres };
}

export const OUTIL_EQUIPE_CLAUDE = `mcp__klyra__${OUTIL_EQUIPE.name}`;
