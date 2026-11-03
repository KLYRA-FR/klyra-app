"use client";

import { useRouter } from "next/navigation";
import { adopter } from "@/components/reglages/ConfigurationKlyra";
import { Bouton } from "@/components/ui/Bouton";
import { useReglages } from "@/lib/reglages";
import { estRecommandee } from "../../../electron/configuration-klyra";

/**
 * Sur l'Accueil, une fois : la configuration KLYRA recommandée, à adopter en un clic. Jamais appliquée
 * d'office ; « Non merci » ne la propose plus ici (elle reste dans Réglages › Agents).
 */
export function CarteConfiguration() {
  const router = useRouter();
  const { reglages, systeme, changerConfiguration } = useReglages();
  const configuration = reglages?.configuration;
  if (!systeme || !configuration || configuration.proposition !== "a-proposer" || estRecommandee(configuration)) return null;

  return (
    <section aria-label="Configuration KLYRA" data-carte-configuration className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl border border-bordure-subtile bg-fond-page px-5 py-4">
      <div className="flex min-w-[240px] flex-1 flex-col gap-1">
        <h2 className="m-0 text-ui font-semibold text-texte-principal">Des agents plus économes</h2>
        <p className="m-0 text-ui-s leading-[1.45] text-texte-secondaire">
          KLYRA te propose sa configuration : des consignes qui évitent le travail inutile, et la mémoire des agents coupée, environ 4 000 jetons de moins à
          chaque appel d’un agent qui en a une. Tout reste modifiable dans Réglages › Agents.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Bouton variant="discret" taille="compact" onClick={() => void changerConfiguration({ proposition: "ecartee" })}>
          Non merci
        </Bouton>
        <Bouton variant="blanc" taille="compact" onClick={() => router.push("/reglages?section=agents")}>
          Voir le détail
        </Bouton>
        <Bouton variant="sombre" taille="compact" onClick={() => void changerConfiguration(adopter(configuration))}>
          Adopter
        </Bouton>
      </div>
    </section>
  );
}
