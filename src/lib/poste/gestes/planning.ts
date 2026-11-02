"use client";

import { ICONES } from "@/components/planning/Rappels";
import { getBridge } from "@/lib/bridge";
import { reporterParId } from "@/lib/report";
import { categorieSaisie, evenementModifie, lireFenetre, lireReport, rappelModifie } from "@/lib/telephone/saisie-planning";
import { useWorkspace } from "@/lib/workspace";
import type { Categorie, Evenement, Tache } from "@/types/domain";
import { ErreurPoste, chaine, chaineOuNull, objet, type Gestes } from "../types";

/** Ce que le téléphone lit du planning de l'ordinateur (`planning.lire`). Rien de cela n'est gardé dans le compte (M-7). */
export interface PlanningDuPoste {
  categories: Categorie[];
  /** Les rappels de cet ordinateur ; le téléphone écarte ceux déjà mis dans le compte (`origineLocale`). */
  taches: Tache[];
  /** Les événements de cet ordinateur seulement : ceux du compte et le Weekly, le téléphone les lit en ligne. */
  evenements: Evenement[];
}

/** Un départ de routine (`planning.departs`), tel que le calcule le moteur, avec son fuseau. */
export interface DepartRoutine {
  routineId: string;
  nom: string;
  agentId: string;
  at: string;
}

/**
 * Gestes « planning » que l'ordinateur fait pour le téléphone (spec mobile T-05 à T-07) : ce qui
 * n'est pas dans le compte, c'est-à-dire les catégories, les rappels et événements de cet
 * ordinateur, et les départs des routines. Le reste du Planning (rappels et calendrier du
 * compte) se lit et s'écrit en ligne, ordinateur fermé compris.
 */
export function useGestesPlanning(): Gestes {
  const { state, enregistrerTache, supprimerTache, enregistrerEvenement, supprimerEvenement, changerCategories } = useWorkspace();

  const tache = (id: string): Tache => {
    const trouvee = state.taches.find((t) => t.id === id);
    if (!trouvee) throw new ErreurPoste("introuvable", "Ce rappel n’existe plus.");
    return trouvee;
  };
  const evenement = (id: string): Evenement => {
    const trouve = state.evenements.find((e) => e.id === id);
    if (!trouve) throw new ErreurPoste("introuvable", "Cet événement n’existe plus.");
    return trouve;
  };

  return {
    "planning.lire": async (): Promise<PlanningDuPoste> => ({
      categories: state.categories,
      taches: state.taches,
      evenements: state.evenements,
    }),

    /* Mêmes passages que l'agenda du bureau (`usePassagesRoutines`) : routines actives, sans relais, pas les horaires. */
    "planning.departs": async (args): Promise<DepartRoutine[]> => {
      const { debut, fin } = lireFenetre(objet(args));
      const moteur = getBridge()?.routines;
      if (!moteur) throw new ErreurPoste("indisponible", "Cette version de KLYRA sur l’ordinateur ne lit pas encore les routines. Mets-la à jour.");
      const [liste, echeances] = await Promise.all([moteur.lister(), moteur.passages(debut, fin)]);
      if (!liste.ok || !echeances.ok) throw new ErreurPoste("routines", "Les routines n’ont pas pu être lues sur l’ordinateur.");
      const routines = new Map(liste.data.map((routine) => [routine.id, routine]));
      return echeances.data.flatMap(({ routineId, at }) => {
        const routine = routines.get(routineId);
        if (!routine?.active || routine.relais?.length || routine.schedule.kind === "hourly") return [];
        return [{ routineId, nom: routine.name, agentId: routine.agentId, at }];
      });
    },

    "planning.enregistrerRappel": async (args) => {
      const a = objet(args);
      const modifie = rappelModifie(a, tache(chaine(a, "id", 200)), state.categories);
      enregistrerTache(modifie);
      return { id: modifie.id };
    },

    /* Relu par son id au moment du geste, comme `MenuReporter` : supprimé ou coché entre-temps, rien n'est écrit. */
    "planning.reporterRappel": async (args) => {
      const a = objet(args);
      const reporte = reporterParId(state.taches, chaine(a, "id", 200), lireReport(a), new Date());
      if (!reporte) throw new ErreurPoste("introuvable", "Ce rappel n’est plus à faire.");
      enregistrerTache(reporte);
      return { jour: reporte.date, heure: reporte.heure, fin: reporte.fin ?? null };
    },

    "planning.supprimerRappel": async (args) => {
      supprimerTache(tache(chaine(objet(args), "id", 200)).id);
      return null;
    },

    "planning.enregistrerEvenement": async (args) => {
      const a = objet(args);
      const existant = evenement(chaine(a, "id", 200));
      if (existant.equipe) throw new ErreurPoste("lecture_seule", "Cet événement ne se modifie pas.");
      enregistrerEvenement(evenementModifie(a, existant));
      return { id: existant.id };
    },

    "planning.supprimerEvenement": async (args) => {
      const existant = evenement(chaine(objet(args), "id", 200));
      if (existant.equipe) throw new ErreurPoste("lecture_seule", "Cet événement ne se modifie pas.");
      supprimerEvenement(existant.id);
      return null;
    },

    /* Sans id : une nouvelle catégorie, au bout de la liste. */
    "planning.enregistrerCategorie": async (args) => {
      const a = objet(args);
      const id = chaineOuNull(a, "id", 200);
      const saisie = categorieSaisie(a, ICONES);
      if (id === null) {
        const nouvelle = { id: crypto.randomUUID(), ...saisie };
        changerCategories([...state.categories, nouvelle]);
        return { id: nouvelle.id };
      }
      if (!state.categories.some((c) => c.id === id)) throw new ErreurPoste("introuvable", "Cette catégorie n’existe plus.");
      changerCategories(state.categories.map((c) => (c.id === id ? { ...c, ...saisie } : c)));
      return { id };
    },

    /* Comme au bureau : ses rappels passent dans la première catégorie qui reste ; la dernière ne se supprime pas. */
    "planning.supprimerCategorie": async (args) => {
      const id = chaine(objet(args), "id", 200);
      const reste = state.categories.filter((c) => c.id !== id);
      if (reste.length === state.categories.length) throw new ErreurPoste("introuvable", "Cette catégorie n’existe plus.");
      if (reste.length === 0) throw new ErreurPoste("derniere", "Il faut garder au moins une catégorie.");
      for (const t of state.taches) if (t.liste === id) enregistrerTache({ ...t, liste: reste[0].id });
      changerCategories(reste);
      return null;
    },
  };
}
