import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import type { RoleTeinte } from "@/types/domain";
import { AgentFormes } from "./AgentFormes";

/** Couleur d'aperçu d'une teinte (pastilles du sélecteur de couleur). */
export const TEINTES: Record<RoleTeinte, string> = Object.fromEntries(
  Object.entries(AGENT_PASTELS).map(([teinte, p]) => [teinte, p.haut]),
) as Record<RoleTeinte, string>;

/** Fond pastel d'une carte d'agent : clair en haut à gauche, plus soutenu en bas à droite. */
export function fondCarte(teinte: RoleTeinte): string {
  const { haut, bas } = AGENT_PASTELS[teinte];
  return `linear-gradient(147.66deg, ${bas} 0.4%, ${haut} 93.65%)`;
}

/** Couleur pleine d'un agent : barres de progression, pastilles. */
export function couleurAgent(teinte: RoleTeinte): string {
  return AGENT_PASTELS[teinte].accent;
}

/**
 * Visuel d'un agent hors de sa carte (en-tête de fiche, aperçu de l'éditeur) :
 * son fond pastel et ses formes blanches, centrées.
 */
export function AgentVisuel({ agentId, teinte, className }: { agentId: string; teinte: RoleTeinte; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("group relative h-full w-full overflow-hidden", className)}
      style={{ backgroundImage: fondCarte(teinte) }}
    >
      {/* Les formes, centrées dans le bloc, quelle que soit sa taille. */}
      <AgentFormes agentId={agentId} className="absolute top-1/2 left-1/2 aspect-square h-[78%] max-h-[220px] w-auto -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}
