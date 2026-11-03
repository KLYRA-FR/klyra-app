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
  // L'assistant principal porte l'icône KLYRA : le signe blanc sur K1 (public/brand/logo-icone.svg).
  if (agentId === "principal") {
    return (
      <div aria-hidden="true" className={cn("relative h-full w-full overflow-hidden bg-bleu-k1-500 text-texte-inverse", className)}>
        <svg viewBox="0 0 140.2 140.2" fill="none" className="absolute inset-0 size-full">
          <path
            d="M61.2218 80.3443V109.021H32.5451V80.3443H61.2218ZM61.2218 32.5474V54.0552C61.2219 56.0413 62.0286 57.8259 63.3244 59.1216L89.8986 32.5474H109.005V51.6655L80.3292 80.3423H97.2482C98.6606 80.3423 100.01 80.8939 101.008 81.8921L109.016 89.9009V109.018H89.8986L35.6574 54.7769C33.6607 52.7908 32.5451 50.0826 32.5451 47.2681V32.5474H61.2218Z"
            fill="currentColor"
          />
        </svg>
      </div>
    );
  }
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
