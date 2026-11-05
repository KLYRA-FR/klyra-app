"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { lireDerniereDonnee } from "@/lib/coque";
import { cn } from "@/lib/cn";
import { carteOrdinateur } from "@/lib/telephone/carte-ordinateur";
import { useATraiterParEspace } from "@/lib/telephone/espace";
import { useHorsLigne } from "./BandeauReseau";
import { useEspaceAffiche } from "./EspaceTelephone";
import { EtapesLiaison } from "./etats";
import { CompteEspace, Etiquette } from "./Liste";
import { FeuilleOrdinateurs, PrevenirOuverture } from "./PastillePoste";
import { usePostes } from "./poste";

/** La tuile de 44 px de la carte. */
function TuileCarte({ bleue = false }: { bleue?: boolean }) {
  return (
    <span aria-hidden="true" className={cn("flex size-11 shrink-0 items-center justify-center rounded-md", bleue ? "bg-fond-teinte-bleue text-icone-accent" : "bg-fond-surface-grise text-icone-defaut")}>
      <Icon name="computer" size={24} />
    </span>
  );
}

const CADRE = "overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante";

/**
 * La carte de l'ordinateur, en tête de Plus (lot 8, E8-01, E8-03 à E8-06) : l'état lu dans le compte.
 * La toucher ouvre la feuille Ordinateurs. Un seul espace possible : pas de ligne « Serveur affiché ».
 */
export function CarteOrdinateur() {
  const { postes } = usePostes();
  const horsLigne = useHorsLigne();
  const [ouverte, setOuverte] = useState(false);
  /* L'heure de la phrase « fermée depuis 18:42 » : lue au montage, puis chaque minute. */
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const minuteur = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(minuteur);
  }, []);
  const { lieu, serveur, serveurs, adresses } = useEspaceAffiche();
  const aTraiter = useATraiterParEspace(adresses);
  const ailleurs = [null, ...adresses].reduce((somme, l) => (l === lieu ? somme : somme + aTraiter(l)), 0);
  const carte = carteOrdinateur({ postes, horsLigne, derniereDonnee: horsLigne ? lireDerniereDonnee() : null, maintenant });

  if (carte.etat === "chargement") {
    return (
      <div aria-busy="true" className={cn(CADRE, "p-3.5")}>
        <div className="flex items-center gap-3">
          <span className="size-11 shrink-0 rounded-md bg-fond-surface-grise motion-safe:animate-pulse" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3 w-2/5 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse" />
            <span className="h-2.5 w-3/5 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse" />
          </span>
        </div>
        <span className="mt-3.5 block h-2.5 w-4/5 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse" />
      </div>
    );
  }

  if (carte.etat === "aucun") {
    return (
      <div className={cn(CADRE, "p-4")}>
        <div className="flex items-start gap-3">
          <TuileCarte bleue />
          <div className="min-w-0 flex-1">
            <p className="text-body-s font-semibold text-texte-principal">Aucun ordinateur relié</p>
            <p className="mt-0.5 text-ui-xs text-texte-secondaire">Tes projets, fichiers et routines vivent sur ton ordinateur.</p>
          </div>
        </div>
        <EtapesLiaison className="mt-4 [&>li]:text-ui" />
      </div>
    );
  }

  return (
    <div className={CADRE}>
      <button type="button" aria-haspopup="dialog" onClick={() => setOuverte(true)} className="block w-full text-left transition-colors duration-[120ms] ease-sortie active:bg-fond-survol">
        <span className="flex items-center gap-3 pt-3.5 pr-3 pl-3.5">
          <TuileCarte />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-body-s font-semibold text-texte-principal">{carte.titre}</span>
              {carte.etiquette ? <Etiquette ton={carte.etiquette.bleue ? "bleue" : "neutre"}>{carte.etiquette.texte}</Etiquette> : null}
            </span>
            <span className="mt-0.5 block truncate text-ui-xs text-texte-secondaire">{carte.sous}</span>
          </span>
          <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" />
        </span>
        <span className="block px-4 pt-2.5 pb-3.5 text-ui leading-[1.4] text-texte-secondaire">{carte.phrase}</span>
      </button>
      {carte.prevenir ? (
        <div className="-mt-1 px-4 pb-4 [&_button]:w-full">
          <PrevenirOuverture cle={carte.prevenir} />
        </div>
      ) : null}
      {serveurs.length ? (
        <button type="button" aria-haspopup="dialog" onClick={() => setOuverte(true)} className="flex min-h-[52px] w-full items-center gap-2 pr-3 pl-4 text-left text-ui shadow-[inset_0_1px_0_var(--color-bordure-defaut)] transition-colors duration-[120ms] ease-sortie active:bg-fond-survol">
          <span className="flex-1 font-medium text-texte-principal">Serveur affiché</span>
          <span className="flex min-w-0 items-center gap-1.5 text-texte-secondaire">
            <Icon name={serveur ? "globe-01" : "computer"} size={16} className="shrink-0" />
            <span className="truncate">{serveur?.nom ?? carte.titre}</span>
          </span>
          {ailleurs > 0 ? <CompteEspace valeur={ailleurs} libelle={`${ailleurs} à traiter sur l’autre espace`} /> : null}
          <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" />
        </button>
      ) : null}
      {ouverte ? <FeuilleOrdinateurs onFermer={() => setOuverte(false)} /> : null}
    </div>
  );
}
