"use client";

import { useMemo, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { MODELES, type AgentLocal } from "@/lib/agents";
import type { DefinitionResume } from "@/lib/bibliotheque";
import { useBibliotheque } from "@/lib/bibliotheque";
import { getBridge, unwrap } from "@/lib/bridge";
import type { CollegueCite } from "@/lib/bibliotheque-ui";
import type { Session } from "@/lib/lien-bibliotheque";
import type { RoleSection } from "@/types/domain";

/**
 * Une `Modale` large dont le corps défile : titre et boutons restent visibles à 700 px de haut.
 * (La Modale pose le titre et le texte dans un premier bloc, puis les boutons.)
 */
export const MODALE_DEFILANTE =
  "max-h-[calc(100vh-96px)] max-w-none [&>div:first-child]:min-h-0 [&>div:first-child>div]:-mx-1 [&>div:first-child>div]:min-h-0 [&>div:first-child>div]:overflow-y-auto [&>div:first-child>div]:px-1 [&>div:first-child>div]:py-1";

/** Étiquette grise de métadonnée, comme dans la fiche d'un agent. */
export function Meta({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xs bg-fond-surface-grise px-2.5 py-1 text-ui-xs font-medium text-texte-principal"
    >
      {children}
    </span>
  );
}

/** Un état à la place des cartes d'un groupe (chargement, non connecté, hors ligne…). */
export function BlocEtat({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bordure-subtile bg-fond-page p-5">
      <p className="m-0 text-ui text-texte-secondaire">{children}</p>
      {action}
    </div>
  );
}

/** Le bloc commun à toute l'équipe, replié (même rendu que dans la fiche d'un agent). */
export function ParlerEnEquipe({ section }: { section: RoleSection }) {
  return (
    <details className="group rounded-3xl border border-bordure-subtile bg-fond-page p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-ui font-semibold text-texte-principal">
        <Icon name="chevron-right" size={16} className="text-icone-secondaire transition-transform duration-[220ms] ease-sortie group-open:rotate-90" />
        {section.title}
        <span className="font-normal text-texte-tertiaire">· bloc commun à toute l’équipe</span>
      </summary>
      <Markdown source={section.body} className="mt-4" />
    </details>
  );
}

/** Ordre des sections, comme dans la fiche d'un agent : le bloc commun tout en bas. */
export function rangSection(section: RoleSection): number {
  if (/^Critères de sortie/i.test(section.title)) return 0;
  if (/^Parler en équipe/i.test(section.title)) return 3;
  if (/^Ce que je ne fais pas/i.test(section.title)) return 2;
  return 1;
}

/** Le sélecteur de dossier du système, celui des projets. null si on annule ou hors de l'app de bureau. */
export async function choisirDossier(): Promise<string | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return unwrap(await bridge.projets.choisirDossier());
}

/** Ce que `lienDe` doit savoir de la session en cours. */
export function useSession(): Session {
  const { etat, moiId, etats } = useBibliotheque();
  return useMemo(() => ({ etat, moiId, etats }), [etat, moiId, etats]);
}

/** L'agent de cet ordinateur qui vient de cette définition (reçu ou copie privée), le plus actif d'abord. */
export function agentDeDefinition(tous: AgentLocal[], definitionId: string): AgentLocal | null {
  const lies = tous.filter((a) => {
    const o = a.entree?.origine;
    return (o?.type === "bibliotheque" || o?.type === "copie") && o.definitionId === definitionId;
  });
  return lies.find((a) => a.statut === "actif") ?? lies[0] ?? null;
}

/** L'agent de cet ordinateur qui a publié cette définition sous la session en cours. */
export function agentPublie(tous: AgentLocal[], definitionId: string, moiId: string | null): AgentLocal | null {
  if (!moiId) return null;
  return (
    tous.find((a) => {
      const o = a.entree?.origine;
      return o?.type === "local" && o.publie?.definitionId === definitionId && o.publie.compte === moiId;
    }) ?? null
  );
}

export type EtatCollegue =
  | { type: "actif"; nom: string }
  | { type: "hors"; nom: string }
  | { type: "modele"; nom: string }
  | { type: "partage"; nom: string; definition: DefinitionResume }
  | { type: "introuvable" };

/** Où est un collègue cité : dans Mes agents, hors de Mes agents, dans la bibliothèque, ou nulle part. */
export function etatCollegue(c: CollegueCite, tous: AgentLocal[], definitions: DefinitionResume[]): EtatCollegue {
  const local = tous.find((a) => a.role.id === c.id);
  if (local) return local.statut === "actif" ? { type: "actif", nom: local.role.name } : { type: "hors", nom: local.role.name };
  const modele = MODELES.find((m) => m.name === c.id);
  if (modele) return { type: "modele", nom: modele.role.name };
  const definition = definitions.find((d) => d.slug === c.id);
  return definition ? { type: "partage", nom: definition.nom, definition } : { type: "introuvable" };
}

/** Le texte d'un collègue dans « Il passe la main à » et « Ce qu'il lui faut ». */
export function texteCollegue(c: CollegueCite, etat: EtatCollegue): string {
  switch (etat.type) {
    case "actif":
      return `${etat.nom} (${c.id}) · dans tes agents`;
    case "hors":
      return `${etat.nom} (${c.id}) · hors de tes agents`;
    case "modele":
    case "partage":
      return `${etat.nom} (${c.id}) · dans la bibliothèque`;
    case "introuvable":
      return `${c.name} (${c.id}) · introuvable : il fera sans, ou te le dira`;
  }
}
