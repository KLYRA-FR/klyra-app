import { AgentVisuel } from "@/components/team/AgentVisuel";
import { cn } from "@/lib/cn";
import { useRole } from "@/lib/workspace";
import type { RoleId, RoleTeinte } from "@/types/domain";

/** Ce que l'agent fait en ce moment, en pastille sur son rond. */
export type StatutAgent = { type: "travaille" } | { type: "non-lu"; nombre: number } | null;

interface AgentRondProps {
  roleId: RoleId;
  /** Côté en px : 24 dans le fil, 36 dans la barre latérale, 40+ en en-tête. */
  taille?: number;
  statut?: StatutAgent;
  /** Couleur du liseré de la pastille : celle du fond sur lequel le rond est posé. */
  fondPastille?: "page" | "surface";
  className?: string;
}

/** Un carré arrondi au quart de son côté : 8 px pour 32, 6 px pour 24. */
const rayonPour = (taille: number) => Math.round(taille * 0.25);

/**
 * Le visuel de la fiche d'un agent, en petit : le fond pastel de sa teinte et les formes
 * choisies par son id (`AgentVisuel`). Source unique de tout avatar d'agent (rond, aperçu,
 * grappe d'une conversation d'équipe) : jamais d'initiale ni de dessin à part.
 * Sans `libelle`, il est décoratif (le nom est écrit à côté).
 */
export function VisuelAgent({
  agentId,
  teinte,
  rayon,
  libelle,
  className,
}: {
  agentId: string;
  teinte: RoleTeinte;
  rayon: number;
  libelle?: string;
  className?: string;
}) {
  return (
    <span
      {...(libelle ? { role: "img", "aria-label": libelle } : { "aria-hidden": true })}
      data-avatar-agent={agentId}
      className={cn("block size-full overflow-hidden", className)}
      style={{ borderRadius: rayon }}
    >
      <AgentVisuel agentId={agentId} teinte={teinte} />
    </span>
  );
}

/**
 * Avatar d'un agent, le même partout et le même que sur sa fiche : son visuel
 * dans un carré arrondi. L'assistant suit la même règle, avec la couleur choisie ;
 * son nom ne change pas son dessin, qui dépend de son id.
 */
export function AgentRond({ roleId, taille = 32, statut = null, fondPastille = "page", className }: AgentRondProps) {
  const role = useRole(roleId);
  const liseré = fondPastille === "page" ? "border-fond-page" : "border-fond-surface";

  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: taille, height: taille }}>
      <VisuelAgent agentId={role.id} teinte={role.teinte} rayon={rayonPour(taille)} libelle={role.name} />

      {statut?.type === "travaille" && (
        <span
          aria-label={`${role.name} travaille`}
          className={cn(
            "klyra-surface-sombre absolute -right-[5px] -bottom-[3px] flex h-4 w-6 items-center justify-center gap-[2px] rounded-full border-2",
            liseré,
          )}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              className="klyra-point-travail size-[3px] rounded-full bg-texte-inverse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
      )}
      {statut?.type === "non-lu" && statut.nombre > 0 && (
        <span
          aria-label={`${statut.nombre} non lu${statut.nombre > 1 ? "s" : ""}`}
          className={cn(
            "absolute -right-[5px] -bottom-[3px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 bg-bleu-k1-500 px-1 text-ui-3xs leading-none font-semibold text-texte-inverse",
            liseré,
          )}
        >
          {statut.nombre > 9 ? "9+" : statut.nombre}
        </span>
      )}
    </span>
  );
}

/**
 * L'avatar d'un agent pas encore enregistré, avec la couleur choisie : celle de l'assistant
 * qu'on personnalise, ou la proposition de l'assistant, d'après l'id qu'elle recevra.
 */
export function RondApercu({
  agentId,
  nom,
  teinte,
  taille = 32,
  libelle,
  className,
}: {
  agentId: string;
  nom: string;
  teinte: RoleTeinte;
  taille?: number;
  /** Ce que lit un lecteur d'écran ; par défaut, le nom. */
  libelle?: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: taille, height: taille }}>
      <VisuelAgent agentId={agentId} teinte={teinte} rayon={rayonPour(taille)} libelle={libelle ?? nom} />
    </span>
  );
}
