import { Fragment, type CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { cn } from "@/lib/cn";
import { useRoles } from "@/lib/workspace";
import type { Role, RoleId, TeamCircuit } from "@/types/domain";

/**
 * Icône d'une étape qui n'est pas tenue par un agent précis, sans contour :
 * - la coche pixel pour ce qui passe ou qui sort (Corentin valide, Validation,
 *   Publication) ;
 * - le signe KLYRA en bleu pour « n'importe quel agent de l'équipe » (Agent concerné).
 */
function RondHumain({ label }: { label: string }) {
  return /valid|publication/i.test(label) ? (
    <PixelCheck className="h-[13px] w-[18px] shrink-0" />
  ) : (
    <Image src="/brand/logo-signe.svg" alt="" width={16} height={16} className="size-4 shrink-0" />
  );
}

/** Rond d'initiale d'un agent : son pastel uni (le plus soutenu, celui du bas
 *  de sa carte), l'initiale dans sa couleur foncée. À 32 px, un dégradé ne se voit pas.
 *  `inverse` : rond blanc, quand c'est la capsule qui porte la couleur. */
function Rond({ role, inverse = false }: { role: Role; inverse?: boolean }) {
  const { haut, encre } = AGENT_PASTELS[role.teinte];
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-ui-xs font-semibold"
      style={{ background: inverse ? "var(--color-fond-surface)" : haut, color: encre }}
    >
      {role.initial}
    </span>
  );
}

/** Liaison entre deux étapes : un rond qui part de la carte, des pointillés, un rond qui arrive à la suivante. */
function Liaison({ delai }: { delai: number }) {
  return (
    // Les ronds mordent de 3 px sur le bord des capsules : la liaison part du bloc.
    <li
      aria-hidden="true"
      className="klyra-entree relative z-10 -mx-[3px] flex h-7 min-w-5 flex-1 items-center"
      style={{ "--delai": `${delai}ms`, "--duree-entree": "220ms" } as CSSProperties}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-gris-k1-100" />
      {/* Les pointillés se tracent d'une étape à la suivante ; la lueur des circuits
          (CircuitsAnimes) glisse dessus. */}
      <span className="klyra-trace klyra-pointilles flex-1" style={{ "--delai": `${delai}ms` } as CSSProperties} />
      <span className="size-1.5 shrink-0 rounded-full bg-gris-k1-100" />
    </li>
  );
}

/**
 * Un circuit de passation sur une ligne : son nom à gauche, puis ses étapes de
 * gauche à droite (l'agent qui la tient, ou un humain), reliées par un rond,
 * des pointillés et un rond. L'agent mis en avant (`highlight`) ressort.
 */
/** Rythme de l'entrée : une ligne toutes les 120 ms, une étape toutes les 110 ms. */
const PAS_LIGNE = 120;
const PAS_ETAPE = 110;

export function CircuitRow({
  circuit,
  highlight,
  ordre = 0,
  refRangee,
}: {
  circuit: TeamCircuit;
  highlight?: RoleId;
  /** Rang de la ligne : règle le moment de son entrée (dans une Apparition). */
  ordre?: number;
  /** Reçoit la rangée des étapes : la lueur des circuits y glisse. */
  refRangee?: (el: HTMLOListElement | null) => void;
}) {
  const roles = useRoles();
  const debut = ordre * PAS_LIGNE;
  return (
    <div
      className="klyra-entree @container klyra-carte-flottante rounded-lg p-3"
      style={{ "--delai": `${debut}ms` } as CSSProperties}
    >
      <div className="flex flex-col gap-3 @4xl:flex-row @4xl:items-center @4xl:gap-4">
        <span className="shrink-0 px-2 text-ui font-semibold text-texte-principal @4xl:w-[180px]">{circuit.title}</span>
        {/* Les étapes gardent leur taille, les pointillés remplissent la ligne ; sinon elles passent à la ligne. */}
        <ol ref={refRangee} className="m-0 flex min-w-0 flex-1 list-none flex-wrap items-center gap-y-2 px-0 py-1">
          {circuit.steps.map((step, i) => {
            const role = roles.find((r) => r.id === step.roleId);
            // Chaque étape est une capsule de 42 px, arrondie au complet. Agent : le rond
            // de 32 px a 4 px d'air partout (haut, bas, gauche). Humain : l'icône près
            // du mot, et l'espace à gauche.
            // L'agent mis en avant : couleurs inversées, sa capsule prend son pastel, son rond devient blanc.
            const enAvant = !!role && role.id === highlight;
            const carte = (
              <span
                className={cn(
                  "flex h-[42px] items-center rounded-full border pr-4",
                  role ? "gap-2 pl-1" : "gap-1.5 pl-3",
                  !enAvant && "border-bordure-subtile bg-fond-page",
                  role && "transition-colors duration-[220ms] ease-sortie hover:border-bordure-forte",
                )}
                style={enAvant ? { background: AGENT_PASTELS[role.teinte].haut, borderColor: AGENT_PASTELS[role.teinte].haut } : undefined}
              >
                {role ? <Rond role={role} inverse={enAvant} /> : <RondHumain label={step.label} />}
                <span className="flex flex-col leading-[1.25] whitespace-nowrap">
                  <span className="text-ui-s font-semibold text-texte-principal">{role ? role.name : step.label}</span>
                  {role && <span className="text-ui-xs text-texte-tertiaire">{step.label}</span>}
                </span>
              </span>
            );
            return (
              <Fragment key={`${circuit.id}-${i}`}>
                {i > 0 && <Liaison delai={debut + 150 + i * PAS_ETAPE - 70} />}
                <li className="klyra-entree flex shrink-0" style={{ "--delai": `${debut + 150 + i * PAS_ETAPE}ms` } as CSSProperties}>
                  {role ? (
                    <Link href={`/equipe?agent=${role.id}`} className="flex no-underline">
                      {carte}
                    </Link>
                  ) : (
                    carte
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
