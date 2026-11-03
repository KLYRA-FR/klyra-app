"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as EvenementSouris,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { entrer } from "@/lib/mouvement";

/**
 * Le menu du clic droit, le même partout : posé au pointeur, retourné s'il touche un bord,
 * parcouru au clavier (flèches, Début, Fin, → pour un sous-menu, ← ou Échap pour en sortir),
 * fermé par un clic ailleurs, Échap, Tab, le défilement ou la fenêtre qui perd le focus.
 * Le focus revient à l'élément cliqué. Touche Menu ou Maj+F10 : le menu part de l'élément.
 */

const MARGE = 8;
const PANNEAU =
  "flex w-max min-w-[248px] max-w-[320px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface/95 p-1.5 shadow-ombre-flottante backdrop-blur-md outline-none";
const LIGNE =
  "flex min-h-8 w-full items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left text-ui-s whitespace-nowrap outline-none transition-colors duration-[80ms]";

export type MenuOuvert<T> = { x: number; y: number; cible: T };

/** L'état d'un menu contextuel : `ouvrir` se branche sur `onContextMenu`. */
export function useMenuContextuel<T>() {
  const [menu, setMenu] = useState<MenuOuvert<T> | null>(null);
  const declencheur = useRef<HTMLElement | null>(null);
  const ouvrir = useCallback((e: EvenementSouris<HTMLElement>, cible: T) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    declencheur.current = el;
    /* Ouvert au clavier, le menu n'a pas de pointeur : il part du bas de l'élément. */
    if (e.clientX === 0 && e.clientY === 0) {
      const r = el.getBoundingClientRect();
      setMenu({ x: r.left + 12, y: r.bottom - 4, cible });
    } else setMenu({ x: e.clientX, y: e.clientY, cible });
  }, []);
  const fermer = useCallback((rendreFocus = true) => {
    setMenu(null);
    if (rendreFocus) declencheur.current?.focus({ preventScroll: true });
  }, []);
  return { menu, ouvrir, fermer };
}

type Contexte = { fermer: (rendreFocus?: boolean) => void };
const ContexteMenu = createContext<Contexte>({ fermer: () => undefined });

/** Les lignes d'un panneau, sans celles de ses sous-menus. */
function lignesDe(panneau: HTMLElement | null): HTMLElement[] {
  if (!panneau) return [];
  return [...panneau.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')].filter((el) => el.closest('[role="menu"]') === panneau);
}

/** Flèches, Début et Fin dans un panneau ; vrai si la touche a servi. */
function parcourir(e: KeyboardEvent<HTMLElement>, panneau: HTMLElement | null): boolean {
  const liste = lignesDe(panneau);
  if (!liste.length) return false;
  const rang = liste.indexOf(document.activeElement as HTMLElement);
  const cible = {
    ArrowDown: rang < 0 ? 0 : (rang + 1) % liste.length,
    ArrowUp: rang < 0 ? liste.length - 1 : (rang - 1 + liste.length) % liste.length,
    Home: 0,
    End: liste.length - 1,
  }[e.key];
  if (cible === undefined) return false;
  e.preventDefault();
  liste[cible]?.focus();
  return true;
}

export function MenuContextuel({
  x,
  y,
  libelle,
  onFermer,
  children,
}: {
  x: number;
  y: number;
  /** Ce que le lecteur d'écran annonce : « Hugo », « Message de Hugo »… */
  libelle: string;
  onFermer: (rendreFocus?: boolean) => void;
  children: ReactNode;
}) {
  const panneau = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; origine: string } | null>(null);

  /* Mesuré avant d'être peint : à droite et en dessous du pointeur, sinon de l'autre côté. */
  useLayoutEffect(() => {
    const el = panneau.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const versGauche = x + width > window.innerWidth - MARGE;
    const versHaut = y + height > window.innerHeight - MARGE;
    const left = Math.max(MARGE, versGauche ? x - width : x);
    const top = Math.max(MARGE, versHaut ? Math.max(MARGE, y - height) : y);
    setPlace({ left, top, origine: `${versHaut ? "bottom" : "top"} ${versGauche ? "right" : "left"}` });
  }, [x, y]);

  useEffect(() => {
    if (!place) return;
    const el = panneau.current;
    el?.focus({ preventScroll: true });
    entrer(el, { y: 0, echelle: 0.96, duree: 160 });
  }, [place]);

  useEffect(() => {
    /* En capture : un clic droit ailleurs ferme ce menu avant que le suivant s'ouvre. */
    const dehors = (e: Event) => {
      if (!panneau.current?.contains(e.target as Node)) onFermer(false);
    };
    const defile = (e: Event) => {
      if (!panneau.current?.contains(e.target as Node)) onFermer(false);
    };
    const quitte = () => onFermer(false);
    document.addEventListener("mousedown", dehors, true);
    document.addEventListener("contextmenu", dehors, true);
    document.addEventListener("scroll", defile, true);
    window.addEventListener("resize", quitte);
    window.addEventListener("blur", quitte);
    return () => {
      document.removeEventListener("mousedown", dehors, true);
      document.removeEventListener("contextmenu", dehors, true);
      document.removeEventListener("scroll", defile, true);
      window.removeEventListener("resize", quitte);
      window.removeEventListener("blur", quitte);
    };
  }, [onFermer]);

  const touche = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      onFermer(true);
      return;
    }
    parcourir(e, panneau.current);
  };

  return createPortal(
    <ContexteMenu.Provider value={{ fermer: onFermer }}>
      <div
        ref={panneau}
        role="menu"
        aria-label={libelle}
        tabIndex={-1}
        data-menu-contextuel
        onKeyDown={touche}
        /* Rendu dans un portail, le menu remonterait ses gestes à l'élément qui l'a ouvert (carte, ligne…). */
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{ left: place?.left ?? x, top: place?.top ?? y, transformOrigin: place?.origine, visibility: place ? "visible" : "hidden" }}
        className={cn(PANNEAU, "fixed z-[70]")}
      >
        {children}
      </div>
    </ContexteMenu.Provider>,
    document.body,
  );
}

/** Une ligne : icône, libellé, raccourci ou précision, éventuellement en rouge. */
export function ElementContextuel({
  icone,
  children,
  raccourci,
  detail,
  danger = false,
  desactive = false,
  garderOuvert = false,
  onChoisir,
}: {
  icone: IconName;
  children: ReactNode;
  raccourci?: string;
  detail?: string;
  danger?: boolean;
  desactive?: boolean;
  /** Le menu reste ouvert (une bascule qu'on voit changer). */
  garderOuvert?: boolean;
  onChoisir: () => void;
}) {
  const { fermer } = useContext(ContexteMenu);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={desactive || undefined}
      onClick={(e) => {
        if (desactive || e.detail > 1) return;
        if (!garderOuvert) fermer(true);
        onChoisir();
      }}
      className={cn(
        LIGNE,
        detail && "items-start py-1.5",
        desactive
          ? "cursor-not-allowed text-texte-tertiaire"
          : danger
            ? "cursor-pointer text-texte-erreur hover:bg-fond-survol focus:bg-fond-survol"
            : "cursor-pointer text-texte-principal hover:bg-fond-survol focus:bg-fond-survol",
      )}
    >
      <Icon name={icone} size={16} className={cn("shrink-0", danger && !desactive ? "text-texte-erreur" : "text-icone-secondaire", desactive && "opacity-60", detail && "mt-0.5")} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {detail && <span className="text-ui-xs leading-[1.35] whitespace-normal text-texte-tertiaire">{detail}</span>}
      </span>
      {raccourci && <span className="klyra-mono ml-4 shrink-0 text-ui-2xs text-texte-tertiaire">{raccourci}</span>}
    </button>
  );
}

export function SeparateurContextuel() {
  return <span role="separator" className="mx-1 my-1 h-px shrink-0 bg-bordure-subtile" />;
}

/** Le haut du menu : qui ou quoi, et où il en est. */
export function EnteteContextuel({ visuel, titre, sousTitre, enCours = false }: { visuel?: ReactNode; titre: string; sousTitre?: string; enCours?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-2 pt-1.5 pb-2">
      {visuel}
      <span className="flex min-w-0 flex-col">
        <strong className="truncate text-ui-s font-semibold text-texte-principal">{titre}</strong>
        {sousTitre && (
          <span className={cn("flex min-w-0 items-center gap-1.5 text-ui-2xs", enCours ? "text-texte-principal" : "text-texte-tertiaire")}>
            {enCours && <span aria-hidden="true" className="klyra-respire size-1.5 shrink-0 rounded-full bg-bleu-k1-500" />}
            <span className="truncate">{sousTitre}</span>
          </span>
        )}
      </span>
    </div>
  );
}

/** Une rangée de gestes fréquents, en grandes icônes, sous l'en-tête. */
export function ActionsRapides({ children }: { children: ReactNode }) {
  return <div className="grid auto-cols-fr grid-flow-col gap-0.5 pb-1">{children}</div>;
}

export function ActionRapide({
  icone,
  libelle,
  actif,
  garderOuvert = false,
  onChoisir,
}: {
  icone: IconName;
  libelle: string;
  /** Une bascule (épinglé, sourdine…) : allumée, la case est teintée. Absent : une simple action. */
  actif?: boolean;
  garderOuvert?: boolean;
  onChoisir: () => void;
}) {
  const { fermer } = useContext(ContexteMenu);
  const bascule = actif !== undefined;
  return (
    <button
      type="button"
      role={bascule ? "menuitemcheckbox" : "menuitem"}
      tabIndex={-1}
      aria-checked={bascule ? actif : undefined}
      onClick={(e) => {
        if (e.detail > 1) return;
        if (!garderOuvert) fermer(true);
        onChoisir();
      }}
      className={cn(
        "flex min-w-[56px] cursor-pointer flex-col items-center gap-1 rounded-md border-0 px-1 py-2 text-ui-3xs leading-tight outline-none transition-[background-color,scale] duration-[120ms] ease-sortie active:scale-[0.96]",
        actif ? "bg-fond-teinte-bleue text-texte-accent" : "bg-transparent text-texte-secondaire hover:bg-fond-survol focus:bg-fond-survol",
      )}
    >
      <Icon name={icone} size={18} className={actif ? "text-icone-accent" : "text-texte-principal"} />
      <span className="max-w-[64px] truncate">{libelle}</span>
    </button>
  );
}

/** Une ligne qui ouvre un sous-menu à côté (survol, clic, ou →). */
export function SousMenuContextuel({ icone, libelle, children }: { icone: IconName; libelle: string; children: ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  const [aGauche, setAGauche] = useState(false);
  const ligne = useRef<HTMLButtonElement>(null);
  const sous = useRef<HTMLDivElement>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const parClavier = useRef(false);

  const annuler = () => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
  };
  /* Un court délai : le temps d'aller jusqu'au sous-menu en diagonale. */
  const viser = (valeur: boolean) => {
    annuler();
    minuteur.current = setTimeout(() => setOuvert(valeur), valeur ? 90 : 260);
  };
  useEffect(() => annuler, []);

  useLayoutEffect(() => {
    if (!ouvert || !sous.current || !ligne.current) return;
    const r = ligne.current.getBoundingClientRect();
    setAGauche(r.right + sous.current.offsetWidth + 14 > window.innerWidth - MARGE);
  }, [ouvert]);

  useEffect(() => {
    if (!ouvert) return;
    entrer(sous.current, { x: aGauche ? 4 : -4, y: 0, duree: 140 });
    if (parClavier.current) lignesDe(sous.current)[0]?.focus();
    parClavier.current = false;
  }, [ouvert, aGauche]);

  const sortir = () => {
    setOuvert(false);
    ligne.current?.focus();
  };

  return (
    <div className="relative" onMouseEnter={() => viser(true)} onMouseLeave={() => viser(false)}>
      <button
        ref={ligne}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? id : undefined}
        onClick={() => {
          annuler();
          setOuvert((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          parClavier.current = true;
          annuler();
          setOuvert(true);
          if (ouvert) lignesDe(sous.current)[0]?.focus();
        }}
        className={cn(LIGNE, "cursor-pointer text-texte-principal hover:bg-fond-survol focus:bg-fond-survol", ouvert && "bg-fond-survol")}
      >
        <Icon name={icone} size={16} className="shrink-0 text-icone-secondaire" />
        <span className="flex-1 truncate">{libelle}</span>
        <Icon name="chevron-right" size={14} className="shrink-0 text-icone-secondaire" />
      </button>
      {ouvert && (
        <div
          ref={sous}
          id={id}
          role="menu"
          aria-label={libelle}
          onMouseEnter={annuler}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              sortir();
              return;
            }
            if (e.key === "Tab") return;
            if (parcourir(e, sous.current)) e.stopPropagation();
          }}
          className={cn(PANNEAU, "absolute -top-1.5 z-10 min-w-[208px]", aGauche ? "right-full mr-2" : "left-full ml-2")}
        >
          {children}
        </div>
      )}
    </div>
  );
}
