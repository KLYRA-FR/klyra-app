"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { apparition } from "@/lib/mouvement";
import { cn } from "@/lib/cn";
import type { ActionExport } from "./useExporterConversation";
import type { Project } from "@/types/domain";

const MENU =
  "absolute top-full right-0 z-50 mt-1 flex w-max min-w-[220px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante";

function Ligne({ icone, children, onClick, desactivee = false, detail }: { icone: IconName; children: ReactNode; onClick: () => void; desactivee?: boolean; detail?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={desactivee || undefined}
      onClick={(e) => { if (!desactivee && e.detail <= 1) onClick(); }}
      className={cn("flex gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left text-ui-s whitespace-nowrap focus-visible:bg-fond-survol focus-visible:-outline-offset-2",
        detail ? "min-h-8 items-start py-1.5" : "h-8 items-center",
        desactivee ? "cursor-not-allowed text-texte-tertiaire" : "cursor-pointer text-texte-principal hover:bg-fond-survol")}
    >
      <Icon name={icone} size={16} className={cn("shrink-0 text-icone-secondaire", desactivee && "opacity-60", detail && "mt-0.5")} />
      <span className="flex flex-col">{children}{detail && <span className="text-ui-xs leading-[1.35] text-texte-tertiaire">{detail}</span>}</span>
    </button>
  );
}

/**
 * Le « … » d'une conversation : export pour toutes, nom/épingle/projet pour l'équipe.
 * Au clavier, les flèches parcourent le menu (ligne grisée comprise) ; Échap ou Tab le
 * ferment et rendent le focus au bouton, un clic ailleurs le ferme.
 */
export function MenuConversation({
  project,
  bouton,
  onRenommer,
  epinglee,
  onEpingler,
  actionExport,
}: {
  project?: Project;
  /** Le « … » lui-même : l'en-tête y rend le focus après un renommage au clavier. */
  bouton: RefObject<HTMLButtonElement | null>;
  onRenommer?: () => void;
  epinglee?: boolean;
  onEpingler?: () => void;
  actionExport?: ActionExport;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const idMenu = useId();
  const lignes = () => [...(zone.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const fermer = (rendreFocus: boolean) => {
    setOuvert(false);
    if (rendreFocus) bouton.current?.focus();
  };

  useEffect(() => {
    if (!ouvert) return;
    zone.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dehors = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOuvert(false);
      bouton.current?.focus();
    };
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert, bouton]);

  /* Les flèches passent d'une ligne à l'autre (en boucle), Début et Fin vont aux bouts. */
  const parcourir = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      fermer(true);
      return;
    }
    const liste = lignes();
    const rang = liste.indexOf(document.activeElement as HTMLElement);
    const cible = {
      ArrowDown: (rang + 1) % liste.length,
      ArrowUp: (rang - 1 + liste.length) % liste.length,
      Home: 0,
      End: liste.length - 1,
    }[e.key];
    if (cible === undefined) return;
    e.preventDefault();
    liste[cible]?.focus();
  };

  return (
    <div ref={zone} className="relative shrink-0">
      <BoutonIcone
        ref={bouton}
        taille="compact"
        actif={ouvert}
        icone={<Icon name="dot-horizontal" size={16} />}
        libelle="Plus d’options"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idMenu : undefined}
        onClick={() => setOuvert((v) => !v)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" || ouvert) return;
          e.preventDefault();
          setOuvert(true);
        }}
      />
      {ouvert && (
        <div ref={apparition} id={idMenu} role="menu" aria-label="Options de la conversation" onKeyDown={parcourir} className={MENU}>
          {onRenommer && <Ligne
            icone="pencil-01"
            onClick={() => {
              fermer(false);
              onRenommer();
            }}
          >
            Renommer
          </Ligne>}
          {onEpingler && <Ligne
            icone={epinglee ? "pin-off-01" : "pin-01"}
            onClick={() => {
              fermer(true);
              onEpingler();
            }}
          >
            {epinglee ? "Retirer l'épingle" : "Épingler"}
          </Ligne>}
          {actionExport && <Ligne
            icone="download-02"
            desactivee={actionExport.vide}
            detail={actionExport.vide ? "Pas encore de message" : undefined}
            onClick={() => { fermer(true); actionExport.lancer(bouton.current); }}
          >Exporter en Markdown…</Ligne>}
          {project && (
            <Ligne
              icone="projets-dossier"
              onClick={() => {
                fermer(false);
                router.push(`/projet?id=${encodeURIComponent(project.id)}`);
              }}
            >
              Ouvrir le projet
            </Ligne>
          )}
        </div>
      )}
    </div>
  );
}
