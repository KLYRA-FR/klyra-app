import type { Message, RoleTeinte } from "@/types/domain";
import type { RoutineInput, RoutineSchedule } from "@/types/routines";
import {
  appliquerAjouts,
  appliquerMaj,
  BROUILLON_VIDE,
  piliersRemplis,
  type AjoutFiche,
  type BrouillonAgent,
  type Pilier,
  type RoutineProposee,
} from "../../electron/atelier-agent";
import type { ResultatCas } from "../../electron/epreuve";

export * from "../../electron/atelier-agent";

/**
 * L'atelier d'un agent, côté écran : les règles communes au PC et au VPS sont dans
 * electron/atelier-agent.ts (réexportées ici) ; ici, le fil plié (chaque appel gardé tel quel dans la
 * conversation) et la routine proposée, prête pour Automatisations.
 */

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

