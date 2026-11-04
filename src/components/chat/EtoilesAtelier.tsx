"use client";

import { Icon } from "@/components/icons/Icon";
import { Infobulle } from "@/components/ui/Infobulle";
import { PILIERS, type Pilier } from "@/lib/atelier-agent";
import { cn } from "@/lib/cn";
import { SEUIL_FICHE_LONGUE } from "@/lib/poids-fiche";

/** Les cinq étoiles et la jauge de l'atelier d'un agent : la carte du bureau et celle du téléphone. */

/**
 * Les cinq piliers. `animer` : ceux qui viennent de s'allumer (l'étoile tourne en s'allumant) ;
 * `alerte` : ceux qu'un essai raté de l'épreuve met en doute (l'étoile clignote, orange).
 */
export function Etoiles({ remplis, animer, alerte, taille = 16 }: { remplis: Set<Pilier>; animer?: Set<Pilier>; alerte?: Set<Pilier>; taille?: number }) {
  const libelle = `${remplis.size} pilier${remplis.size > 1 ? "s" : ""} sur 5${remplis.size ? ` : ${PILIERS.filter((p) => remplis.has(p.cle)).map((p) => p.titre.toLowerCase()).join(", ")}` : ""}`;
  return (
    <span role="img" aria-label={libelle} className="flex items-center gap-0.5">
      {PILIERS.map((p, i) => {
        const allume = remplis.has(p.cle);
        const enAlerte = !!alerte?.has(p.cle);
        return (
          <Infobulle key={p.cle} texte={`${p.titre}${enAlerte ? " : à corriger après l’épreuve" : allume ? "" : " : à remplir"}`} cote="haut">
            {/* La clé suit l'état : une étoile qui s'allume repart de zéro, son animation aussi. */}
            <span
              key={allume ? "allumee" : "eteinte"}
              aria-hidden="true"
              className={cn(
                "flex",
                enAlerte ? "klyra-etoile-alerte text-texte-accent-orange" : allume ? "text-icone-accent" : "text-bordure-forte",
                allume && animer?.has(p.cle) && "klyra-etoile-allumee",
              )}
              style={allume && animer?.has(p.cle) ? { animationDelay: `${i * 60}ms` } : undefined}
            >
              <Icon name="stars" size={taille} />
            </span>
          </Infobulle>
        );
      })}
    </span>
  );
}

/** Le poids de la fiche, relue à chaque appel ; le trait marque les 1 500 jetons conseillés. */
export function Jauge({ jetons, fond = "bg-white/70" }: { jetons: number; fond?: string }) {
  const lourde = jetons > SEUIL_FICHE_LONGUE;
  const echelle = SEUIL_FICHE_LONGUE / 0.6;
  return (
    <span className="flex w-[112px] flex-col gap-1">
      <span className={cn("klyra-mono text-right text-ui-2xs", lourde ? "text-texte-accent-orange" : "text-texte-secondaire")}>
        ~{jetons.toLocaleString("fr-FR")} jetons
      </span>
      <span
        role="meter"
        aria-label="Poids de la fiche, relue à chaque appel de l’agent"
        aria-valuemin={0}
        aria-valuemax={Math.round(echelle)}
        aria-valuenow={jetons}
        aria-valuetext={`Environ ${jetons.toLocaleString("fr-FR")} jetons${lourde ? ", au-delà des 1 500 conseillés" : ""}`}
        className={cn("relative h-1.5 rounded-pill", fond)}
      >
        <span
          className={cn("absolute inset-y-0 left-0 rounded-pill transition-[width] duration-[480ms] ease-sortie", lourde ? "bg-orange-k1-500" : "bg-bleu-k1-500")}
          style={{ width: `${Math.min(jetons / echelle, 1) * 100}%` }}
        />
        <span aria-hidden="true" className="absolute -top-[3px] -bottom-[3px] left-[60%] w-0.5 rounded-pill bg-texte-principal/35" />
      </span>
    </span>
  );
}

