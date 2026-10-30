"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { libelleEcheance, libelleJourCourt, libellePeriode } from "@/lib/dates";
import { entrer } from "@/lib/mouvement";
import { echeanceReportee, reporterParId, reportsProposes, type Report } from "@/lib/report";
import { useWorkspace } from "@/lib/workspace";
import type { Tache } from "@/types/domain";

/**
 * Reporter un rappel en un clic (spec d'Iris, point 7) : le bouton (une horloge)
 * au survol de la ligne, et son menu « Dans 1 h », « Demain matin », « Lundi »,
 * chacun avec sa cible écrite. Le menu est rendu dans un portail, placé comme
 * `ListeDeroulante` : le défilement des colonnes du Planning ne le rogne pas.
 * Le report écrit le même rappel (`lib/report.ts`), relu par son id juste
 * avant : supprimé ou coché entre-temps, rien n'est écrit (sinon
 * `enregistrerTache` le recréerait).
 */

/** Le temps où la nouvelle date reste éclairée (animation `klyra-eclaire`). */
export const ECLAIRAGE_MS = 1800;

const NOMS: Record<Report, string> = { "une-heure": "Dans 1 h", "demain-matin": "Demain matin", lundi: "Lundi" };

/** Les classes des boutons voisins de la ligne d'un rappel, visibles au survol ou au focus. */
const BOUTON =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire opacity-0 transition-opacity duration-[120ms] group-hover/rappel:opacity-100 hover:bg-fond-survol focus-visible:opacity-100 aria-expanded:opacity-100";

const MENU =
  "fixed z-50 flex w-max min-w-[240px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante";

const LIGNE =
  "flex h-8 cursor-pointer items-center rounded-sm border-0 bg-transparent px-2 text-left text-ui-s whitespace-nowrap text-texte-principal hover:bg-fond-survol focus-visible:bg-fond-survol focus-visible:-outline-offset-2";

/** Écart entre le bouton et le menu, et marge gardée avec les bords de la fenêtre. */
const ECART = 6;
const MARGE = 8;

/** La cible écrite à droite : « Aujourd'hui, 15:45 » pour Dans 1 h, le jour en clair pour les autres. */
function cibleEcrite(choix: Report, maintenant: Date): string {
  const { date, heure } = echeanceReportee(choix, maintenant);
  return choix === "une-heure" ? libelleEcheance(date, heure) : libelleJourCourt(date, heure);
}

const eclairages = new WeakMap<HTMLElement, number>();

/** Éclaire la date d'un rappel partout où elle est affichée (`data-echeance`), comme un réglage trouvé. */
export function eclairerEcheance(id: string) {
  requestAnimationFrame(() => {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-echeance="${CSS.escape(id)}"]`)) {
      window.clearTimeout(eclairages.get(el));
      el.removeAttribute("data-eclaire");
      void el.offsetWidth; // relance l'animation si on y revient
      el.setAttribute("data-eclaire", "");
      eclairages.set(el, window.setTimeout(() => {
        el.removeAttribute("data-eclaire");
        eclairages.delete(el);
      }, ECLAIRAGE_MS));
    }
  });
}

export interface Reporte {
  id: string;
  /** « Rappel reporté : Demain, 09:00. », pour la région annoncée du parent. */
  annonce: string;
}

export function MenuReporter({ tache, className, onReporte }: { tache: Tache; className?: string; onReporte?: (r: Reporte) => void }) {
  const { state, enregistrerTache } = useWorkspace();
  const [ouvert, setOuvert] = useState(false);
  const [maintenant, setMaintenant] = useState(() => new Date());
  const [position, setPosition] = useState<{ gauche: number; haut?: number; bas?: number } | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idMenu = useId();
  const verbe = tache.date ? "Reporter" : "Planifier";
  const libelle = `${verbe} « ${tache.titre} »`;

  const fermer = useCallback((rendreFocus: boolean) => {
    setOuvert(false);
    setPosition(null);
    if (rendreFocus) bouton.current?.focus();
  }, []);

  const ouvrir = () => {
    setMaintenant(new Date());
    setOuvert(true);
  };

  /* Sous le bouton, bord droit aligné sur lui ; au-dessus si la place manque en dessous ; à 8 px des bords. */
  const placer = useCallback(() => {
    const b = bouton.current;
    const m = menu.current;
    if (!b || !m) return;
    const r = b.getBoundingClientRect();
    const dessous = window.innerHeight - r.bottom - ECART - MARGE;
    const dessus = r.top - ECART - MARGE;
    const versLeHaut = dessous < m.offsetHeight && dessus > dessous;
    const gauche = Math.min(Math.max(MARGE, r.right - m.offsetWidth), window.innerWidth - MARGE - m.offsetWidth);
    setPosition({
      gauche: Math.max(MARGE, gauche),
      haut: versLeHaut ? undefined : r.bottom + ECART,
      bas: versLeHaut ? window.innerHeight - r.top + ECART : undefined,
    });
  }, []);

  useLayoutEffect(() => {
    if (ouvert) placer();
  }, [ouvert, placer]);

  /* Placé : il entre en glissant depuis le bouton, et le focus va sur la première ligne. */
  const place = position !== null;
  const versLeHaut = position?.bas !== undefined;
  useLayoutEffect(() => {
    if (!place) return;
    entrer(menu.current, { y: versLeHaut ? 4 : -4, echelle: 0.98, duree: 180 });
    /* Attendre que le portail soit visible, même sans animation d'entrée. */
    const frame = requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [place, versLeHaut]);

  /* Ouvert : clic ailleurs ou app quittée ferment, défilement et redimensionnement replacent, les cibles suivent l'heure. */
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (!bouton.current?.contains(cible) && !menu.current?.contains(cible)) fermer(false);
    };
    const quitter = () => fermer(false);
    const horloge = window.setInterval(() => setMaintenant(new Date()), 30_000);
    document.addEventListener("pointerdown", dehors, true);
    window.addEventListener("resize", placer);
    window.addEventListener("scroll", placer, true);
    window.addEventListener("blur", quitter);
    return () => {
      window.clearInterval(horloge);
      document.removeEventListener("pointerdown", dehors, true);
      window.removeEventListener("resize", placer);
      window.removeEventListener("scroll", placer, true);
      window.removeEventListener("blur", quitter);
    };
  }, [ouvert, fermer, placer]);

  const choisir = (choix: Report) => {
    fermer(false);
    /* Le rappel tel qu'il est maintenant : supprimé ou coché pendant que le menu était ouvert, on n'écrit rien. */
    const reporte = reporterParId(state.taches, tache.id, choix, new Date());
    if (!reporte) return;
    const planifie = !state.taches.find((t) => t.id === tache.id)?.date;
    enregistrerTache(reporte);
    onReporte?.({
      id: reporte.id,
      annonce: `Rappel ${planifie ? "planifié" : "reporté"} : ${libellePeriode(reporte.date!, reporte.heure, reporte.fin)}.`,
    });
    eclairerEcheance(reporte.id);
    /* Le focus revient au bouton de la même ligne, même si le tri l'a déplacée. */
    requestAnimationFrame(() => bouton.current?.isConnected && bouton.current.focus({ preventScroll: true }));
  };

  /* Les flèches passent d'une ligne à l'autre (en boucle), Début et Fin vont aux bouts ; Échap et Tab ferment. */
  const parcourir = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      fermer(true);
      return;
    }
    const liste = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
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
    <>
      <button
        ref={bouton}
        type="button"
        data-reporter={tache.id}
        title={verbe}
        aria-label={libelle}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idMenu : undefined}
        onClick={() => (ouvert ? fermer(false) : ouvrir())}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" || ouvert) return;
          e.preventDefault();
          ouvrir();
        }}
        className={cn(BOUTON, className)}
      >
        <Icon name="clock-01" size={14} />
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
            style={{
              left: position?.gauche ?? 0,
              top: position?.haut,
              bottom: position?.bas,
              visibility: position ? undefined : "hidden",
            }}
          >
            {reportsProposes(maintenant).map((choix) => {
              const cible = cibleEcrite(choix, maintenant);
              return (
                <button
                  key={choix}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-label={`${NOMS[choix]}, ${cible}`}
                  onClick={() => choisir(choix)}
                  className={LIGNE}
                >
                  {NOMS[choix]}
                  <span className="ml-auto pl-6 text-ui-xs text-texte-secondaire">{cible}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
