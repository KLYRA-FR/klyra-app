"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Inline, Markdown } from "@/components/ui/Markdown";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { findColleagues } from "@/lib/agent-file";
import { cn } from "@/lib/cn";
import { useRoles } from "@/lib/workspace";
import type { Role, RoleSection, RoleTeinte } from "@/types/domain";
import { fondCarte } from "./AgentVisuel";

/* ─── Lecture d'une section ────────────────────────────────────── */

export interface Element {
  /** La partie en gras du début (« Le projet fait autorité »), s'il y en a une. */
  titre: string | null;
  texte: string;
  /** Lignes en retrait sous l'élément (sous-liste, paragraphe de suite). */
  suite: string;
}

/**
 * Découpe une section en éléments : les entrées d'une liste (« 1. », « - »)
 * ou les paragraphes qui commencent par du gras (« **Livrable** : … »).
 * null si la section n'en a pas au moins deux : elle s'affiche telle quelle.
 */
export function decouper(body: string): Element[] | null {
  const elements: { premiere: string; suite: string[] }[] = [];
  let enCours: { premiere: string; suite: string[] } | null = null;
  let dansCode = false;
  for (const ligne of body.split("\n")) {
    if (ligne.trim().startsWith("```")) dansCode = !dansCode;
    const liste = !dansCode && ligne.match(/^(?:\d+\.|-)\s+(.*)$/);
    const gras = !dansCode && /^\*\*/.test(ligne);
    if (liste || gras) {
      enCours = { premiere: liste ? liste[1] : ligne, suite: [] };
      elements.push(enCours);
    } else if (enCours && (ligne.startsWith(" ") || !ligne.trim())) {
      enCours.suite.push(ligne.replace(/^ {1,4}/, ""));
    } else if (ligne.trim()) {
      // Un paragraphe hors liste : la section n'est pas une simple suite d'éléments.
      return null;
    }
  }
  if (elements.length < 2) return null;
  return elements.map(({ premiere, suite }) => {
    const m = premiere.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    const titre = m ? m[1].replace(/[.:]\s*$/, "") : null;
    const texte = (m ? m[2] : premiere).replace(/^[:.]\s*/, "");
    return { titre, texte, suite: suite.join("\n").trim() };
  });
}

/** Icône de chaque section, d'après son titre. */
function iconeSection(titre: string): IconName {
  const t = titre.toLowerCase();
  if (/appel/.test(t)) return "bell-01";
  if (/critère/.test(t)) return "check-01";
  if (/ne fais pas/.test(t)) return "users-profiles-01";
  if (/passer la main|livre|rends/.test(t)) return "upload-01";
  if (/verdict/.test(t)) return "file-code";
  if (/modes/.test(t)) return "layout-left";
  if (/outil/.test(t)) return "settings";
  if (/tiens/.test(t)) return "folder";
  if (/seul/.test(t)) return "layout-right";
  if (/travaille|règle|écri|contrôler/.test(t)) return "list";
  return "file-01";
}

/* ─── Briques ──────────────────────────────────────────────────── */

/** Carte blanche d'une section : icône dans un rond K1, titre, nombre d'éléments. */
export function CarteSection({
  titre,
  icone,
  compte,
  className,
  children,
}: {
  titre: string;
  icone?: IconName;
  compte?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("klyra-carte-flottante flex flex-col gap-4 rounded-lg p-5", className)}>
      <header className="flex items-center gap-3">
        <span aria-hidden="true" className="klyra-orbe flex size-8 shrink-0 items-center justify-center rounded-full">
          <Icon name={icone ?? iconeSection(titre)} size={16} />
        </span>
        <h3 className="m-0 flex-1 text-ui font-semibold text-texte-principal">{titre}</h3>
        {compte && <span className="rounded-pill bg-fond-page px-2.5 py-0.5 text-ui-xs text-texte-tertiaire">{compte}</span>}
      </header>
      {children}
    </section>
  );
}

/** Tuiles numérotées : le numéro dans la couleur de l'agent, le gras en titre, le reste en description. */
function Tuiles({ elements, teinte, numerote }: { elements: Element[]; teinte: RoleTeinte; numerote: boolean }) {
  const { haut, encre, accent } = AGENT_PASTELS[teinte];
  return (
    <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 @4xl:grid-cols-2">
      {elements.map((el, i) => (
        <li key={i} className="flex gap-3 rounded-md bg-fond-page p-4">
          {numerote ? (
            <span
              aria-hidden="true"
              className="klyra-mono flex size-7 shrink-0 items-center justify-center rounded-full text-ui-xs font-semibold"
              style={{ background: haut, color: encre }}
            >
              {i + 1}
            </span>
          ) : (
            /* Liste à puces : pas d'ordre à suggérer, un point de la couleur de l'agent. */
            <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: accent }} />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            {el.titre && <span className="text-ui font-semibold text-texte-principal">{el.titre}</span>}
            {el.texte && (
              <span className="text-ui-s leading-[1.5] text-texte-secondaire">
                <Inline text={el.texte} />
              </span>
            )}
            {el.suite && <Markdown source={el.suite} className="mt-1 text-ui-s" />}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Critères de sortie : une liste à cocher, la coche pixel devant chaque critère. */
function Criteres({ elements }: { elements: Element[] }) {
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
      {elements.map((el, i) => (
        <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
          <PixelCheck delai={i * 120} className="mt-1 h-[13px] w-[18px]" />
          <span className="text-ui leading-[1.5] text-texte-principal">
            <Inline text={el.titre ? `**${el.titre}** ${el.texte}` : el.texte} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Capsule d'un collègue, comme dans les circuits : son rond de couleur et son prénom. */
function CapsuleCollegue({ role }: { role: Role }) {
  const { haut, encre } = AGENT_PASTELS[role.teinte];
  return (
    <Link
      href={`/equipe?agent=${role.id}`}
      className="flex h-[42px] shrink-0 items-center gap-2 rounded-full border border-bordure-subtile bg-fond-page pr-4 pl-1 no-underline transition-colors duration-[220ms] ease-sortie hover:border-bordure-forte"
    >
      <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full text-ui-xs font-semibold" style={{ background: haut, color: encre }}>
        {role.initial}
      </span>
      <span className="text-ui-s font-semibold text-texte-principal">{role.name}</span>
    </Link>
  );
}

/** Ce que je ne fais pas : chaque tâche, et la capsule du collègue à qui la confier. */
function Passations({ elements }: { elements: Element[] }) {
  const roles = useRoles();
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
      {elements.map((el, i) => {
        const ligne = el.titre ? `**${el.titre}** ${el.texte}` : el.texte;
        const [tache, ...reste] = ligne.split("→");
        const cible = reste.join("→");
        const collegues = cible
          ? findColleagues(cible)
              .map((c) => roles.find((r) => r.id === c.id))
              .filter((r): r is Role => !!r)
          : [];
        const apres = collegues.length ? cible.slice(cible.lastIndexOf(")") + 1).replace(/^[\s,.;:]+/, "") : "";
        return (
          <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-ui leading-[1.45] text-texte-principal">
                <Inline text={(collegues.length ? tache : ligne).trim().replace(/[.:]$/, "")} />
              </span>
              {apres && (
                <span className="text-ui-xs text-texte-tertiaire">
                  <Inline text={apres} />
                </span>
              )}
            </span>
            {collegues.map((c) => (
              <CapsuleCollegue key={c.id} role={c} />
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/* ─── Les sections de la fiche ─────────────────────────────────── */

/** Pleine largeur dans la grille à deux colonnes. */
export const PLEINE = "@4xl:col-span-2";

/** « Quand l'appeler », en tête : la phrase en grand sur le pastel de l'agent, sa présentation dessous. */
export function QuandAppeler({ role }: { role: Role }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-lg p-6", PLEINE)} style={{ backgroundImage: fondCarte(role.teinte) }}>
      <span className="text-ui-xs font-medium text-texte-secondaire">Quand l’appeler</span>
      <p className="m-0 max-w-[760px] text-body-l leading-[1.35] font-medium tracking-[-0.02em] text-texte-principal">{role.whenToCall}</p>
      {role.pitch && <Markdown source={role.pitch} className="max-w-[760px] text-body-s text-texte-secondaire" />}
    </section>
  );
}

/** Une section de la fiche, présentée selon ce qu'elle contient. */
export function SectionFiche({ section, teinte }: { section: RoleSection; teinte: RoleTeinte }) {
  const elements = decouper(section.body);
  const n = elements?.length ?? 0;

  if (elements && /^Critères de sortie/i.test(section.title)) {
    return (
      <CarteSection titre={section.title} compte={`${n} critères`}>
        <Criteres elements={elements} />
      </CarteSection>
    );
  }
  if (elements && /^Ce que je ne fais pas/i.test(section.title)) {
    return (
      <CarteSection titre={section.title} compte={`${n} relais`}>
        <Passations elements={elements} />
      </CarteSection>
    );
  }
  if (elements) {
    return (
      <CarteSection titre={section.title} compte={`${n} points`} className={n >= 3 ? PLEINE : undefined}>
        <Tuiles elements={elements} teinte={teinte} numerote={/^\d+\.\s/m.test(section.body)} />
      </CarteSection>
    );
  }
  const long = section.body.length > 600 || section.body.includes("```");
  return (
    <CarteSection titre={section.title} className={long ? PLEINE : undefined}>
      <Markdown source={section.body} />
    </CarteSection>
  );
}
