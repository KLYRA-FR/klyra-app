"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { RondApercu, VisuelAgent } from "@/components/roles/AgentRond";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { ROLE_TEINTES, type RoleTeinte } from "@/types/domain";
import { roleLisible } from "@/lib/telephone/agents";
import type { CarteAgentLue } from "@/lib/telephone/chats";

/**
 * Les agents vus du téléphone : leur carte d'identité copiée dans le compte (spec M-4), pas les fiches
 * de l'ordinateur. L'avatar est le même qu'au bureau : le visuel de la fiche, tiré de l'id et de la teinte.
 */

const teinteSure = (teinte: string | undefined): RoleTeinte => (ROLE_TEINTES as string[]).includes(teinte ?? "") ? (teinte as RoleTeinte) : "ocre";

export function useCartes() {
  const cartes = useQuery(api.conversationsCompte.agents, {});
  return useMemo(() => {
    /* C-2a : un rôle court qui n'est que l'id de l'agent (« redaction ») ne s'affiche pas. */
    const parId = new Map((cartes ?? []).map((c) => [c.origine, { ...c, roleCourt: roleLisible(c.roleCourt, c.origine) }]));
    return {
      cartes,
      carte: (id: string): CarteAgentLue | undefined => parId.get(id),
      nom: (id: string) => parId.get(id)?.nom ?? (id === "principal" ? "Ton assistant" : "Un agent"),
      teinte: (id: string) => teinteSure(parId.get(id)?.teinte),
      /** Le prénom dans la couleur foncée de l'agent, comme dans le fil du bureau. */
      encre: (id: string) => AGENT_PASTELS[teinteSure(parId.get(id)?.teinte)].encre,
    };
  }, [cartes]);
}

/** L'avatar d'un agent d'après sa carte (36 px dans les listes, 32 dans le fil). */
export function RondAgent({ id, taille = 36, libelle }: { id: string; taille?: number; libelle?: string }) {
  const { nom, teinte } = useCartes();
  return <RondApercu agentId={id} nom={nom(id)} teinte={teinte(id)} taille={taille} libelle={libelle} />;
}

/** Les visages d'une conversation d'équipe, quatre au plus, dans un carré de 36 px (comme au bureau). */
export function GrappeChat({ roleIds }: { roleIds: string[] }) {
  const { teinte } = useCartes();
  const visibles = roleIds.length > 4 ? roleIds.slice(0, 3) : roleIds.slice(0, 4);
  const reste = roleIds.length - visibles.length;
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 grid-cols-2 gap-[2px] rounded-sm bg-fond-surface-grise p-[2px]">
      {visibles.map((id) => (
        <VisuelAgent key={id} agentId={id} teinte={teinte(id)} rayon={5} className={visibles.length === 1 ? "col-span-2 row-span-2" : undefined} />
      ))}
      {reste > 0 ? <span className="flex items-center justify-center rounded-[5px] bg-fond-surface text-ui-xs font-semibold text-texte-secondaire">+{reste}</span> : null}
    </span>
  );
}
