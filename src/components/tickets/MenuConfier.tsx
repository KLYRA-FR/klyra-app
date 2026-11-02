"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { cn } from "@/lib/cn";
import { entrer } from "@/lib/mouvement";
import { filDuRappel, type RappelAConfier } from "@/lib/tickets";
import { useRole, useRoles, useWorkspace } from "@/lib/workspace";

/** Les classes des boutons voisins de la ligne d'un rappel (cf. MenuReporter). */
const BOUTON =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire opacity-0 transition-opacity duration-[120ms] group-hover/rappel:opacity-100 hover:bg-fond-survol focus-visible:opacity-100 aria-expanded:opacity-100";

const MENU =
  "fixed z-50 flex max-h-80 w-max min-w-[220px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante transition-none";

const LIGNE =
  "flex h-8 cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left text-ui-s whitespace-nowrap text-texte-principal hover:bg-fond-survol focus-visible:bg-fond-survol focus-visible:-outline-offset-2";

const ECART = 6;
const MARGE = 8;

/** Le fil d'un rappel déjà confié (le plus récent, même fermé), ou null. */
export function useFilDuRappel(source: RappelAConfier["source"], id: string) {
  return filDuRappel(useWorkspace().state.chats, source, id);
}

/** « Confié à Hugo » sous un rappel confié : un clic ouvre son fil. */
export function ConfieA({ source, id }: { source: RappelAConfier["source"]; id: string }) {
  const fil = useFilDuRappel(source, id);
  const role = useRole(fil?.fil.roleId ?? "principal");
  if (!fil) return null;
  return (
    <Link
      href={`/chat?id=${encodeURIComponent(fil.id)}`}
      data-confie={id}
      className="self-start text-ui-xs text-texte-accent no-underline hover:underline"
    >
      {fil.fil.statut === "archive" ? `Fait par ${role.name}` : `Confié à ${role.name}`}
    </Link>
  );
}

/**
 * Confier un rappel à un agent (spec Tickets, §7) : le bouton au survol de la
 * ligne, et la liste de Mes agents. Le choix ouvre un fil, avec le rappel pour
 * brief ; le rappel reste là, marqué « Confié à … », et se coche quand le fil
 * est validé et fermé. Un rappel déjà confié (fil ouvert) n'a plus le bouton.
 */
export function MenuConfier({ rappel }: { rappel: RappelAConfier }) {
  const { confierRappel } = useWorkspace();
  const roles = useRoles();
  const fil = useFilDuRappel(rappel.source, rappel.id);
  const [ouvert, setOuvert] = useState(false);
  const [position, setPosition] = useState<{ gauche: number; haut?: number; bas?: number } | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idMenu = useId();
  const libelle = `Confier « ${rappel.titre} » à un agent`;

  const fermer = useCallback((rendreFocus: boolean) => {
    setOuvert(false);
    setPosition(null);
    if (rendreFocus) bouton.current?.focus();
  }, []);

  /* Sous le bouton, bord droit aligné sur lui ; au-dessus si la place manque en dessous. */
  const placer = useCallback(() => {
    const b = bouton.current;
    const m = menu.current;
    if (!b || !m) return;
    const r = b.getBoundingClientRect();
    const dessous = window.innerHeight - r.bottom - ECART - MARGE;
    const versLeHaut = dessous < m.offsetHeight && r.top - ECART - MARGE > dessous;
    const gauche = Math.min(Math.max(MARGE, r.right - m.offsetWidth), window.innerWidth - MARGE - m.offsetWidth);
    setPosition({ gauche: Math.max(MARGE, gauche), haut: versLeHaut ? undefined : r.bottom + ECART, bas: versLeHaut ? window.innerHeight - r.top + ECART : undefined });
  }, []);

  useLayoutEffect(() => {
    if (ouvert) placer();
  }, [ouvert, placer]);

  const place = position !== null;
  useLayoutEffect(() => {
    if (!place) return;
    entrer(menu.current, { y: -4, echelle: 0.98, duree: 180 });
    const frame = requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [place]);

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (!bouton.current?.contains(cible) && !menu.current?.contains(cible)) fermer(false);
    };
    const quitter = () => fermer(false);
    document.addEventListener("pointerdown", dehors, true);
    window.addEventListener("resize", placer);
    window.addEventListener("scroll", placer, true);
    window.addEventListener("blur", quitter);
    return () => {
      document.removeEventListener("pointerdown", dehors, true);
      window.removeEventListener("resize", placer);
      window.removeEventListener("scroll", placer, true);
      window.removeEventListener("blur", quitter);
    };
  }, [ouvert, fermer, placer]);

  const parcourir = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      fermer(true);
      return;
    }
    const liste = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const rang = liste.indexOf(document.activeElement as HTMLElement);
    const cible = { ArrowDown: (rang + 1) % liste.length, ArrowUp: (rang - 1 + liste.length) % liste.length, Home: 0, End: liste.length - 1 }[e.key];
    if (cible === undefined) return;
    e.preventDefault();
    liste[cible]?.focus();
  };

  if (fil && fil.fil.statut === "ouvert") return null;

  return (
    <>
      <button
        ref={bouton}
        type="button"
        data-confier={rappel.id}
        title="Confier à un agent"
        aria-label={libelle}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idMenu : undefined}
        onClick={() => (ouvert ? fermer(false) : setOuvert(true))}
        className={BOUTON}
      >
        <Icon name="users-profiles-01" size={14} />
      </button>
      {ouvert &&
        createPortal(
          <div
            ref={menu}
            id={idMenu}
            role="menu"
            aria-label={libelle}
            onKeyDown={parcourir}
            className={MENU}
            style={{ left: position?.gauche ?? 0, top: position?.haut, bottom: position?.bas, opacity: position ? undefined : 0 }}
          >
            <span className="px-2 pt-1 pb-1 text-ui-2xs font-medium text-texte-tertiaire">Confier à</span>
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  fermer(false);
                  confierRappel(rappel, r.id);
                }}
                className={cn(LIGNE)}
              >
                <AgentRond roleId={r.id} taille={20} />
                {r.name}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
