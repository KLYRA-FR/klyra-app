"use client";

import { useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { listeMesAgents, type LigneAgent } from "@/lib/telephone/agents";

/**
 * Pièces communes aux écrans Agents, Artefacts et Réglages du téléphone : les cartes d'agents du
 * compte, la page pleine (sans barre du bas), le champ à 16 px, le bouton « ⋯ », l'erreur d'un geste.
 */

/** Les cartes d'agents et les conversations du compte (M-4), rangées comme Mes agents. */
export function useCartesAgents() {
  const cartes = useQuery(api.conversationsCompte.agents, {});
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const liste = useMemo(() => (cartes ? listeMesAgents(cartes, conversations ?? []) : null), [cartes, conversations]);
  const carte = (id: string): LigneAgent | null => (liste ? ([liste.assistant, ...liste.actifs, ...liste.hors].find((a) => a.id === id) ?? null) : null);
  return { cartes, conversations, liste, carte };
}

/** Formulaire pleine page (spec § 3) : par-dessus la barre du bas, qui disparaît. */
export function PagePleine({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-30 flex flex-col bg-fond-page">{children}</div>;
}

/** Le bouton « ⋯ » d'un en-tête ou d'une ligne (M-9 : le même menu que l'appui long). */
export function BoutonMenu({ libelle, onClick }: { libelle: string; onClick: () => void }) {
  return <BoutonIcone variant="discret" taille="md" libelle={libelle} icone={<Icon name="dot-horizontal" size={20} />} onClick={onClick} />;
}

/** Un champ de formulaire du téléphone : libellé, contrôle en 16 px, aide ou erreur lisibles (AA). */
export function ChampTelephone({ label, aide, erreur, children, className }: { label: string; aide?: ReactNode; erreur?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className="text-ui font-medium text-texte-principal">{label}</span>
      {children}
      {erreur ? (
        <span role="alert" className="text-ui-xs text-texte-erreur">
          {erreur}
        </span>
      ) : aide ? (
        <span className="text-ui-xs text-texte-secondaire">{aide}</span>
      ) : null}
    </label>
  );
}

/** Classes d'un `Input` ou d'un `Textarea` de klyra-ui sur le téléphone : 16 px, sinon Safari zoome au focus. */
export const CHAMP_TELEPHONE = "rounded-md border-bordure-champ text-body-s";

/** L'erreur d'un geste, sous ce qui l'a déclenché. */
export function ErreurGeste({ message, className }: { message: string | null | undefined; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={cn("text-ui text-texte-erreur", className)}>
      {message}
    </p>
  );
}

/** Un petit titre de groupe dans une liste. */
export function TitreGroupe({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 mb-1 text-ui font-medium text-texte-secondaire">{children}</h2>;
}
