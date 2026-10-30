import { AgentVisuel } from "@/components/team/AgentVisuel";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { useRole } from "@/lib/workspace";
import type { RoleId, RoleTeinte } from "@/types/domain";

/** Ce que l'agent fait en ce moment, en pastille sur son rond. */
export type StatutAgent = { type: "travaille" } | { type: "non-lu"; nombre: number } | null;

interface AgentRondProps {
  roleId: RoleId;
  /** Diamètre en px : 24 dans le fil, 36 dans la barre latérale, 40+ en en-tête. */
  taille?: number;
  statut?: StatutAgent;
  /** Couleur du liseré de la pastille : celle du fond sur lequel le rond est posé. */
  fondPastille?: "page" | "surface";
  /** Le visuel de sa fiche (fond pastel et formes) à la place de l'initiale : liste des agents. */
  visuel?: boolean;
  className?: string;
}

/** Le carré de couleur et l'initiale, commun à tous les avatars d'agent. */
function Carre({ libelle, initiale, teinte, taille }: { libelle: string; initiale: string; teinte: RoleTeinte; taille: number }) {
  const { haut, encre } = AGENT_PASTELS[teinte];
  return (
    <span
      role="img"
      aria-label={libelle}
      className="flex size-full items-center justify-center font-semibold select-none"
      style={{
        background: haut,
        color: encre,
        fontSize: Math.round(taille * 0.4),
        // Un carré, arrondi au quart de son côté : 8 px pour 32, 6 px pour 24.
        borderRadius: Math.round(taille * 0.25),
      }}
    >
      {initiale}
    </span>
  );
}

/**
 * Avatar d'un agent, le même partout (fil, barre latérale) : un
 * carré arrondi à son pastel uni, son initiale dans sa couleur foncée.
 * L'assistant suit la même règle, avec le nom et la couleur choisis.
 * Avec `visuel`, le carré reprend en petit l'illustration de sa fiche.
 */
export function AgentRond({ roleId, taille = 32, statut = null, fondPastille = "page", visuel = false, className }: AgentRondProps) {
  const role = useRole(roleId);
  const liseré = fondPastille === "page" ? "border-fond-page" : "border-fond-surface";

  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: taille, height: taille }}>
      {visuel ? (
        <span role="img" aria-label={role.name} className="size-full overflow-hidden" style={{ borderRadius: Math.round(taille * 0.25) }}>
          <AgentVisuel agentId={role.id} teinte={role.teinte} />
        </span>
      ) : (
        <Carre libelle={role.name} initiale={role.initial} teinte={role.teinte} taille={taille} />
      )}

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

/** Le rond d'un agent qui n'est pas encore enregistré (aperçu d'un nom et d'une couleur, proposition de l'assistant). */
export function RondApercu({
  nom,
  teinte,
  taille = 32,
  libelle,
  className,
}: {
  nom: string;
  teinte: RoleTeinte;
  taille?: number;
  /** Ce que lit un lecteur d'écran ; par défaut, le nom. */
  libelle?: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: taille, height: taille }}>
      <Carre libelle={libelle ?? nom} initiale={nom.trim().charAt(0).toUpperCase()} teinte={teinte} taille={taille} />
    </span>
  );
}
