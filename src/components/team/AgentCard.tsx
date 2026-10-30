import type { CSSProperties } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Role } from "@/types/domain";
import { couleurAgent, fondCarte } from "./AgentVisuel";

/** Longueur des compétences affichées sur la carte : trois lignes, à peu près. */
const LONGUEUR_COMPETENCES = 110;

/** Les compétences qui tiennent en entier, sans couper au milieu d'un mot (la fiche les a toutes). */
function competencesEntieres(skills: string[], longueur = LONGUEUR_COMPETENCES): string {
  const gardees: string[] = [];
  for (const skill of skills) {
    if (gardees.length > 0 && [...gardees, skill].join(" · ").length > longueur) break;
    gardees.push(skill);
  }
  return gardees.join(" · ");
}

/**
 * Carte d'un agent, forme « carte blanche » (maquette « Workspace card »,
 * à la hauteur de son contenu) : le dégradé pastel autour de deux blocs
 * blancs, qui il est, puis son nombre de conversations.
 * Toute la carte ouvre sa fiche.
 */
/** Le mot du rôle long qui correspond au rôle court : « Designer » pour
 *  « Design », « Prompt » pour « Prompts », « mail » pour « Mails ». */
function motCorrespondant(title: string, tag: string): { debut: number; fin: number } | null {
  const court = tag.toLowerCase();
  for (const m of title.matchAll(/[\p{L}]+/gu)) {
    const mot = m[0].toLowerCase();
    const proche = mot.startsWith(court) || (court.startsWith(mot) && mot.length >= 4);
    if (proche) return { debut: m.index, fin: m.index + m[0].length };
  }
  return null;
}

/**
 * Le rôle sur une seule ligne, sans répéter : le mot court en gras dans le
 * rôle long (« **Ops** et automatisation »), ou devant s'il n'y figure pas
 * (« **Ventes** · Head of sales »), ou seul s'ils sont identiques (« **QA** »).
 */
export function LigneRole({ tag, title }: { tag: string; title: string }) {
  if (!title || title.toLowerCase() === tag.toLowerCase()) return <span className="font-semibold">{tag}</span>;
  const mot = motCorrespondant(title, tag);
  if (!mot) {
    return (
      <>
        <span className="font-semibold">{tag}</span> <span className="text-texte-secondaire">· {title}</span>
      </>
    );
  }
  return (
    <>
      {title.slice(0, mot.debut)}
      <span className="font-semibold">{title.slice(mot.debut, mot.fin)}</span>
      {title.slice(mot.fin)}
    </>
  );
}

/** Une étiquette d'état ou d'origine, à droite du nom (spec §7) : deux au plus. */
export interface Etiquette {
  texte: string;
  ton: "neutre" | "accent" | "a-configurer";
}

export function EtiquetteAgent({ etiquette }: { etiquette: Etiquette }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xs px-2 py-0.5 text-ui-2xs font-medium whitespace-nowrap",
        etiquette.ton === "accent" ? "bg-fond-teinte-bleue text-texte-principal" : "bg-fond-surface-grise text-texte-principal",
      )}
    >
      {etiquette.ton === "a-configurer" && <span aria-hidden="true" className="size-1.5 rounded-full bg-bordure-forte" />}
      {etiquette.texte}
    </span>
  );
}

/** Cascade des cartes : la première arrive après le bandeau, puis une toutes les 60 ms. */
const DEBUT_CASCADE = 240;
const PAS_CASCADE = 60;

export function AgentCard({
  role,
  chatCount,
  ordre = 0,
  etiquettes = [],
}: {
  role: Role;
  chatCount: number;
  /** Rang dans la grille : règle le moment de son entrée. */
  ordre?: number;
  etiquettes?: Etiquette[];
}) {
  const delai = DEBUT_CASCADE + ordre * PAS_CASCADE;
  const BLOC = "relative z-10 flex shrink-0 flex-col rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm";

  return (
    <Link
      href={`/equipe?agent=${role.id}`}
      style={{ backgroundImage: fondCarte(role.teinte), "--delai": `${delai}ms` } as CSSProperties}
      className={cn(
        "klyra-entree group relative isolate flex flex-col gap-2 overflow-hidden rounded-2xl p-2 no-underline",
        "transition-[box-shadow,transform] duration-[300ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-ambiante",
      )}
    >
      {/* Qui il est : prénom en haut, son rôle, puis ce qu'il couvre en bas. */}
      <div className={cn(BLOC, "gap-2")}>
        <div className="flex flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="m-0 min-w-0 flex-1 truncate text-h4 leading-[28px] font-semibold tracking-[-0.02em] text-texte-principal">{role.name}</h2>
            {etiquettes.slice(0, 2).map((e) => (
              <EtiquetteAgent key={e.texte} etiquette={e} />
            ))}
          </div>
          <p className="m-0 flex min-w-0 items-center gap-1.5 text-ui-s leading-[1.35] text-texte-principal">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: couleurAgent(role.teinte) }} />
            <span className="truncate">
              <LigneRole tag={role.tag} title={role.title} />
            </span>
          </p>
        </div>
        {/* Toujours deux lignes de haut : toutes les cartes ont la même hauteur. */}
        <p className="m-0 line-clamp-2 min-h-[2lh] text-ui-xs leading-[1.35] text-texte-tertiaire">{competencesEntieres(role.skills, 80)}</p>
      </div>

      {/* Ses conversations sur ce poste, et l'accès à sa fiche. */}
      <div className={cn(BLOC, "gap-1.5")}>
        <span className="flex items-baseline justify-between gap-2 text-ui-xs">
          <span className="text-texte-principal">
            {chatCount === 0 ? "Aucune conversation" : (
              <><span className="font-semibold">{chatCount}</span> {chatCount === 1 ? "conversation" : "conversations"}</>
            )}
          </span>
          <span className="text-texte-tertiaire transition-colors duration-[120ms] group-hover:text-texte-accent">Voir la fiche</span>
        </span>
      </div>
    </Link>
  );
}
