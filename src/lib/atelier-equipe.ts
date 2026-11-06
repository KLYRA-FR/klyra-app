import { comparable, nomDejaPris, nomPropre } from "@/lib/noms-agents";
import type { Message, MessagePart, Role, RoleTeinte } from "@/types/domain";
import type { BrouillonAgent } from "../../electron/atelier-agent";
import {
  agentDuMembre,
  appliquerChoix,
  appliquerMajEquipe,
  EQUIPE_VIDE,
  jetonsEquipe,
  manquesEquipe,
  tacheProposee,
  type BrouillonEquipe,
  type MembreBrouillon,
} from "../../electron/atelier-equipe";

export * from "../../electron/atelier-equipe";

/**
 * L'atelier d'une équipe, côté écran : les règles communes au PC et au VPS sont dans
 * electron/atelier-equipe.ts (réexportées ici) ; ici, le fil plié (chaque appel gardé tel quel dans
 * la conversation) et ce que la personne a choisi sur la carte.
 */

export interface EtatEquipe {
  /** La série de cartes : l'étape de son premier appel. */
  serie: string;
  /** La carte avant cet appel (vide au premier de la série), et après. */
  avant: BrouillonEquipe;
  apres: BrouillonEquipe;
  /** Le dernier appel de sa série : lui seul montre la carte entière. */
  dernier: boolean;
  /** La dernière série de la conversation ; une plus ancienne, jamais créée, a été remplacée. */
  courante: boolean;
  /** Cet appel est encore en cours d'écriture par le modèle. */
  provisoire: boolean;
  /** La couleur choisie pour chaque membre (par sa clé). */
  teintes: Record<string, RoleTeinte>;
  /** Les membres que la personne laisse de côté (par leur clé). */
  ecartes: string[];
  /** Les agents créés depuis cette série : la clé du membre, l'id de son agent. */
  crees: Record<string, string>;
}

type PartEquipe = Extract<MessagePart, { type: "atelier-equipe" }>;
const estEquipe = (p: { type: string }): p is PartEquipe => p.type === "atelier-equipe";

/**
 * Tous les appels de l'atelier d'équipe d'une conversation, pliés dans l'ordre. Une série repart de
 * zéro après une équipe créée, ou quand l'assistant demande une carte neuve (`nouveau`).
 */
export function plierEquipes(messages: readonly { parts: readonly { type: string }[] }[]): Map<string, EtatEquipe> {
  const etats = new Map<string, EtatEquipe>();
  let serie: EtatEquipe[] = [];
  let derniere: EtatEquipe[] = [];
  let courant = EQUIPE_VIDE;
  // Le dernier choix de la personne dans la série (noté sur la carte affichée à ce moment-là).
  let ecartes: string[] = [];
  const clore = () => {
    if (serie.length) derniere = serie;
    const teintes = Object.assign({}, ...serie.map((e) => e.teintes)) as Record<string, RoleTeinte>;
    const crees = Object.assign({}, ...serie.map((e) => e.crees)) as Record<string, string>;
    const choix = ecartes;
    serie.forEach((e, i) => {
      e.teintes = teintes;
      e.crees = crees;
      e.ecartes = choix;
      e.dernier = i === serie.length - 1;
    });
    serie = [];
    ecartes = [];
    courant = EQUIPE_VIDE;
  };
  for (const message of messages) {
    for (const part of message.parts) {
      if (!estEquipe(part)) continue;
      if (part.maj.nouveau || serie.some((e) => Object.keys(e.crees).length)) clore();
      const avant = serie.at(-1)?.apres ?? EQUIPE_VIDE;
      // Ce que la personne a fait sur cette carte s'applique juste après l'appel : un appel suivant passe par-dessus.
      courant = appliquerChoix(appliquerMajEquipe(courant, part.maj), part.choix);
      const etat: EtatEquipe = {
        serie: serie[0]?.serie ?? part.etapeId,
        avant,
        apres: courant,
        dernier: false,
        courante: false,
        provisoire: !!part.provisoire,
        teintes: part.teintes ?? {},
        ecartes: part.ecartes ?? [],
        crees: part.crees ?? {},
      };
      if (part.ecartes) ecartes = part.ecartes;
      serie.push(etat);
      etats.set(part.etapeId, etat);
    }
  }
  clore();
  derniere.forEach((e) => (e.courante = true));
  return etats;
}

/** La carte d'équipe en cours de la conversation (celle que l'appel suivant complétera). */
export function equipeEnCours(messages: Message[]): BrouillonEquipe {
  const dernier = [...plierEquipes(messages).values()].at(-1);
  return dernier && !Object.keys(dernier.crees).length ? dernier.apres : EQUIPE_VIDE;
}

/** L'appel qui montre la carte d'équipe de la conversation (le dernier de la dernière série), avec son message. */
export function equipeAffichee(messages: readonly { id: string; parts: readonly MessagePart[] }[]): { etat: EtatEquipe; messageId: string; etapeId: string } | null {
  const etats = plierEquipes(messages);
  for (let i = messages.length - 1; i >= 0; i--) {
    for (let j = messages[i].parts.length - 1; j >= 0; j--) {
      const part = messages[i].parts[j];
      if (!estEquipe(part)) continue;
      const etat = etats.get(part.etapeId);
      return etat?.dernier && etat.courante ? { etat, messageId: messages[i].id, etapeId: part.etapeId } : null;
    }
  }
  return null;
}

/** Les membres que cet appel a ajoutés ou changés (l'atelier plein écran les montre à jour). */
export const membresTouches = (etat: Pick<EtatEquipe, "avant" | "apres">): string[] =>
  etat.apres.membres
    .filter((m) => {
      const avant = etat.avant.membres.find((x) => x.cle === m.cle);
      return !avant || JSON.stringify(avant.agent) !== JSON.stringify(m.agent);
    })
    .map((m) => m.cle);

/** Les membres que cet appel vient d'ajouter à la carte. */
export const membresNouveaux = (etat: Pick<EtatEquipe, "avant" | "apres">): MembreBrouillon[] =>
  etat.apres.membres.filter((m) => !etat.avant.membres.some((x) => x.cle === m.cle));

/** Ce que la personne garde : les membres qu'elle n'a pas laissés de côté. */
export const membresGardes = (etat: Pick<EtatEquipe, "apres" | "ecartes">) => etat.apres.membres.filter((m) => !etat.ecartes.includes(m.cle));

/* ─── Ce que la carte montre de chaque membre (bureau et téléphone) ── */

/** Un agent de Mes agents, tel que la carte le compare à un membre. */
type AgentConnu = Pick<Role, "id" | "name" | "tag" | "teinte">;

/** Un membre tel que la carte le montre : sa teinte, s'il est déjà né, s'il est laissé de côté. */
export interface MembreVu {
  m: MembreBrouillon;
  /** L'agent tel que sa fiche sera écrite (sans les lignes proposées qu'elle n'a pas gardées). */
  fiche: BrouillonAgent;
  /** Son prénom, sinon vide : il attend le sien. */
  nom: string;
  teinte: RoleTeinte;
  /** L'agent né de ce membre (par cette carte, ou par sa propre carte), sinon null. */
  idCree: string | null;
  ecarte: boolean;
  /** Un autre agent porte déjà ce prénom. */
  pris: AgentConnu | null;
}

export function membresVus(etat: Pick<EtatEquipe, "apres" | "crees" | "teintes" | "ecartes">, roles: AgentConnu[], teinteDe: (id: string) => RoleTeinte): MembreVu[] {
  return etat.apres.membres.map((m) => {
    const dejaLa = m.agent.nom ? (roles.find((r) => r.id === m.cle && comparable(r.name) === comparable(m.agent.nom)) ?? null) : null;
    const idCree = etat.crees[m.cle] ?? dejaLa?.id ?? null;
    const agent = idCree ? (roles.find((r) => r.id === idCree) ?? null) : null;
    return {
      m,
      fiche: agentDuMembre(etat.apres, m),
      nom: nomPropre(agent?.name ?? m.agent.nom),
      teinte: agent?.teinte ?? etat.teintes[m.cle] ?? teinteDe(m.cle),
      idCree,
      ecarte: !idCree && etat.ecartes.includes(m.cle),
      pris: !idCree && m.agent.nom ? nomDejaPris(m.agent.nom, roles as Role[]) : null,
    };
  });
}

/** Où en est l'équipe : qui reste à créer, qui est né, ce qui manque, le poids des fiches à écrire. */
export function bilanEquipe(etat: Pick<EtatEquipe, "apres" | "crees" | "courante">, vus: MembreVu[]) {
  const aCreer = vus.filter((x) => !x.idCree && !x.ecarte);
  const nes = vus.filter((x) => x.idCree);
  const creeIci = Object.keys(etat.crees).length > 0;
  return {
    aCreer,
    nes,
    /** Toute l'équipe gardée est née (par cette carte, ou chacun par la sienne). */
    nee: nes.length > 0 && !aCreer.length,
    /** Une plus ancienne, dont rien n'est né : l'assistant en a composé une autre. */
    remplacee: !creeIci && !etat.courante,
    manques: [
      ...(etat.apres.taches ?? []).some(tacheProposee) ? ["ta réponse aux propositions de l’assistant"] : [],
      ...manquesEquipe(etat.apres, aCreer.map((x) => x.m)),
      ...aCreer.filter((x) => x.pris).map((x) => `un autre prénom que ${x.pris!.name} pour ${x.nom}`),
    ],
    jetons: jetonsEquipe(etat.apres, aCreer.map((x) => x.m)),
  };
}

/** Un identifiant libre pour chaque membre à créer, distinct de ceux que la même équipe prend. */
export function identifiantsLibres(cles: string[], identifiantLibre: (propose: string) => string): string[] {
  const utilises = new Set<string>();
  return cles.map((cle) => {
    let id = identifiantLibre(cle);
    for (let n = 2; utilises.has(id); n++) id = identifiantLibre(`${cle}-${n}`);
    utilises.add(id);
    return id;
  });
}

/* ─── Ce que la personne valide, écrit pour l'assistant ───────────── */

const puces = (l: string[]) => l.map((t) => `- ${t}`).join("\n");

/** « Valider mes tâches » : ses tâches telles qu'elle les a gardées, ce qu'elle garde pour elle. */
export function texteTachesValidees(b: BrouillonEquipe): string {
  const taches = (b.taches ?? []).filter((t) => !tacheProposee(t));
  const deleguees = taches.filter((t) => !t.pourElle).map((t) => t.texte);
  const pourElle = taches.filter((t) => t.pourElle).map((t) => t.texte);
  return [`Mes tâches sont prêtes :\n${puces(deleguees)}`, pourElle.length ? `Je garde pour moi :\n${puces(pourElle)}` : ""].filter(Boolean).join("\n\n");
}

/** « Valider les groupes » : chaque groupe et ses tâches, après ce qu'elle a déplacé. */
export function texteGroupesValides(b: BrouillonEquipe): string {
  const groupes = (b.groupes ?? [])
    .map((g) => ({ g, taches: (b.taches ?? []).filter((t) => !t.pourElle && t.groupe === g.id && !tacheProposee(t)) }))
    .filter((x) => x.taches.length);
  const pourElle = (b.taches ?? []).filter((t) => t.pourElle).map((t) => t.texte);
  const lignes = groupes.map((x) => `- ${x.g.nom || x.g.id} : ${x.taches.map((t) => t.texte).join(" ; ")}`);
  return [
    `Mes groupes sont prêts, un agent par groupe :\n${lignes.join("\n")}`,
    pourElle.length ? `Je garde pour moi : ${pourElle.join(" ; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Une étape est prête à valider : rien n'attend sa réponse, et chaque tâche à confier est rangée. */
export function pretAValider(b: BrouillonEquipe, etape: "taches" | "groupes"): string | null {
  const taches = b.taches ?? [];
  if (taches.some(tacheProposee)) return "Garde ou retire d’abord les propositions de l’assistant.";
  if (!taches.some((t) => !t.pourElle)) return "Il faut au moins une tâche à confier.";
  if (etape === "groupes" && taches.some((t) => !t.pourElle && !t.groupe)) return "Range chaque tâche dans un groupe, ou garde-la pour toi.";
  return null;
}

