"use client";

import { useMemo, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { listeMesAgents, type LigneAgent } from "@/lib/telephone/agents";
import { MessageErreur } from "./Controles";
import { useCartesEspace, useConversationsEspace } from "@/lib/telephone/espace";

/**
 * Pièces communes aux écrans Agents, Artefacts et Réglages du téléphone : les cartes d'agents du
 * compte, la page pleine (sans barre du bas), le champ à 16 px, le bouton « ⋯ », l'erreur d'un geste.
 */

/** Les cartes d'agents et les conversations du compte (M-4), rangées comme Mes agents. */
export function useCartesAgents() {
  const cartes = useCartesEspace();
  const conversations = useConversationsEspace();
  const liste = useMemo(() => (cartes ? listeMesAgents(cartes, conversations ?? []) : null), [cartes, conversations]);
  const carte = (id: string): LigneAgent | null => (liste ? ([liste.assistant, ...liste.actifs, ...liste.hors].find((a) => a.id === id) ?? null) : null);
  return { cartes, conversations, liste, carte };
}

/** Formulaire pleine page : celle du socle (§ 4.4), qui monte du bas par-dessus la barre d'onglets. */
export { PagePleine } from "./PagePleine";

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
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : aide ? <span className="text-ui-xs text-texte-secondaire">{aide}</span> : null}
    </label>
  );
}

/** Classes d'un `Input` ou d'un `Textarea` de klyra-ui sur le téléphone : le champ du socle (§ 6.3), 16 px. */
export { CHAMP_KLYRA_UI as CHAMP_TELEPHONE } from "./Controles";

/**
 * Des `Onglets` segmentés sur le téléphone (socle § 6.3, C-6) : segments de 40 px dans le rail de 2 px,
 * chacun touché sur les 44 px du rail (un pseudo-élément prolonge la cible en haut et en bas).
 */
export const ONGLETS_TELEPHONE =
  "flex w-full [&>[role=tab]]:relative [&>[role=tab]]:min-h-10 [&>[role=tab]]:flex-1 [&>[role=tab]]:justify-center [&>[role=tab]]:text-ui [&>[role=tab]]:after:absolute [&>[role=tab]]:after:inset-x-0 [&>[role=tab]]:after:-inset-y-0.5";

/** L'erreur d'un geste, sous ce qui l'a déclenché. */
export function ErreurGeste({ message, className }: { message: string | null | undefined; className?: string }) {
  if (!message) return null;
  return <MessageErreur className={className}>{message}</MessageErreur>;
}

/** Un petit titre de groupe dans une liste. */
export function TitreGroupe({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 mb-1 text-ui font-medium text-texte-secondaire">{children}</h2>;
}
