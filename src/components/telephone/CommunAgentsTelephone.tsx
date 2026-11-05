"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { couleurAgent, fondCarte } from "@/components/team/AgentVisuel";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { listeMesAgents, type LigneAgent } from "@/lib/telephone/agents";
import type { RoleTeinte } from "@/types/domain";
import { MessageErreur } from "./Controles";
import { MenuFeuille, type ActionMenu } from "./Feuille";
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

/** Le « ⋯ » d'une page et son menu : « Relire » y reste, à côté du geste de tirer (M-9). */
export function MenuPage({ titre, actions }: { titre: string; actions: ActionMenu[] }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <BoutonIcone variant="discret" className="size-11" libelle="Plus d’options" aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => setOuvert(true)} />
      {ouvert ? <MenuFeuille titre={titre} actions={actions} onFermer={() => setOuvert(false)} /> : null}
    </>
  );
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

/** Le rond d'un agent du téléphone : le visuel de sa fiche, avec ce qu'il fait en pastille (comme `AgentRond`). */
export function RondAgentTelephone({ agentId, nom, teinte, taille = 44, nonLus = 0, travaille = false, grise = false }: { agentId: string; nom: string; teinte: RoleTeinte; taille?: number; nonLus?: number; travaille?: boolean; grise?: boolean }) {
  return (
    <span className={cn("relative inline-flex shrink-0", grise && "grayscale")}>
      <RondApercu agentId={agentId} nom={nom} teinte={teinte} taille={taille} />
      {travaille ? (
        <span aria-hidden="true" className="klyra-surface-sombre absolute -right-[5px] -bottom-[3px] flex h-4 w-6 items-center justify-center gap-[2px] rounded-full border-2 border-fond-surface">
          {[0, 1, 2].map((i) => (
            <span key={i} className="klyra-point-travail size-[3px] rounded-full bg-texte-inverse" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </span>
      ) : nonLus > 0 ? (
        <span aria-hidden="true" className="absolute -right-[5px] -bottom-[3px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-fond-surface bg-bleu-k1-500 px-1 text-ui-3xs leading-none font-semibold text-texte-inverse">
          {nonLus > 9 ? "9+" : nonLus}
        </span>
      ) : null}
    </span>
  );
}

/** « • Dev · Développeur web » : le rôle court d'un agent, puis son rôle long s'il dit autre chose. */
export function LigneRoleAgent({ teinte, role, titre, className }: { teinte: RoleTeinte; role: string; titre?: string | null; className?: string }) {
  if (!role && !titre) return null;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-ui text-texte-principal", className)}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: couleurAgent(teinte) }} />
      {role ? <span className="shrink-0 font-semibold">{role}</span> : null}
      {titre && titre !== role ? <span className="min-w-0 truncate text-texte-secondaire">{role ? "· " : ""}{titre}</span> : null}
    </span>
  );
}

/** Le haut d'une fiche : la coque teintée, l'avatar 64, son nom, ses étiquettes, ses gestes, son pied. */
export function HeroAgent({
  agentId,
  nom,
  teinte,
  role,
  titre,
  etiquettes,
  actions,
  pied,
  etat,
  travaille = false,
  eclaire = false,
  onFinEclairage,
}: {
  agentId: string;
  nom: string;
  teinte: RoleTeinte;
  role: string;
  titre?: string | null;
  etiquettes?: ReactNode;
  actions?: ReactNode;
  pied?: ReactNode;
  etat?: ReactNode;
  travaille?: boolean;
  eclaire?: boolean;
  onFinEclairage?: () => void;
}) {
  return (
    <article className="rounded-2xl p-1.5" style={{ backgroundImage: fondCarte(teinte) }}>
      <div className="klyra-eclaire-surface rounded-xl border border-white bg-fond-surface p-4" data-eclaire={eclaire ? "" : undefined} onAnimationEnd={onFinEclairage}>
        <div className="flex items-center gap-3.5">
          <RondAgentTelephone agentId={agentId} nom={nom} teinte={teinte} taille={64} travaille={travaille} />
          <div className="min-w-0">
            <h1 className="truncate text-h3 leading-[1.05] font-semibold tracking-title text-texte-principal">{nom}</h1>
            <LigneRoleAgent teinte={teinte} role={role} titre={titre} className="mt-1.5" />
          </div>
        </div>
        {etiquettes ? <div className="mt-3.5 flex flex-wrap gap-1.5">{etiquettes}</div> : null}
        {actions ? <div className="mt-4 flex gap-2">{actions}</div> : null}
      </div>
      {pied || etat ? (
        <div className="flex min-h-[30px] items-center justify-between gap-3 px-2 text-ui-xs text-texte-secondaire">
          <span className="min-w-0 truncate">{pied}</span>
          {etat}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Une ligne qui ouvre sa page, avec un geste à droite (Ajouter, Réactiver) : deux contrôles frères,
 * jamais un bouton dans un lien (lot 5 § 5). Le geste compact garde sa cible de 44 px.
 */
export function LigneAvecGeste({ href, debut, nom, etiquette, ligne2, geste }: { href: string; debut: ReactNode; nom: string; etiquette?: ReactNode; ligne2?: ReactNode; geste?: ReactNode }) {
  return (
    <li className="relative flex items-center [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-[68px] [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-bordure-defaut [&:not(:first-child)]:before:content-['']">
      <Link href={href} className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-4 no-underline transition-colors duration-[120ms] ease-sortie active:bg-fond-survol">
        {debut}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-body-s font-medium text-texte-principal">{nom}</span>
            {etiquette}
          </span>
          {ligne2 ? <span className="mt-0.5 line-clamp-2 block text-ui leading-[1.35] text-texte-secondaire">{ligne2}</span> : null}
        </span>
      </Link>
      {geste ? <span className="shrink-0 pr-3 [&_button]:relative [&_button]:after:absolute [&_button]:after:-inset-x-1 [&_button]:after:-inset-y-1.5">{geste}</span> : null}
    </li>
  );
}

/** L'en-tête d'une page pleine qui garde son propre pied et son défilement : ✕ et titre centré, comme `PagePleine`. */
export function EntetePagePleine({ titre, onFermer }: { titre: string; onFermer: () => void }) {
  return (
    <header className="shrink-0 bg-fond-page pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-1 px-1.5">
        <BoutonIcone variant="discret" className="size-11" libelle="Fermer" data-son="fermer" onClick={onFermer} icone={<Icon name="x-01" size={24} />} />
        <h1 className="min-w-0 flex-1 truncate text-center text-body-s font-semibold text-texte-principal">{titre}</h1>
        <span aria-hidden="true" className="size-11 shrink-0" />
      </div>
    </header>
  );
}
