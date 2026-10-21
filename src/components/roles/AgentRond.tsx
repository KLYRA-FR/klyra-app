import Image from "next/image";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { useRole } from "@/lib/workspace";
import type { RoleId } from "@/types/domain";

/** Ce que l'agent fait en ce moment, en pastille sur son rond. */
export type StatutAgent = { type: "travaille" } | { type: "non-lu"; nombre: number } | null;

interface AgentRondProps {
  roleId: RoleId;
  /** Diamètre en px : 24 dans le fil, 36 dans la barre latérale, 40+ en en-tête. */
  taille?: number;
  statut?: StatutAgent;
  /** Couleur du liseré de la pastille : celle du fond sur lequel le rond est posé. */
  fondPastille?: "page" | "surface";
  className?: string;
}

/**
 * Avatar d'un agent, le même partout (circuits, fil, barre latérale) : son
 * pastel uni et son initiale dans sa couleur foncée. Le Principal porte le
 * signe KLYRA blanc sur K1.
 */
export function AgentRond({ roleId, taille = 32, statut = null, fondPastille = "page", className }: AgentRondProps) {
  const role = useRole(roleId);
  const { haut, encre } = AGENT_PASTELS[role.teinte];
  const principal = roleId === "principal";
  const liseré = fondPastille === "page" ? "border-fond-page" : "border-fond-surface";

  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: taille, height: taille }}>
      <span
        role="img"
        aria-label={role.name}
        className={cn(
          "flex size-full items-center justify-center rounded-full font-semibold select-none",
          principal && "bg-bleu-k1-500",
        )}
        style={{
          background: principal ? undefined : haut,
          color: encre,
          fontSize: Math.round(taille * 0.4),
        }}
      >
        {principal ? (
          <Image
            src="/brand/logo-signe-white.svg"
            alt=""
            width={Math.round(taille * 0.5)}
            height={Math.round(taille * 0.5)}
          />
        ) : (
          role.initial
        )}
      </span>

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
