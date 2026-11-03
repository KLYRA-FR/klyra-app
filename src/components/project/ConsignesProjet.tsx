"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, unwrap } from "@/lib/bridge";
import type { Project } from "@/types/domain";
import type { EtatConsignesProjet } from "../../../electron/consignes-projet";

/**
 * Les consignes du projet pour ses agents (electron/consignes-projet.ts) : un AGENTS.md court à remplir,
 * lu par Claude et ChatGPT, en un clic. L'aperçu montre ce qui sera écrit ; rien n'est écrasé.
 * Projets de ce poste seulement (un projet sur un VPS n'a pas encore cette carte).
 */
export function ConsignesProjet({ project }: { project: Project }) {
  const pont = getBridge()?.projets;
  const [etat, setEtat] = useState<EtatConsignesProjet | null>(null);
  const [apercu, setApercu] = useState(false);
  const [cree, setCree] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const local = !project.lieu && !!pont?.consignes;

  useEffect(() => {
    if (!local || !pont?.consignes) return;
    let actif = true;
    pont
      .consignes(project.folder, project.name)
      .then((r) => actif && setEtat(unwrap(r)))
      .catch((e: unknown) => actif && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      actif = false;
    };
  }, [local, pont, project.folder, project.name]);

  if (!local || (!etat && !erreur)) return null;

  const ecrire = async () => {
    setErreur(null);
    try {
      setEtat(unwrap(await pont!.ecrireConsignes!(project.folder, project.name)));
      setApercu(false);
      setCree(true);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };
  const ouvrir = () => void pont!.ouvrirFichier(project.folder, "AGENTS.md").then(unwrap).catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)));
  const enPlace = !!etat && etat.propositions.length === 0;

  return (
    <section
      aria-label="Consignes du projet"
      data-consignes-projet={enPlace ? "en-place" : "a-ajouter"}
      className="flex flex-col gap-2.5 rounded-md border border-bordure-subtile bg-fond-page p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="file-01" size={16} className="text-icone-secondaire" />
        <span className="min-w-0 flex-1 text-ui-s text-texte-principal">
          {enPlace ? (
            cree ? (
              <>AGENTS.md créé : remplis-le, tes agents le liront à chaque session.</>
            ) : (
              <>Consignes du projet : AGENTS.md, lu par tes agents à chaque session.</>
            )
          ) : (
            <>Pas encore de consignes pour les agents de ce projet. Un AGENTS.md court leur évite de redécouvrir le projet à chaque fois.</>
          )}
        </span>
        {enPlace ? (
          <Bouton variant="blanc" taille="compact" onClick={ouvrir}>
            Ouvrir AGENTS.md
          </Bouton>
        ) : (
          !apercu && (
            <Bouton variant="blanc" taille="compact" onClick={() => setApercu(true)}>
              Ajouter les consignes KLYRA
            </Bouton>
          )
        )}
      </div>

      {apercu && etat && (
        <div data-apercu-consignes className="flex flex-col gap-2.5">
          {etat.propositions.map((p) => (
            <div key={p.nom} className="flex flex-col gap-1">
              <span className="text-ui-xs font-medium text-texte-secondaire">
                {p.action === "creer" ? `Créer ${p.nom}` : `Ajouter en tête de ton ${p.nom} (le reste ne change pas)`}
              </span>
              <pre className="klyra-mono m-0 max-h-[240px] overflow-auto rounded-xs bg-fond-surface-grise px-3 py-2 text-ui-xs leading-[1.5] whitespace-pre-wrap text-texte-principal">
                {p.contenu.trimEnd()}
              </pre>
            </div>
          ))}
          <p className="m-0 text-ui-xs leading-[1.45] text-texte-tertiaire">
            AGENTS.md est lu par Claude et par ChatGPT ; le CLAUDE.md l’importe pour que toutes les versions de Claude Code le lisent, une seule fois. Garde-le court : chaque ligne est relue à chaque appel.
          </p>
          <div className="flex gap-2">
            <Bouton variant="sombre" taille="compact" onClick={() => void ecrire()}>
              Créer
            </Bouton>
            <Bouton variant="blanc" taille="compact" onClick={() => setApercu(false)}>
              Annuler
            </Bouton>
          </div>
        </div>
      )}
      {erreur && (
        <p role="alert" className="m-0 text-ui-xs text-texte-erreur">
          {erreur}
        </p>
      )}
    </section>
  );
}
