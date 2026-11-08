"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { getBridge, type EtatGit } from "@/lib/bridge";
import { nomDepot, resumeCourt, resumeDepot } from "@/lib/depot-projet";
import type { Project } from "@/types/domain";

/**
 * Le dépôt d'un projet de ce poste relié à un distant (un clone GitHub, ou un dossier qui en est un) :
 * sa branche, ce qui attend, et « Récupérer les nouveautés » (`git pull --ff-only`, rien n'est écrasé).
 * Jamais l'adresse brute du distant : elle peut porter un identifiant.
 */
export function DepotProjet({ project, compact = false }: { project: Project; compact?: boolean }) {
  const git = getBridge()?.git;
  const github = getBridge()?.github;
  const natif = !!project.githubConnecte && !!github;
  const [etat, setEtat] = useState<EtatGit | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [retour, setRetour] = useState<{ ok: boolean; message: string } | null>(null);
  const disponible = natif || (!project.lieu && !!git?.recuperer);

  useEffect(() => {
    if (!disponible || (!git && !natif)) return;
    let actif = true;
    void (natif ? github!.etatDepot(project.lieu ?? null, project.folder) : git!.etat(project.folder)).then((r) => actif && r.ok && setEtat(r.data));
    return () => {
      actif = false;
    };
  }, [disponible, git, github, natif, project.folder, project.lieu]);

  if (!disponible || !etat?.depot || !etat.distant) return null;

  const recuperer = async () => {
    setEnCours(true);
    setRetour(null);
    if (natif) {
      const r = await github!.recuperer(project.lieu ?? null, project.folder);
      setEnCours(false);
      if (!r.ok) return setRetour({ ok: false, message: r.message });
      setEtat(r.data); setRetour({ ok: true, message: "Nouveautés récupérées." });
      return;
    }
    const r = await git!.recuperer!(project.folder);
    setEnCours(false);
    if (!r.ok) return setRetour({ ok: false, message: r.message });
    setEtat(r.data.etat);
    setRetour({ ok: r.data.ok, message: r.data.message });
  };

  /* Dans le panneau du projet : la branche et ce qui attend, sur une ligne. */
  if (compact) {
    return (
      <section aria-label="Branche du projet" data-depot-barre className="flex flex-col gap-1">
        <div title={`${nomDepot(project.depot, etat.distant)} · ${resumeDepot(etat)}`} className="flex h-7 items-center gap-2 pr-0.5 pl-2 text-ui-xs text-texte-secondaire">
          <Icon name="git-branch-01" size={14} className="shrink-0 text-icone-secondaire" />
          <span className="min-w-0 flex-1 truncate">{resumeCourt(etat)}</span>
          {etat.suivie && (
            <BoutonIcone
              taille="mini"
              icone={<Icon name="refresh-01" size={14} />}
              libelle={enCours ? "Récupération…" : "Récupérer les nouveautés"}
              onClick={() => void recuperer()}
              disabled={enCours}
              className="text-icone-secondaire"
            />
          )}
        </div>
        {retour && (
          <p role={retour.ok ? "status" : "alert"} className={retour.ok ? "m-0 px-2 text-ui-2xs text-texte-secondaire" : "m-0 px-2 text-ui-2xs text-texte-erreur"}>
            {retour.message}
          </p>
        )}
      </section>
    );
  }

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
