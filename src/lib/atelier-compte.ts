import {
  casEpreuve,
  ficheAgent,
  identifiantPropose,
  jetonsBrouillon,
  manques,
  piliersEnAlerte,
  piliersNouveaux,
  piliersRemplis,
  routineProposee,
  type EtatAtelier,
  type Pilier,
} from "@/lib/atelier-agent";
import { bilanEquipe, membresNouveaux, membresVus, type EtatEquipe } from "@/lib/atelier-equipe";
import { comparable, nomDejaPris, nomPropre } from "@/lib/noms-agents";
import { libellePlanning } from "@/lib/routines-affichage";
import type { Role, RoleTeinte } from "@/types/domain";
import type { RoutineSchedule } from "@/types/routines";
import { empreinteFiche, type CasEpreuve, type PilierListe, type TypeCas } from "../../electron/epreuve";

/**
 * L'atelier d'un agent tel que le téléphone le reçoit (copie du compte, spec mobile M-4). C'est
 * l'ordinateur qui plie les appels (`plierAteliers`) et calcule la carte : le téléphone l'affiche
 * telle quelle et ne fait que demander un geste (`atelier.*`, cf. src/lib/telephone/gestes-atelier.ts).
 * Rien n'est recalculé sur le téléphone, rien de ce qu'il envoie n'est cru par l'ordinateur.
 */

/** Un appel plus ancien de la série : une ligne. */
export interface LigneAtelierCompte {
  id: string;
  nom: string;
  teinte: RoleTeinte;
  nouveaux: Pilier[];
  remplis: Pilier[];
}

export interface ResultatCompte extends CasEpreuve {
  reponse: string;
  verdict: "ok" | "ko" | null;
  raison: string;
  correction: { pilier: PilierListe; texte: string } | null;
  /** La correction est déjà dans la fiche. */
  ajoutee: boolean;
  /** Joué sur une version précédente de la fiche. */
  ancien: boolean;
  erreur?: string;
}

/** Le dernier appel de sa série : la carte entière. */
export interface CarteAtelierCompte {
  id: string;
  nom: string;
  role: string;
  mission: string;
  teinte: RoleTeinte;
  remplis: Pilier[];
  alerte: Pilier[];
  jetons: number;
  /** La fiche telle qu'elle sera écrite (coupée au besoin). */
  fiche: string;
  manques: string[];
  /** Le nom d'un agent qui porte déjà ce prénom. */
  pris: string | null;
  cree: string | null;
  remplacee: boolean;
  provisoire: boolean;
  voisins: { id: string; raison: string }[];
  modele: string;
  epreuve: { cas: CasEpreuve[]; resultats: ResultatCompte[]; essais: TypeCas[]; jetons: number } | null;
  routine: { nom: string; consigne: string; schedule: RoutineSchedule; planning: string } | null;
  /** La conversation est sur un VPS : l'épreuve y tourne. */
  vps: boolean;
}

export type PartieAtelierCompte = { type: "atelier-agent"; etapeId: string; ligne?: LigneAtelierCompte; carte?: CarteAtelierCompte };

/* ─── L'atelier d'une équipe ──────────────────────────────────────── */

/** Un agent de la carte d'équipe, tel que le téléphone le montre. */
export interface MembreEquipeCompte {
  cle: string;
  /** L'identifiant de son agent s'il est né, sinon sa clé (son dessin en vient). */
  id: string;
  nom: string;
  role: string;
  mission: string;
  teinte: RoleTeinte;
  remplis: Pilier[];
  jetons: number;
  cree: boolean;
  ecarte: boolean;
  pris: string | null;
}

/** Le dernier appel de sa série : la carte d'équipe entière, calculée par l'ordinateur. */
export interface CarteEquipeCompte {
  nom: string;
  but: string;
  membres: MembreEquipeCompte[];
  existants: { id: string; raison: string }[];
  exemples: { demande: string; membre: string; nom: string }[];
  /** Les fiches qui restent à écrire. */
  jetons: number;
  aCreer: number;
  manques: string[];
  nee: boolean;
  remplacee: boolean;
  provisoire: boolean;
}

export type PartieEquipeCompte = { type: "atelier-equipe"; etapeId: string; ligne?: { nom: string; arrivent: { id: string; nom: string; teinte: RoleTeinte }[] }; carte?: CarteEquipeCompte };

/** Ce que l'ordinateur sait de la conversation pour réduire ses cartes. */
export interface ContexteAtelier {
  etats: Map<string, EtatAtelier>;
  /** L'atelier d'une équipe, plié de même ; absent : ses cartes ne partent pas. */
  equipes?: Map<string, EtatEquipe>;
  /** Les agents actifs (pour un prénom déjà pris, un agent déjà créé, ses voisins). */
  roles: Pick<Role, "id" | "name" | "tag" | "teinte">[];
  teinteDe: (id: string) => RoleTeinte;
  vps: boolean;
}

const MODELES: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

/**
 * `net` : chemins et secrets retirés, coupé (cf. copie-compte.ts). `compact` : la version courte,
 * quand le message dépasse ce que le compte garde.
 */
export function vueAtelier(etapeId: string, contexte: ContexteAtelier, net: (texte: string, max: number) => string, compact: boolean): PartieAtelierCompte | null {
  const etat = contexte.etats.get(etapeId);
  if (!etat) return null;
  const b = etat.apres;
  const idPropose = identifiantPropose(b);
  if (!etat.dernier) {
    return {
      type: "atelier-agent",
      etapeId: etapeId.slice(0, 200),
      ligne: {
        id: idPropose.slice(0, 80),
        nom: nomPropre(b.nom).slice(0, 80),
        teinte: etat.teinte ?? contexte.teinteDe(idPropose),
        nouveaux: piliersNouveaux(etat),
        remplis: [...piliersRemplis(b)],
      },
    };
  }
  const roles = contexte.roles as Role[];
  const dejaLa = roles.find((r) => r.id === idPropose && comparable(r.name) === comparable(b.nom));
  const cree = etat.cree ?? dejaLa?.id ?? null;
  const agentCree = cree ? roles.find((r) => r.id === cree) : undefined;
  const id = cree ?? idPropose;
  const fiche = ficheAgent(b, id);
  const empreinte = empreinteFiche(fiche);
  const cas = casEpreuve(b);
  const resultats = (etat.resultats ?? []).filter((r) => cas?.some((c) => c.type === r.type));
  const routine = cree ? routineProposee(b, cree, "UTC") : null;
  const court = (max: number, petit: number) => (compact ? petit : max);
  return {
    type: "atelier-agent",
    etapeId: etapeId.slice(0, 200),
    carte: {
      id: id.slice(0, 80),
      nom: nomPropre(b.nom).slice(0, 80),
      role: net(b.role, 120),
      mission: net(b.mission || b.description, court(600, 240)),
      teinte: agentCree?.teinte ?? etat.teinte ?? contexte.teinteDe(idPropose),
      remplis: [...piliersRemplis(b)],
      alerte: cree ? [] : [...piliersEnAlerte(etat.resultats, etat.ajouts)],
      jetons: jetonsBrouillon(b),
      fiche: net(fiche, court(6000, 1500)),
      manques: manques(b),
      pris: !cree && b.nom ? (nomDejaPris(b.nom, roles)?.name.slice(0, 80) ?? null) : null,
      cree: cree?.slice(0, 80) ?? null,
      remplacee: !cree && !etat.courante,
      provisoire: etat.provisoire,
      voisins: b.voisins
        .filter((v) => roles.some((r) => r.id === v.id))
        .slice(0, 3)
        .map((v) => ({ id: v.id.slice(0, 80), raison: net(v.raison, court(300, 120)) })),
      modele: MODELES[b.modele || "opus"],
      epreuve: cas
        ? {
            cas: cas.map((c) => ({ type: c.type, demande: net(c.demande, 400) })),
            resultats: resultats.map((r) => ({
              type: r.type,
              demande: net(r.demande, 400),
              reponse: net(r.reponse, court(1500, 300)),
              verdict: r.verdict,
              raison: net(r.raison, 300),
              correction: r.correction ? { pilier: r.correction.pilier, texte: net(r.correction.texte, 300) } : null,
              ajoutee: !!r.correction && etat.ajouts.some((a) => comparable(a.texte) === comparable(r.correction!.texte)),
              ancien: !!r.empreinte && r.empreinte !== empreinte,
              ...(r.erreur ? { erreur: net(r.erreur, 300) } : {}),
            })),
            essais: etat.essais,
            jetons: resultats.reduce((t, r) => t + r.jetons, 0),
          }
        : null,
      routine:
        routine && b.routine
          ? // La consigne entière (2 000 au plus) : elle remplit le formulaire de la routine sur le téléphone.
            { nom: net(b.routine.nom, 80), consigne: net(b.routine.consigne, 2000), schedule: routine.schedule, planning: libellePlanning(routine.schedule) }
          : null,
      vps: contexte.vps,
    },
  };
}

/** La carte d'équipe d'un appel, telle que le téléphone l'affiche (mêmes règles que la carte du bureau). */
export function vueEquipe(etapeId: string, contexte: ContexteAtelier, net: (texte: string, max: number) => string, compact: boolean): PartieEquipeCompte | null {
  const etat = contexte.equipes?.get(etapeId);
  if (!etat) return null;
  const b = etat.apres;
  if (!etat.dernier) {
    return {
      type: "atelier-equipe",
      etapeId: etapeId.slice(0, 200),
      ligne: {
        nom: net(b.nom, 60),
        arrivent: membresNouveaux(etat)
          .slice(0, 6)
          .map((m) => ({ id: m.cle.slice(0, 80), nom: nomPropre(m.agent.nom).slice(0, 80), teinte: etat.teintes[m.cle] ?? contexte.teinteDe(m.cle) })),
      },
    };
  }
  const vus = membresVus(etat, contexte.roles, contexte.teinteDe);
  const bilan = bilanEquipe(etat, vus);
  const court = (max: number, petit: number) => (compact ? petit : max);
  const nomDe = (cle: string) => vus.find((x) => x.m.cle === cle)?.nom ?? contexte.roles.find((r) => r.id === cle)?.name ?? cle;
  return {
    type: "atelier-equipe",
    etapeId: etapeId.slice(0, 200),
    carte: {
      nom: net(b.nom, 60),
      but: net(b.but, court(300, 160)),
      membres: vus.map((x) => ({
        cle: x.m.cle.slice(0, 80),
        id: (x.idCree ?? x.m.cle).slice(0, 80),
        nom: x.nom.slice(0, 80),
        role: net(x.m.agent.role, 120),
        mission: net(x.m.agent.mission || x.m.agent.description, court(400, 160)),
        teinte: x.teinte,
        remplis: [...piliersRemplis(x.m.agent)],
        jetons: jetonsBrouillon(x.m.agent),
        cree: !!x.idCree,
        ecarte: x.ecarte,
        pris: x.pris?.name.slice(0, 80) ?? null,
      })),
      existants: b.existants
        .filter((e) => contexte.roles.some((r) => r.id === e.id))
        .map((e) => ({ id: e.id.slice(0, 80), raison: net(e.raison, court(200, 100)) })),
      exemples: b.exemples.map((e) => ({ demande: net(e.demande, court(200, 120)), membre: e.membre.slice(0, 80), nom: nomDe(e.membre).slice(0, 80) })),
      jetons: bilan.jetons,
      aCreer: bilan.aCreer.length,
      manques: bilan.manques.map((m) => net(m, 160)),
      nee: bilan.nee,
      remplacee: bilan.remplacee,
      provisoire: etat.provisoire,
    },
  };
}
