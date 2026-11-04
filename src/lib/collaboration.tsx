"use client";

import { useConvex, useConvexAuth } from "convex/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import { getBridge, type Reponse } from "@/lib/bridge";
import { messageErreur } from "@/lib/compte";
import { useReglages } from "@/lib/reglages";
import { useProjects, useWorkspace } from "@/lib/workspace";
import type { BilanTour, FinEtape } from "../../electron/collaboration/types";

/**
 * Le circuit des Issues, côté écran : seule la session du compte peut demander un jeton (Convex). Le tour
 * lui-même et tout ce qui touche à GitHub sont dans le process principal (electron/collaboration/). Surveiller
 * ne coûte aucun jeton de modèle. Ne tourne que si la personne a activé le projet, et seulement sur ce poste.
 */

const TOUR_MS = 2 * 60_000;
/** Un jeton vaut une heure : on en redemande un avant qu'il ne manque en plein envoi. */
const MARGE_JETON_MS = 10 * 60_000;
const AGENTS_MAX = 3;

export interface SuiviProjet {
  depot: string | null;
  bilan: BilanTour | null;
  erreur: string | null;
  dernierTour: number | null;
}

const suivis = new Map<string, SuiviProjet>();
const abonnes = new Set<() => void>();

function noter(projetId: string, partiel: Partial<SuiviProjet>) {
  const avant = suivis.get(projetId) ?? { depot: null, bilan: null, erreur: null, dernierTour: null };
  suivis.set(projetId, { ...avant, ...partiel });
  abonnes.forEach((f) => f());
}

/** Ce que le dernier tour a vu pour ce projet. */
export function useSuiviCircuit(projetId: string): SuiviProjet | null {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => suivis.get(projetId) ?? null,
    () => null,
  );
}

/** Demande un tour tout de suite (bouton « Vérifier maintenant »). */
export function relancerCircuit() {
  window.dispatchEvent(new Event("klyra:collaboration-tour"));
}

function deballer<T>(r: Reponse<T>): T {
  if (!r.ok) throw new Error(r.message);
  return r.data;
}

/** Monté une fois, sous le compte. Rien à l'écran. */
export function CircuitGithub() {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { reglages } = useReglages();
  const projets = useProjects();
  const { lancerIssue, issuesEnCours } = useWorkspace();

  /* Les dernières valeurs, lues par la boucle sans la relancer à chaque rendu. */
  const dernier = useRef({ reglages, projets, lancerIssue, issuesEnCours, isAuthenticated });
  useEffect(() => {
    dernier.current = { reglages, projets, lancerIssue, issuesEnCours, isAuthenticated };
  });

  useEffect(() => {
    const pont = getBridge()?.collaboration;
    if (!pont) return;
    const jetons = new Map<string, { jeton: string; expire: number }>();
    let occupe = false;

    const jetonDe = async (depot: string): Promise<string> => {
      const garde = jetons.get(depot);
      if (garde && garde.expire - Date.now() > MARGE_JETON_MS) return garde.jeton;
      const recu = await convex.action(api.jetonsDepotEnvoi.demander, { depot, role: "agents" });
      jetons.set(depot, { jeton: recu.jeton, expire: Date.parse(recu.expire) });
      return recu.jeton;
    };

    const tourDe = async (projetId: string, dossier: string, compte: string, poste: string) => {
      const depot = deballer(await pont.depot(dossier));
      noter(projetId, { depot });
      if (!depot) return;
      const garde = await getBridge()?.superagent?.peutOuvrir();
      const enCours = dernier.current.issuesEnCours(depot);
      /* Un seul lancement par tour, jamais au-delà de trois agents du circuit ni des places du journal. */
      const places = (garde?.ok && !garde.data.ok) || enCours.length >= AGENTS_MAX ? 0 : 1;
      const bilan = deballer(await pont.tour({ dossier, depot, moi: compte, poste, jeton: await jetonDe(depot), enCours, places }));
      noter(projetId, { bilan, erreur: bilan.erreurs.join(" · ") || null, dernierTour: Date.now() });
      for (const l of bilan.aLancer) {
        dernier.current.lancerIssue({ depot, numero: l.numero, titre: l.titre, brief: l.brief, chemin: l.chemin, agent: l.agent, projetId });
      }
    };

    const passer = async () => {
      const { reglages: r, projets: tous, isAuthenticated: connecte } = dernier.current;
      if (!r) return;
      const { compteGithub, poste, projets: actifs } = r.collaboration;
      if (occupe || !connecte || !compteGithub || !poste || actifs.length === 0) return;
      occupe = true;
      try {
        for (const projet of tous) {
          /* Sur un VPS : pas encore. L'écran du projet le dit. */
          if (!actifs.includes(projet.id) || projet.lieu || !projet.folder) continue;
          try {
            await tourDe(projet.id, projet.folder, compteGithub, poste);
          } catch (erreur) {
            noter(projet.id, { erreur: messageErreurCircuit(erreur), dernierTour: Date.now() });
          }
        }
      } finally {
        occupe = false;
      }
    };

    /* L'agent a fini : le code valide, pousse et ouvre la PR, puis un tour regarde la suite. */
    const fin = (evenement: Event) => {
      const d = (evenement as CustomEvent<{ depot: string; numero: number; agent: string; ok: boolean; texte: string; erreur: string | null }>).detail;
      void (async () => {
        const { reglages: r, projets: tous } = dernier.current;
        if (!r) return;
        const { compteGithub, poste, projets: actifs } = r.collaboration;
        for (const projet of tous) {
          if (!actifs.includes(projet.id) || projet.lieu || !projet.folder) continue;
          try {
            const depot = deballer(await pont.depot(projet.folder));
            if (depot !== d.depot) continue;
            const issue: FinEtape = deballer(
              await pont.terminer({ dossier: projet.folder, depot, moi: compteGithub, poste, jeton: await jetonDe(depot), numero: d.numero, agent: d.agent, ok: d.ok, texte: d.texte, erreur: d.erreur }),
            );
            if (issue.statut === "bloque") noter(projet.id, { erreur: `Issue #${d.numero} : ${issue.raison}` });
          } catch (erreur) {
            noter(projet.id, { erreur: `Issue #${d.numero} : ${messageErreurCircuit(erreur)}` });
          }
        }
        await passer();
      })();
    };

    const declencher = () => void passer();
    const debut = setTimeout(declencher, 5_000);
    const minuteur = setInterval(declencher, TOUR_MS);
    window.addEventListener("klyra:collaboration-tour", declencher);
    window.addEventListener("klyra:collaboration-fin", fin);
    return () => {
      clearTimeout(debut);
      clearInterval(minuteur);
      window.removeEventListener("klyra:collaboration-tour", declencher);
      window.removeEventListener("klyra:collaboration-fin", fin);
    };
  }, [convex]);

  return null;
}

/** Les refus du compte ont leur phrase. Les erreurs du process principal sont déjà rédigées. */
function messageErreurCircuit(erreur: unknown): string {
  const texte = erreur instanceof Error ? erreur.message : String(erreur);
  return /depot_|jetons_|app_non|github_indisponible|trop_tot|non_connecte/.test(texte) ? messageErreur(erreur) : texte;
}
