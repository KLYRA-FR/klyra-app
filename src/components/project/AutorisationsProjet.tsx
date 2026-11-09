"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, unwrap, type ReglesProjet } from "@/lib/bridge";
import { regleEnMots } from "@/lib/regles-autorisation";
import type { Project } from "@/types/domain";

/**
 * Les autorisations retenues pour ce projet : ce que « Toujours, dans ce projet » a fait garder aux agents
 * (`.claude/settings.local.json`, sur la machine du projet). Une règle se retire d'un clic ; rien d'autre du
 * fichier ne change. Absent tant qu'aucune règle n'est retenue.
 */
export function AutorisationsProjet({ project }: { project: Project }) {
  const pont = getBridge()?.projets;
  const [regles, setRegles] = useState<ReglesProjet | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const lieu = project.lieu ?? null;

  useEffect(() => {
    if (!pont?.regles) return;
    let actif = true;
    pont
      .regles(project.folder, lieu)
      .then((r) => actif && setRegles(unwrap(r)))
      .catch(() => actif && setRegles(null));
    return () => {
      actif = false;
    };
  }, [pont, project.folder, lieu]);

  const lignes = regles ? [...regles.allow.map((r) => ({ liste: "allow" as const, regle: r })), ...regles.ask.map((r) => ({ liste: "ask" as const, regle: r })), ...regles.deny.map((r) => ({ liste: "deny" as const, regle: r }))] : [];
  if (!lignes.length) return null;

  const retirer = async (liste: "allow" | "ask" | "deny", regle: string) => {
    setErreur(null);
    try {
      setRegles(unwrap(await pont!.retirerRegle!(project.folder, liste, regle, lieu)));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section aria-label="Autorisations retenues" data-autorisations-projet className="flex flex-col gap-2 rounded-lg border border-bordure-subtile bg-fond-surface p-4">
      <div className="flex items-center gap-2">
        <Icon name="shield-check" size={16} className="text-icone-secondaire" />
        <span className="text-ui-s font-semibold text-texte-principal">Autorisations retenues</span>
      </div>
      <p className="m-0 text-ui-xs text-texte-secondaire">Ce que les agents font dans ce projet sans te demander, depuis un « Toujours ».</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
        {lignes.map(({ liste, regle }) => (
          <li key={`${liste}:${regle}`} className="flex min-h-9 items-center gap-2 py-1">
            <span className="min-w-0 flex-1 truncate text-ui-s text-texte-principal" title={regle}>
              {liste === "allow" ? "" : liste === "ask" ? "Toujours demander : " : "Jamais : "}
              {regleEnMots(regle)}
            </span>
            <Bouton variant="discret" taille="mini" onClick={() => void retirer(liste, regle)}>
              Retirer
            </Bouton>
          </li>
        ))}
      </ul>
      {erreur && (
        <p role="alert" className="m-0 text-ui-xs text-texte-erreur">
          {erreur}
        </p>
      )}
    </section>
  );
}
