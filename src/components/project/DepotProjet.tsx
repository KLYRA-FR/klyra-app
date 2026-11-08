"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, type EtatGit } from "@/lib/bridge";
import { nomDepot, resumeDepot } from "@/lib/depot-projet";
import type { Project } from "@/types/domain";

/**
 * Le dépôt d'un projet de ce poste relié à un distant (un clone GitHub, ou un dossier qui en est un) :
 * sa branche, ce qui attend, et « Récupérer les nouveautés » (`git pull --ff-only`, rien n'est écrasé).
 * Jamais l'adresse brute du distant : elle peut porter un identifiant.
 */
export function DepotProjet({ project }: { project: Project }) {
  const git = getBridge()?.git;
  const [etat, setEtat] = useState<EtatGit | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [retour, setRetour] = useState<{ ok: boolean; message: string } | null>(null);
  const disponible = !project.lieu && !!git?.recuperer;

  useEffect(() => {
    if (!disponible || !git) return;
    let actif = true;
    void git.etat(project.folder).then((r) => actif && r.ok && setEtat(r.data));
    return () => {
      actif = false;
    };
  }, [disponible, git, project.folder]);

  if (!disponible || !etat?.depot || !etat.distant) return null;

  const recuperer = async () => {
    setEnCours(true);
    setRetour(null);
    const r = await git!.recuperer!(project.folder);
    setEnCours(false);
    if (!r.ok) return setRetour({ ok: false, message: r.message });
    setEtat(r.data.etat);
    setRetour({ ok: r.data.ok, message: r.data.message });
  };

  return (
    <section aria-label="Dépôt du projet" data-depot-projet className="flex flex-col gap-2 rounded-md border border-bordure-subtile bg-fond-page p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="git-branch-01" size={16} className="text-icone-secondaire" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="klyra-mono truncate text-ui-s text-texte-principal">{nomDepot(project.depot, etat.distant)}</span>
          <span className="text-ui-xs text-texte-tertiaire">{resumeDepot(etat)}</span>
        </span>
        {etat.suivie && (
          <Bouton variant="blanc" taille="compact" iconeGauche={<Icon name="refresh-01" size={16} />} onClick={() => void recuperer()} disabled={enCours}>
            {enCours ? "Récupération…" : "Récupérer les nouveautés"}
          </Bouton>
        )}
      </div>
      {retour && (
        <p role={retour.ok ? "status" : "alert"} className={retour.ok ? "m-0 text-ui-xs text-texte-secondaire" : "m-0 text-ui-xs text-texte-erreur"}>
          {retour.message}
        </p>
      )}
    </section>
  );
}
