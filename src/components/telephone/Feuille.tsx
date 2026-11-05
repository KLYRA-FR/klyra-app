"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { marquerFeuille } from "./retour";
import { mouvementReduit, useZoneVisible, vibrer } from "./zone-visible";

const FOCUSABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SORTIE_MS = 220;

/** Fermer la feuille depuis son contenu, avec son mouvement de sortie (un choix dans un menu, un bouton du pied). */
const ContexteFeuille = createContext<(() => void) | null>(null);
export function useFermerFeuille(): () => void {
  const fermer = useContext(ContexteFeuille);
  return fermer ?? (() => undefined);
}

/**
 * Feuille qui monte du bas (socle mobile § 4.1, M-10) : voile, carte arrondie, poignée, en-tête de
 * 52 px avec « Fermer » (✕), contenu qui défile seul (un filet sous l'en-tête dès qu'il défile),
 * pied collé en bas qui suit le clavier. Fermée par ✕, le voile, Échap, en glissant l'en-tête vers
 * le bas et par le retour du système (elle pose une entrée d'historique). Focus piégé, rendu au
 * déclencheur. `haute` : 92 % de l'écran. `objet` : l'en-tête d'un élément (son visuel, son nom,
 * son rôle) à la place du titre. `sansEnTete` : le titre en tête du contenu (confirmation).
 */
export function Feuille({
  titre,
  sousTitre,
  objet,
  onFermer,
  haute = false,
  role = "dialog",
  sansEnTete = false,
  retour,
  children,
  pied,
}: {
  /** Une sous-page de la feuille (E2-38) : « ‹ » revient à la page d'avant, dans la même feuille. */
  retour?: () => void;
  titre: string;
  sousTitre?: string;
  objet?: { visuel: ReactNode; sous?: string };
  onFermer: () => void;
  haute?: boolean;
  role?: "dialog" | "alertdialog";
  sansEnTete?: boolean;
  children: ReactNode;
  /** Boutons collés en bas de la feuille. */
  pied?: ReactNode;
}) {
  const id = useId();
  const carte = useRef<HTMLElement | null>(null);
  const [sortie, setSortie] = useState(false);
  const [defile, setDefile] = useState(false);
  const [glisse, setGlisse] = useState<number | null>(null);
  const zone = useZoneVisible();
  const surFermer = useRef(onFermer);
  useEffect(() => {
    surFermer.current = onFermer;
  });
  const finie = useRef(false);

  /* La sortie joue son mouvement (220 ms, 120 sans mouvement), puis la feuille est démontée. */
  const fermer = useCallback(() => {
    if (finie.current) return;
    finie.current = true;
    setSortie(true);
    setTimeout(() => surFermer.current(), mouvementReduit() ? 120 : SORTIE_MS);
  }, []);

  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    const premier = carte.current?.querySelector<HTMLElement>("[data-autofocus]") ?? carte.current?.querySelector<HTMLElement>(FOCUSABLES);
    premier?.focus();
    return () => avant?.focus?.();
  }, []);

  /* Le retour du système ferme la feuille au lieu de quitter la page (§ 2.5). */
  useEffect(() => {
    const historique = window.history;
    const etat = historique.state as Record<string, unknown> | null;
    historique.pushState({ ...(etat && typeof etat === "object" ? etat : {}), klyraFeuille: id }, "");
    marquerFeuille(id, true);
    const surRetour = () => {
      if ((historique.state as { klyraFeuille?: string } | null)?.klyraFeuille !== id) fermer();
    };
    window.addEventListener("popstate", surRetour);
    return () => {
      window.removeEventListener("popstate", surRetour);
      marquerFeuille(id, false);
      if ((historique.state as { klyraFeuille?: string } | null)?.klyraFeuille === id) historique.back();
    };
  }, [id, fermer]);

  const touche = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        fermer();
        return;
      }
      if (e.key !== "Tab" || !carte.current) return;
      const liste = [...carte.current.querySelectorAll<HTMLElement>(FOCUSABLES)];
      if (!liste.length) return;
      const [premier, dernier] = [liste[0], liste[liste.length - 1]];
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    },
    [fermer],
  );

  /* Glisser l'en-tête vers le bas : la carte suit le doigt (vers le haut, résistance × 0,2). Au-delà de
     30 % de sa hauteur ou à plus de 0,6 px/ms, elle se ferme ; sinon elle revient (220 ms). */
  const glisser = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const depart = { y: e.clientY, t: performance.now() };
    let dy = 0;
    const bouger = (ev: PointerEvent) => {
      dy = ev.clientY - depart.y;
      setGlisse(dy > 0 ? dy : dy * 0.2);
    };
    const finir = () => {
      window.removeEventListener("pointermove", bouger, true);
      window.removeEventListener("pointerup", finir, true);
      window.removeEventListener("pointercancel", finir, true);
      const vitesse = dy / Math.max(1, performance.now() - depart.t);
      const hauteur = carte.current?.offsetHeight ?? 1;
      if (dy > hauteur * 0.3 || vitesse > 0.6) fermer();
      setGlisse(null);
    };
    window.addEventListener("pointermove", bouger, true);
    window.addEventListener("pointerup", finir, true);
    window.addEventListener("pointercancel", finir, true);
  };

  const style: CSSProperties | undefined = glisse !== null && !sortie ? { transform: `translateY(${glisse}px)` } : undefined;

  return createPortal(
    /* À la tablette (`data-composition`, posé par la coque), la feuille devient une fenêtre centrée (spec § 9). */
    <div
      style={zone}
      className="fixed inset-x-0 z-40 flex items-end in-data-[composition=tablette]:items-center in-data-[composition=tablette]:justify-center in-data-[composition=tablette]:p-6"
      onKeyDown={touche}
    >
      <div aria-hidden="true" data-sortie={sortie || undefined} className="klyra-feuille-voile absolute inset-0 bg-fond-inverse-fort/40" onClick={fermer} />
      <ContexteFeuille.Provider value={fermer}>
        <section
          ref={carte}
          role={role}
          aria-modal="true"
          aria-labelledby={id}
          data-sortie={sortie || undefined}
          data-glisse={glisse !== null || undefined}
          style={style}
          className={cn(
            "klyra-feuille relative flex w-full flex-col rounded-t-3xl bg-fond-surface shadow-ombre-lg",
            "in-data-[composition=tablette]:max-w-[520px] in-data-[composition=tablette]:rounded-3xl",
            haute ? "h-[92%]" : "max-h-[85%]",
          )}
        >
          <div className="shrink-0 touch-none" onPointerDown={glisser}>
            <div aria-hidden="true" className="mx-auto mt-2 h-[5px] w-9 rounded-pill bg-bordure-forte in-data-[composition=tablette]:hidden" />
            {sansEnTete ? null : (
              <header
                className={cn(
                  "flex min-h-[52px] items-center gap-3 py-1 pr-1.5 pl-5 transition-shadow duration-[120ms] ease-sortie",
                  objet && "pt-2 pb-3 pl-4",
                  defile && "shadow-[inset_0_-1px_0_var(--color-bordure-defaut)]",
                )}
              >
                {retour ? <BoutonIcone variant="discret" className="-ml-3 size-11 shrink-0" libelle="Retour" onClick={retour} icone={<Icon name="chevron-left" size={22} />} /> : null}
                {objet ? <span className="shrink-0">{objet.visuel}</span> : null}
                <div className="min-w-0 flex-1">
                  <h2 id={id} className="truncate text-body-s font-semibold text-texte-principal">
                    {titre}
                  </h2>
                  {objet?.sous ? <p className="truncate text-ui text-texte-secondaire">{objet.sous}</p> : null}
                  {sousTitre ? <p className="truncate text-ui-xs text-texte-secondaire">{sousTitre}</p> : null}
                </div>
                <BoutonIcone
                  variant="discret"
                  className="size-11 hover:bg-transparent"
                  libelle="Fermer"
                  data-son="fermer"
                  onClick={fermer}
                  icone={
                    <span className="flex size-8 items-center justify-center rounded-xs bg-fond-survol text-icone-defaut">
                      <Icon name="x-01" size={20} />
                    </span>
                  }
                />
              </header>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4" onScroll={(e) => setDefile(e.currentTarget.scrollTop > 0)}>
            {sansEnTete ? (
              <h2 id={id} className="px-1 pt-4 text-body font-semibold tracking-title text-texte-principal">
                {titre}
              </h2>
            ) : null}
            {children}
          </div>
          {pied ? (
            <div className="shrink-0 border-t border-bordure-defaut bg-fond-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">{pied}</div>
          ) : (
            <div className="pb-[env(safe-area-inset-bottom)]" />
          )}
        </section>
      </ContexteFeuille.Provider>
    </div>,
    document.body,
  );
}

export interface ActionMenu {
  libelle: string;
  onChoisir: () => void;
  /** Icône de 20 px devant le libellé (§ 4.2). */
  icone?: IconName;
  /** Désactivée : la raison dessous (P-7, P-8), jamais une ligne grise sans raison. */
  desactivee?: boolean;
  note?: ReactNode;
  danger?: boolean;
  /** Un filet avant cette ligne. */
  separateurAvant?: boolean;
  /** Mène à une autre page : un chevron le dit. */
  chevron?: boolean;
  /** Le menu se change en cette confirmation, dans la même feuille (§ 4.1). */
  confirmation?: { titre: string; texte?: string; confirmer: string };
  /** Mène à une sous-page : la feuille reste ouverte, un chevron le dit. */
  sousPage?: boolean;
  /** Ce que donnera ce choix, à droite de la ligne (« Jeu. 5 nov., 09:00 »). */
  valeur?: string;
}

/** Les actions rapides en tête d'un menu (grille de 4, `ActionsRapides` du bureau). */
export interface ActionRapide {
  libelle: string;
  icone: IconName;
  onChoisir: () => void;
  /** Allumée (« Épinglé ») : fond bleu pâle, `aria-pressed`. */
  actif?: boolean;
  desactivee?: boolean;
}

/**
 * Le menu « ⋯ », aussi ouvert par l'appui long (§ 4.2, M-9) : l'en-tête de l'objet (son nom, jamais un
 * identifiant), les actions rapides, puis des lignes de 52 px avec leur icône. Une action à confirmer
 * change le menu en confirmation dans la même feuille.
 */
export function MenuFeuille({
  titre,
  objet,
  sousTitre,
  rapides,
  entete,
  retour,
  noteRapides,
  actions,
  onFermer,
}: {
  titre: string;
  sousTitre?: string;
  objet?: { visuel: ReactNode; sous?: string };
  rapides?: ActionRapide[];
  /** Ce qui précède les lignes, propre à un écran (les réactions d'un message). */
  entete?: ReactNode;
  retour?: () => void;
  /** Pourquoi des actions rapides sont inactives (P-7). */
  noteRapides?: ReactNode;
  actions: ActionMenu[];
  onFermer: () => void;
}) {
  const [aConfirmer, setAConfirmer] = useState<ActionMenu | null>(null);
  if (aConfirmer?.confirmation) {
    return (
      <Feuille titre={aConfirmer.confirmation.titre} onFermer={onFermer} role="alertdialog" sansEnTete>
        <ContenuConfirmation texte={aConfirmer.confirmation.texte} confirmer={aConfirmer.confirmation.confirmer} onConfirmer={aConfirmer.onChoisir} />
      </Feuille>
    );
  }
  return (
    <Feuille titre={titre} sousTitre={sousTitre} objet={objet} retour={retour} onFermer={onFermer}>
      {entete}
      <ContenuMenu rapides={rapides} noteRapides={noteRapides} actions={actions} onConfirmer={setAConfirmer} />
    </Feuille>
  );
}

function ContenuMenu({ rapides, noteRapides, actions, onConfirmer }: { rapides?: ActionRapide[]; noteRapides?: ReactNode; actions: ActionMenu[]; onConfirmer: (a: ActionMenu) => void }) {
  const fermer = useFermerFeuille();
  const choisir = (action: { onChoisir: () => void; sousPage?: boolean }) => {
    if (!action.sousPage) fermer();
    action.onChoisir();
  };
  return (
    <>
      {rapides?.length ? (
        <div className="grid grid-cols-4 gap-2 pt-1 pb-3">
          {rapides.map((r) => (
            <button
              key={r.libelle}
              type="button"
              aria-pressed={r.actif === undefined ? undefined : r.actif}
              disabled={r.desactivee}
              onClick={() => choisir(r)}
              className={cn(
                "flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-md text-ui-xs font-medium transition-colors duration-[120ms] ease-sortie disabled:text-texte-tertiaire",
                r.actif ? "bg-fond-teinte-bleue text-texte-accent" : "bg-fond-survol text-texte-principal active:bg-fond-surface-grise",
              )}
            >
              <Icon name={r.icone} size={20} />
              {r.libelle}
            </button>
          ))}
        </div>
      ) : null}
      {noteRapides ? <div className="pb-2">{noteRapides}</div> : null}
      <ul className="-mx-4 flex flex-col">
        {actions.map((action) => (
          <li key={action.libelle}>
            {action.separateurAvant ? <div aria-hidden="true" className="mx-5 my-1.5 h-px bg-bordure-defaut" /> : null}
            <button
              type="button"
              disabled={action.desactivee}
              onClick={() => (action.confirmation ? onConfirmer(action) : choisir(action))}
              className={cn(
                "flex min-h-[52px] w-full items-center gap-3.5 px-5 py-1.5 text-left text-body-s transition-colors duration-[120ms] ease-sortie active:bg-fond-survol",
                action.danger ? "text-texte-erreur" : "text-texte-principal",
                "disabled:text-texte-tertiaire",
              )}
            >
              {action.icone ? <Icon name={action.icone} size={20} className={cn("shrink-0", action.desactivee ? "text-icone-secondaire" : action.danger ? "text-texte-erreur" : "text-icone-defaut")} /> : null}
              <span className="min-w-0 flex-1">
                {action.libelle}
                {action.note ? <span className="mt-0.5 block text-ui-xs text-texte-secondaire">{action.note}</span> : null}
              </span>
              {action.valeur ? <span className="shrink-0 text-ui text-texte-secondaire">{action.valeur}</span> : null}
              {action.sousPage || action.chevron ? <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ContenuConfirmation({ texte, confirmer, onConfirmer }: { texte?: string; confirmer: string; onConfirmer: () => void }) {
  const fermer = useFermerFeuille();
  /* Un menu changé en confirmation dans la même feuille : « Annuler » prend le focus (§ 4.3). */
  const annuler = useRef<HTMLButtonElement | null>(null);
  useEffect(() => annuler.current?.focus(), []);
  return (
    <div className="px-1">
      {texte ? <p className="mt-2 text-body-s text-texte-secondaire">{texte}</p> : null}
      <div className="mt-6 flex flex-col gap-2">
        <Bouton
          variant="sombre"
          taille="md"
          className="w-full"
          onClick={() => {
            fermer();
            onConfirmer();
          }}
        >
          {confirmer}
        </Bouton>
        <Bouton ref={annuler} variant="blanc" taille="md" className="w-full" data-autofocus onClick={fermer}>
          Annuler
        </Bouton>
      </div>
    </div>
  );
}

/**
 * Confirmation en feuille (§ 4.3), comme `useConfirmation` au bureau : le titre en question, la
 * conséquence en clair, l'action nommée sur un bouton sombre (jamais rouge, D-11), « Annuler »
 * dessous, qui a le focus à l'ouverture. `danger` reste accepté et ne change plus la couleur.
 */
export function ConfirmationFeuille({
  titre,
  texte,
  confirmer,
  onConfirmer,
  onFermer,
}: {
  titre: string;
  texte?: string;
  confirmer: string;
  onConfirmer: () => void;
  onFermer: () => void;
  danger?: boolean;
}) {
  return (
    <Feuille titre={titre} onFermer={onFermer} role="alertdialog" sansEnTete>
      <ContenuConfirmation texte={texte} confirmer={confirmer} onConfirmer={onConfirmer} />
    </Feuille>
  );
}

/**
 * Appui long (§ 7, une seule version) : à 150 ms l'élément passe en pressé (`data-presse`), à 450 ms
 * son menu monte (vibration courte sur Android). Un déplacement de plus de 10 px l'annule. Le clic qui
 * suit est bloqué ; le menu du système et la sélection du texte sont coupés. Le clic droit (souris,
 * appui long d'Android) ouvre le même menu (M-9).
 */
export function useAppuiLong(onAppui: () => void) {
  const minuteurs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const depart = useRef<{ x: number; y: number } | null>(null);
  const declenche = useRef(false);
  const [presse, setPresse] = useState(false);
  const annuler = () => {
    minuteurs.current.forEach(clearTimeout);
    minuteurs.current = [];
    depart.current = null;
    setPresse(false);
  };
  const ouvrir = () => {
    declenche.current = true;
    setPresse(false);
    vibrer();
    onAppui();
  };
  return {
    "data-presse": presse || undefined,
    style: { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" } as CSSProperties,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      annuler();
      declenche.current = false;
      depart.current = { x: e.clientX, y: e.clientY };
      minuteurs.current = [setTimeout(() => setPresse(true), 150), setTimeout(ouvrir, 450)];
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (depart.current && Math.hypot(e.clientX - depart.current.x, e.clientY - depart.current.y) > 10) annuler();
    },
    onPointerUp: annuler,
    onPointerCancel: annuler,
    onPointerLeave: annuler,
    onClickCapture: (e: React.MouseEvent) => {
      if (!declenche.current) return;
      declenche.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      const dejaOuvert = declenche.current;
      annuler();
      if (!dejaOuvert) ouvrir();
    },
  };
}
