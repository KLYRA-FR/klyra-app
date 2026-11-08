"use client";

import { useCallback, useRef, useState } from "react";
import type { DepotGithubProjet } from "../../../electron/github-types";
import { Icon } from "@/components/icons/Icon";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { getBridge } from "@/lib/bridge";
import { lireValeurDepot, optionsDepot } from "@/lib/choix-depot";
import { projetDepuisDepot } from "@/lib/projet-depuis-depot";
import { useWorkspace } from "@/lib/workspace";
import type { Project } from "@/types/domain";

/** Les dépôts GitHub lus par machine, gardés quelques minutes : ouvrir la puce ne relit pas GitHub à chaque fois. */
type LectureDepots = { etat: "charge" | "pret" | "deconnecte" | "erreur"; depots: DepotGithubProjet[] | null; quand: number };
const LECTURES = new Map<string, LectureDepots>();
const DUREE = 5 * 60_000;
const cle = (lieu: string | null) => lieu ?? "pc";

/**
 * La puce « Dépôt » d'un composeur, comme dans Claude Desktop : un projet déjà ouvert sur la machine de la
 * conversation, ou un de ses dépôts GitHub. Elle ne fait que choisir ; l'envoi ouvre une conversation dans
 * ce projet (`useOuvrirChoixDepot`), qui apparaît dans le projet. La liste GitHub est lue à la première ouverture.
 */
export function PuceDepot({ lieu, valeur, onChange, disabled }: { lieu: string | null; valeur: string; onChange: (valeur: string) => void; disabled?: boolean }) {
  const github = getBridge()?.github;
  const { projects } = useWorkspace().state;
  const [lecture, setLecture] = useState<LectureDepots | null>(() => LECTURES.get(cle(lieu)) ?? null);
  const enCours = useRef(false);

  const charger = useCallback(() => {
    if (!github || enCours.current) return;
    const gardee = LECTURES.get(cle(lieu));
    if (gardee?.etat === "pret" && Date.now() - gardee.quand < DUREE) return setLecture(gardee);
    enCours.current = true;
    setLecture({ etat: "charge", depots: null, quand: Date.now() });
    void (async () => {
      let suite: LectureDepots;
      try {
        const etat = await github.etat(lieu);
        if (!etat.ok) throw new Error(etat.message);
        if (!etat.data.compte) suite = { etat: "deconnecte", depots: null, quand: Date.now() };
        else {
          const liste = await github.depots(lieu);
          if (!liste.ok) throw new Error(liste.message);
          suite = { etat: "pret", depots: liste.data, quand: Date.now() };
        }
      } catch {
        suite = { etat: "erreur", depots: null, quand: Date.now() };
      }
      LECTURES.set(cle(lieu), suite);
      enCours.current = false;
      setLecture(suite);
    })();
  }, [github, lieu]);

  const options = optionsDepot(projects, lecture?.depots ?? null, lieu, !github ? "absent" : (lecture?.etat ?? "charge")).map((o) => ({
    value: o.value,
    label: o.label,
    disabled: o.disabled,
    icone: <Icon name={o.type === "depot" ? "git-branch-01" : o.type === "info" ? "clock-01" : "folder"} size={16} className="text-icone-secondaire" />,
  }));

  return (
    /* La liste GitHub se lit quand on s'approche de la puce (pointeur ou clavier), pas à chaque conversation ouverte. */
    <span data-puce-depot className="contents" onPointerDownCapture={charger} onFocusCapture={charger}>
      <ListeDeroulante variante="puce" libelle="Dépôt" options={options} value={valeur} onChange={onChange} largeurListe={300} disabled={disabled} />
    </span>
  );
}

/** Le nom court d'un choix de la puce (« klyra-app »), pour le champ et l'attente. */
export function nomChoixDepot(valeur: string, projets: Project[]): string | null {
  const choix = lireValeurDepot(valeur);
  if (!choix) return null;
  if ("projet" in choix) return projets.find((p) => p.id === choix.projet)?.name ?? null;
  return choix.depot.split("/").pop() ?? choix.depot;
}

/**
 * Ce qu'un choix de la puce devient à l'envoi : le projet existant, ou le dépôt cloné sur la machine de la
 * conversation puis enregistré comme projet (sans formulaire, comme « Ouvrir » dans Projets).
 */
export function useOuvrirChoixDepot() {
  const { state, enregistrerProjet } = useWorkspace();
  const { projects } = state;
  return useCallback(
    async (valeur: string, lieu: string | null): Promise<{ ok: true; projet: Project } | { ok: false; message: string }> => {
      const choix = lireValeurDepot(valeur);
      if (!choix) return { ok: false, message: "Choisis un dépôt." };
      if ("projet" in choix) {
        const projet = projects.find((p) => p.id === choix.projet);
        return projet ? { ok: true, projet } : { ok: false, message: "Ce projet n’est plus dans l’app." };
      }
      const github = getBridge()?.github;
      if (!github) return { ok: false, message: "Ouvrir un dépôt GitHub marche dans l’app de bureau." };
      const depot = LECTURES.get(cle(lieu))?.depots?.find((d) => d.nom === choix.depot);
      if (!depot?.branche) return { ok: false, message: "Ce dépôt n’est plus dans ta liste GitHub : rouvre la puce pour la relire." };
      const r = await github.ouvrir(lieu, depot.nom, depot.branche);
      if (!r.ok) return { ok: false, message: r.message };
      const { projet, existant } = projetDepuisDepot({ depot: { ...depot, nom: r.data.depot }, branche: depot.branche, dossier: r.data.dossier, lieu, projets: projects });
      if (!existant) enregistrerProjet(projet);
      return { ok: true, projet };
    },
    [projects, enregistrerProjet],
  );
}
