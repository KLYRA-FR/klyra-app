"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { entrer } from "@/lib/mouvement";
import { jouer } from "@/lib/sons/sons";

export interface OptionListe<T extends string> {
  value: T;
  label: string;
  /** Avatar de l'agent, icône du projet… posé devant le libellé. */
  icone?: ReactNode;
  disabled?: boolean;
}

export interface ListeDeroulanteProps<T extends string> {
  options: OptionListe<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * Nom lu par les lecteurs d'écran. Inutile dans un `Champ` : son libellé
   * nomme déjà le bouton.
   */
  libelle?: string;
  /** `puce` dans la barre d'un composeur, `champ` dans un formulaire, `compact` dans une barre d'outils. */
  variante?: "puce" | "champ" | "compact";
  /** Icône du bouton ; par défaut, celle de l'option choisie. */
  icone?: ReactNode;
  /** Texte affiché quand aucune option ne correspond à `value`. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Largeur minimale de la liste, en px (sinon celle du bouton). */
  largeurListe?: number;
}

/** La liste ne dépasse pas cette hauteur : au-delà, elle défile. */
const HAUTEUR_MAX = 320;
/** Écart entre le bouton et la liste, et marge gardée au bord de la fenêtre. */
const ECART = 6;
const MARGE = 8;
/** Délai après lequel la saisie au clavier repart de zéro (comme une liste native). */
const DELAI_SAISIE = 600;

type Position = { gauche: number; haut?: number; bas?: number; hauteurMax: number; largeur: number; versLeHaut: boolean };

const BOUTON: Record<NonNullable<ListeDeroulanteProps<string>["variante"]>, string> = {
  puce: cn(
    "h-8 shrink-0 gap-1.5 rounded-xs border-bordure-subtile bg-fond-surface pr-2 pl-2.5 text-ui-s font-medium",
    "hover:border-bordure-forte aria-expanded:border-bordure-forte",
  ),
  champ: cn(
    "min-h-[40px] w-full gap-2 rounded-md border-bordure-champ bg-fond-surface px-3 py-2 text-ui",
    "hover:border-bordure-champ-survol aria-expanded:border-focus",
  ),
  compact: cn(
    "h-7 shrink-0 gap-1 rounded-sm border-bordure-subtile bg-fond-surface pr-1 pl-2 text-ui-xs",
    "hover:border-bordure-forte aria-expanded:border-bordure-forte",
  ),
};

/** Minuscules sans accents : « é » se trouve en tapant « e ». */
function normaliser(texte: string): string {
  return texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Liste déroulante de l'app, à la place du `<select>` natif (fond blanc,
 * surlignage bleu du système) : bouton `combobox`, liste `listbox` rendue à la
 * racine de la page pour n'être rognée par aucun panneau. Elle s'ouvre vers le
 * haut quand la place manque en dessous (composeur en bas de l'écran).
 *
 * Clavier comme une liste native : flèches, Début, Fin, Entrée ou Espace pour
 * choisir, Échap pour fermer, une lettre pour sauter à l'option qui commence
 * par elle. Le focus reste sur le bouton ; l'option active est annoncée par
 * `aria-activedescendant`.
 */
export function ListeDeroulante<T extends string>({
  options,
  value,
  onChange,
  libelle,
  variante = "champ",
  icone,
  placeholder,
  disabled,
  className,
  largeurListe,
}: ListeDeroulanteProps<T>) {
  const id = useId();
  const bouton = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const [ouverte, setOuverte] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<Position | null>(null);
  const saisie = useRef({ texte: "", minuteur: 0 });

  const indexChoisi = options.findIndex((o) => o.value === value);
  const choisie = options[indexChoisi];
  const idOption = (i: number) => `${id}-option-${i}`;

  const fermer = useCallback(() => {
    setOuverte(false);
    setPosition(null);
  }, []);

  const ouvrir = (indexActif = indexChoisi) => {
    if (disabled) return;
    setActive(indexActif >= 0 ? indexActif : premiere(1, -1));
    setOuverte(true);
  };

  const choisir = (i: number) => {
    const option = options[i];
    if (!option || option.disabled) return;
    // Au clavier aussi (Entrée, Espace) : l'option choisie a son son, pas la liste qui se ferme.
    jouer("selection");
    if (option.value !== value) onChange(option.value);
    fermer();
    bouton.current?.focus();
  };

  /** L'option disponible suivante dans le sens donné, à partir de `depuis` (exclu). */
  function premiere(sens: 1 | -1, depuis: number): number {
    for (let i = depuis + sens; i >= 0 && i < options.length; i += sens) if (!options[i].disabled) return i;
    return depuis;
  }

  /** Saisie au clavier : l'option qui commence par les lettres tapées. Une même lettre répétée fait défiler ses options. */
  const chercher = (lettre: string, depuis: number): number => {
    const s = saisie.current;
    window.clearTimeout(s.minuteur);
    s.texte += normaliser(lettre);
    s.minuteur = window.setTimeout(() => (s.texte = ""), DELAI_SAISIE);
    const meme = s.texte.split("").every((c) => c === s.texte[0]);
    const cherche = meme ? s.texte[0] : s.texte;
    const debut = meme ? depuis + 1 : Math.max(depuis, 0);
    for (let k = 0; k < options.length; k++) {
      const i = (debut + k) % options.length;
      if (!options[i].disabled && normaliser(options[i].label).startsWith(cherche)) return i;
    }
    return -1;
  };

  /* Place la liste sous le bouton, ou au-dessus si la place manque en dessous. */
  const placer = useCallback(() => {
    const b = bouton.current;
    const l = liste.current;
    if (!b || !l) return;
    const r = b.getBoundingClientRect();
    const voulue = Math.min(l.scrollHeight, HAUTEUR_MAX);
    const dessous = window.innerHeight - r.bottom - ECART - MARGE;
    const dessus = r.top - ECART - MARGE;
    const versLeHaut = dessous < voulue && dessus > dessous;
    const largeur = Math.max(r.width, largeurListe ?? 0);
    const gauche = Math.min(Math.max(MARGE, r.left), window.innerWidth - MARGE - Math.max(largeur, l.offsetWidth));
    setPosition({
      gauche: Math.max(MARGE, gauche),
      haut: versLeHaut ? undefined : r.bottom + ECART,
      bas: versLeHaut ? window.innerHeight - r.top + ECART : undefined,
      hauteurMax: Math.min(HAUTEUR_MAX, versLeHaut ? dessus : dessous),
      largeur,
      versLeHaut,
    });
  }, [largeurListe]);

  useLayoutEffect(() => {
    if (ouverte) placer();
  }, [ouverte, placer]);

  /* L'ouverture : un léger glissement depuis le bouton, une fois placée. */
  const placee = position !== null;
  const versLeHaut = position?.versLeHaut ?? false;
  useLayoutEffect(() => {
    if (placee) entrer(liste.current, { y: versLeHaut ? 4 : -4, echelle: 0.98, duree: 180 });
  }, [placee, versLeHaut]);

  /* L'option active reste visible quand on la change au clavier. */
  useEffect(() => {
    if (!ouverte || active < 0) return;
    document.getElementById(idOption(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idOption dérive de l'id, stable
  }, [ouverte, active, placee]);

  /* Clic en dehors, fenêtre redimensionnée ou défilée, app quittée : on ferme ou on replace. */
  useEffect(() => {
    if (!ouverte) return;
    const dehors = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (!bouton.current?.contains(cible) && !liste.current?.contains(cible)) fermer();
    };
    const defilement = (e: Event) => {
      if (!liste.current?.contains(e.target as Node)) placer();
    };
    document.addEventListener("pointerdown", dehors, true);
    window.addEventListener("resize", placer);
    window.addEventListener("scroll", defilement, true);
    window.addEventListener("blur", fermer);
    return () => {
      document.removeEventListener("pointerdown", dehors, true);
      window.removeEventListener("resize", placer);
      window.removeEventListener("scroll", defilement, true);
      window.removeEventListener("blur", fermer);
    };
  }, [ouverte, fermer, placer]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const touche = e.key;
    const lettre = touche.length === 1 && touche !== " " && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (!ouverte) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(touche)) {
        e.preventDefault();
        ouvrir();
      } else if (touche === "Home" || touche === "End") {
        e.preventDefault();
        ouvrir(touche === "Home" ? premiere(1, -1) : premiere(-1, options.length));
      } else if (lettre) {
        const i = chercher(touche, indexChoisi);
        ouvrir(i >= 0 ? i : indexChoisi);
      }
      return;
    }
    switch (touche) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => premiere(1, a));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => premiere(-1, a));
        break;
      case "Home":
        e.preventDefault();
        setActive(premiere(1, -1));
        break;
      case "End":
        e.preventDefault();
        setActive(premiere(-1, options.length));
        break;
      case "PageDown":
        e.preventDefault();
        setActive((a) => Math.min(options.length - 1, a + 8));
        break;
      case "PageUp":
        e.preventDefault();
        setActive((a) => Math.max(0, a - 8));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choisir(active);
        break;
      case "Escape":
        /* Ferme la liste seulement, pas la fenêtre qui la contient. */
        e.preventDefault();
        e.stopPropagation();
        fermer();
        break;
      case "Tab":
        fermer();
        break;
      default:
        if (lettre) {
          const i = chercher(touche, active);
          if (i >= 0) setActive(i);
        }
    }
  };

  const iconeBouton = icone ?? choisie?.icone;

  return (
    <>
      <button
        ref={bouton}
        type="button"
        role="combobox"
        aria-label={libelle}
        aria-haspopup="listbox"
        aria-expanded={ouverte}
        aria-controls={ouverte ? `${id}-liste` : undefined}
        aria-activedescendant={ouverte && active >= 0 ? idOption(active) : undefined}
        disabled={disabled}
        onClick={() => (ouverte ? fermer() : ouvrir())}
        onKeyDown={onKeyDown}
        className={cn(
          "inline-flex cursor-pointer items-center border text-left text-texte-principal transition-colors duration-[220ms] ease-sortie",
          "disabled:cursor-not-allowed disabled:opacity-50",
          BOUTON[variante],
          className,
        )}
      >
        {iconeBouton && <span className="flex shrink-0 text-icone-secondaire">{iconeBouton}</span>}
        <span className={cn("min-w-0 flex-1 truncate", !choisie && "text-texte-placeholder")}>{choisie?.label ?? placeholder}</span>
        <Icon
          name="chevron-down"
          size={variante === "compact" ? 14 : 16}
          className={cn(
            "shrink-0 text-icone-secondaire transition-transform duration-[220ms] ease-sortie",
            ouverte && "rotate-180",
          )}
        />
      </button>
      {ouverte &&
        createPortal(
          <div
            ref={liste}
            id={`${id}-liste`}
            role="listbox"
            aria-label={libelle}
            tabIndex={-1}
            /* Les clics dans la liste ne remontent pas aux parents React
               (canevas qui se déplace, fenêtre qui se ferme). */
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className={cn(
              "klyra-defilement-fin fixed z-[70] flex flex-col gap-0.5 overflow-y-auto rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante",
              !position && "invisible",
            )}
            style={{
              left: position?.gauche ?? 0,
              top: position?.haut,
              bottom: position?.bas,
              minWidth: position?.largeur,
              maxWidth: `calc(100vw - ${MARGE * 2}px)`,
              maxHeight: position?.hauteurMax ?? HAUTEUR_MAX,
              transformOrigin: versLeHaut ? "bottom" : "top",
            }}
          >
            {options.map((option, i) => {
              const selectionnee = i === indexChoisi;
              return (
                <div
                  key={option.value}
                  id={idOption(i)}
                  role="option"
                  aria-selected={selectionnee}
                  aria-disabled={option.disabled || undefined}
                  onMouseMove={() => !option.disabled && active !== i && setActive(i)}
                  onClick={() => choisir(i)}
                  className={cn(
                    "flex min-h-9 shrink-0 cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-ui-s text-texte-principal transition-colors duration-[120ms] ease-sortie select-none",
                    i === active && "bg-fond-survol",
                    selectionnee && "font-medium",
                    option.disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  {option.icone && <span className="flex shrink-0 text-icone-secondaire">{option.icone}</span>}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <Icon
                    name="check-01"
                    size={16}
                    className={cn("shrink-0 text-icone-accent", !selectionnee && "invisible")}
                  />
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
