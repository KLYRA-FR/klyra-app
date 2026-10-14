"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CIRCUITS } from "@/data/agents";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Markdown } from "@/components/ui/Markdown";
import { useAgents } from "@/lib/agents";
import { cn } from "@/lib/cn";
import type { Role, RoleSection } from "@/types/domain";
import { LigneRole } from "./AgentCard";
import { AgentVisuel, couleurAgent } from "./AgentVisuel";
import { CircuitRow } from "./CircuitRow";
import { QuandAppeler, SectionFiche } from "./FicheSections";

const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Bloc de la fiche : titre court, puis son contenu, en carte blanche. */
export function Bloc({ titre, children, className }: { titre: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border border-bordure-subtile bg-fond-surface p-5", className)}>
      <h3 className="m-0 text-ui font-semibold text-texte-principal">{titre}</h3>
      {children}
    </section>
  );
}

/** Étiquette grise de métadonnée (k-label--gris). */
function Meta({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xs bg-fond-surface-grise px-2.5 py-1 text-ui-xs font-medium text-texte-principal"
    >
      {children}
    </span>
  );
}

/** Le bloc commun à toute l'équipe, replié par défaut. */
function ParlerEnEquipe({ section }: { section: RoleSection }) {
  return (
    <details className="group rounded-3xl border border-bordure-subtile bg-fond-page p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-ui font-semibold text-texte-principal">
        <Icon
          name="chevron-right"
          size={16}
          className="text-icone-secondaire transition-transform duration-[220ms] group-open:rotate-90"
        />
        {section.title}
        <span className="font-normal text-texte-tertiaire">· bloc commun à toute l’équipe</span>
      </summary>
      <Markdown source={section.body} className="mt-4" />
    </details>
  );
}

/** Ordre d'affichage : « Critères de sortie » à côté de « Quand l'appeler »,
 *  le bloc commun tout en bas ; le reste dans l'ordre du fichier. */
function rang(section: RoleSection): number {
  if (/^Critères de sortie/i.test(section.title)) return 0;
  if (/^Parler en équipe/i.test(section.title)) return 3;
  if (/^Ce que je ne fais pas/i.test(section.title)) return 2;
  return 1;
}

/** Fiche d'un agent : son fichier, section par section. */
export function AgentDetail({ role }: { role: Role }) {
  const router = useRouter();
  const { canEdit, status, reveal } = useAgents();
  const circuits = CIRCUITS.filter((c) => c.steps.some((s) => s.roleId === role.id));
  const sections = [...role.sections].sort((a, b) => rang(a) - rang(b));
  const editable = canEdit && role.file !== null;
  const pourquoiPas =
    status === "exemple" ? "Ouvre l’app de bureau pour modifier les fiches." : "Le Principal n’a pas de fiche à modifier.";

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">

        {/* En-tête : l'illustration à gauche, l'identité à droite. */}
        {/* L'illustration prend la hauteur de la colonne d'identité, des compétences aux boutons. */}
        <header className="grid grid-cols-[200px_minmax(0,1fr)] items-stretch gap-6 @3xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="min-h-[180px] overflow-hidden rounded-xl border border-white/60 shadow-ombre-xs">
            <AgentVisuel agentId={role.id} teinte={role.teinte} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {role.skills.length > 0 && <p className="m-0 text-ui-s text-texte-tertiaire">{role.skills.join(" · ")}</p>}
            {/* Titre KLYRA : prénom en semi-gras, rôle en regular dessous, même couleur. */}
            <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
              <span className="block font-semibold">{role.name}</span>
              {/* Sous le prénom : le point de couleur de l'agent et son rôle, comme sur sa carte (sans le répéter plus bas). */}
              <span className="mt-1 flex items-center gap-2 text-h4 leading-[1.1] font-normal tracking-[-0.03em]">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: couleurAgent(role.teinte) }} />
                <span>
                  <LigneRole tag={role.tag} title={role.title} />
                </span>
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {role.file && (
                <Meta title="Identifiant du sous-agent">
                  <Icon name="code-01" size={16} className="text-icone-secondaire" />
                  {role.id}
                </Meta>
              )}
              {role.model && <Meta>Modèle {role.model}</Meta>}
              {role.memory && <Meta>Mémoire {role.memory}</Meta>}
            </div>
            {role.file && (
              <p className="m-0 flex flex-wrap items-center gap-x-2 text-ui-xs text-texte-tertiaire">
                <button
                  type="button"
                  onClick={() => void reveal(role.id)}
                  title="Afficher dans le Finder"
                  className="klyra-mono cursor-pointer border-0 bg-transparent p-0 text-ui-xs text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent"
                >
                  {role.file.path}
                </button>
                <span>· modifiée le {dateLongue.format(role.file.modifiedAt)}</span>
              </p>
            )}
            {/* Actions, sous l'identité : la place est là, à côté de l'illustration. */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <BoutonPrincipal href={role.id === "principal" ? "/" : `/?a=${role.id}`}>Écrire à {role.name}</BoutonPrincipal>
              <Bouton
                variant="blanc"
                taille="md"
                disabled={!editable}
                title={editable ? undefined : pourquoiPas}
                iconeGauche={<Icon name="file-code" size={20} />}
                onClick={() => router.push(`/equipe?agent=${role.id}&mode=modifier`)}
              >
                Modifier la fiche
              </Bouton>
              {/* Pourquoi le bouton est grisé, juste à côté de lui. */}
              {!editable && <span className="text-ui-xs text-texte-tertiaire">{pourquoiPas}</span>}
              {role.file && (
                <Bouton
                  variant="discret"
                  taille="md"
                  iconeGauche={<Icon name="refresh-01" size={20} />}
                  onClick={() => router.push(`/equipe?agent=${role.id}&mode=historique`)}
                >
                  Historique
                </Bouton>
              )}
            </div>
          </div>
        </header>


        {/* Le contenu de la fiche : « Quand l'appeler » en tête, puis une carte par section. */}
        <div className="grid grid-flow-row-dense grid-cols-1 gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3 @4xl:grid-cols-2">
          <QuandAppeler role={role} />
          {sections
            .filter((section) => rang(section) < 3)
            .map((section) => (
              <SectionFiche key={section.title} section={section} teinte={role.teinte} />
            ))}
        </div>

        {circuits.length > 0 && (
          /* Même bloc que « Qui passe la main à qui » sur la page Équipe. */
          <section className="flex flex-col gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3">
            <h3 className="m-0 px-2 pt-2 text-ui font-semibold text-texte-principal">Ses circuits</h3>
            <div className="flex flex-col gap-2">
              {circuits.map((circuit) => (
                <CircuitRow key={circuit.id} circuit={circuit} highlight={role.id} />
              ))}
            </div>
          </section>
        )}

        {sections
          .filter((section) => rang(section) === 3)
          .map((section) => (
            <ParlerEnEquipe key={section.title} section={section} />
          ))}
      </div>
    </div>
  );
}
