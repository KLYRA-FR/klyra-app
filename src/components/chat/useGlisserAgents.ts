"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { glisserDepuis } from "@/lib/mouvement";
import { aLaPlace, ecart, placeVisee } from "@/lib/rang-agents";

/** Au-delà de 4 px, l'appui devient un glisser ; en deçà, c'est un clic qui ouvre la conversation. */
const SEUIL_PX = 4;
/** Tenue près du bord haut ou bas de la liste, la ligne la fait défiler, jusqu'à 12 px par image. */
const BORD_PX = 40;
const VITESSE_PX = 12;

/** Ce qu'en voit le rendu : la ligne levée, l'ordre de départ du groupe, la place visée, l'écart d'une ligne. */
type Glisse = { id: string; ids: string[]; depart: number; place: number; pas: number };

/** Le geste en cours, lu par les événements du pointeur (sans rendu à chaque mouvement). */
type Geste = {
  id: string;
  el: HTMLDivElement;
  pointeur: number;
  x0: number;
  y0: number;
  y: number;
  glisse: Glisse | null;
  /** Milieux des lignes du groupe à l'écran au départ, et défilement de la liste à ce moment. */
  milieux: number[];
  defilement0: number;
  vitesse: number;
  image: number;
};

function milieu(el: HTMLElement | undefined): number {
  const r = el?.getBoundingClientRect();
  return r ? r.top + r.height / 2 : 0;
}

/**
 * Glisser un agent dans son groupe de la barre des chats, avec du mouvement : la ligne se
 * soulève et suit le pointeur, les autres s'écartent pour lui ouvrir la place, puis elle s'y
 * pose. Le clavier (Alt + ↑/↓) appelle `noter` juste avant de changer l'ordre pour glisser de
 * même. L'ordre s'écrit comme avant, une fois au lâcher (`ecrire`). Moins d'animations : les
 * lignes se placent d'un coup.
 */
export function useGlisserAgents(
  groupeDe: (id: string) => string[] | null,
  ecrire: (ordre: string[]) => void,
  liste: RefObject<HTMLElement | null>,
) {
  const noeuds = useRef(new Map<string, HTMLDivElement>());
  const geste = useRef<Geste | null>(null);
  const [glisse, setGlisse] = useState<Glisse | null>(null);
  /* Où étaient les lignes à l'écran juste avant un changement d'ordre : au rendu suivant, chacune glisse de là à sa place. */
  const avant = useRef<{ milieux: Map<string, number>; focus: string | null } | null>(null);
  const avalerClic = useRef(false);
  /* Le groupe et l'écriture du dernier rendu, pour la fin d'un geste écoutée sur la fenêtre. */
  const actuel = useRef({ groupeDe, ecrire });
  useLayoutEffect(() => {
    actuel.current = { groupeDe, ecrire };
  });

  /** À appeler juste avant de changer l'ordre du groupe `ids` ; `focus` : la ligne qui doit garder le focus. */
  const noter = useCallback((ids: string[], focus: string | null = null) => {
    avant.current = { milieux: new Map(ids.map((id) => [id, milieu(noeuds.current.get(id))])), focus };
  }, []);

  useLayoutEffect(() => {
    const a = avant.current;
    if (!a) return;
    avant.current = null;
    for (const [id, y] of a.milieux) {
      const el = noeuds.current.get(id);
      if (!el) continue;
      el.style.translate = "";
      // Un glissement encore en cours repart de là où il en est (`y` a été pris avec lui).
      for (const x of el.getAnimations()) if (!(x instanceof CSSTransition)) x.cancel();
      const dy = y - milieu(el);
      if (Math.abs(dy) >= 0.5) glisserDepuis(el, dy);
    }
    // Déplacée dans la page, la ligne peut perdre le focus : on le lui rend.
    const lien = a.focus ? noeuds.current.get(a.focus)?.querySelector("a") : null;
    if (lien && document.activeElement !== lien) lien.focus({ preventScroll: true });
  });

  /** La ligne suit le pointeur, bornée à son groupe ; la place visée change à mi-chemin. */
  const suivre = useCallback(
    (g: Geste) => {
      const s = g.glisse;
      if (!s) return;
      const defile = (liste.current?.scrollTop ?? 0) - g.defilement0;
      const haut = g.milieux[0] - g.milieux[s.depart];
      const bas = g.milieux[g.milieux.length - 1] - g.milieux[s.depart];
      const dy = Math.min(bas, Math.max(haut, g.y - g.y0 + defile));
      g.el.style.translate = `0 ${dy}px`;
      const place = placeVisee(g.milieux, g.milieux[s.depart] + dy);
      if (place !== s.place) {
        g.glisse = { ...s, place };
        setGlisse(g.glisse);
      }
    },
    [liste],
  );

  const defilerAuBord = (g: Geste) => {
    const boite = liste.current?.getBoundingClientRect();
    if (!boite) return;
    const dehors = g.y < boite.top + BORD_PX ? g.y - boite.top - BORD_PX : g.y > boite.bottom - BORD_PX ? g.y - boite.bottom + BORD_PX : 0;
    g.vitesse = Math.max(-VITESSE_PX, Math.min(VITESSE_PX, dehors / 3));
    if (!g.vitesse || g.image) return;
    const pas = () => {
      if (geste.current !== g || !g.vitesse || !liste.current) {
        g.image = 0;
        return;
      }
      // Le défilement relance `suivre` (écouteur `scroll` ci-dessous).
      liste.current.scrollTop += g.vitesse;
      g.image = requestAnimationFrame(pas);
    };
    g.image = requestAnimationFrame(pas);
  };

  /** Fin du geste : chaque ligne se pose (à sa nouvelle place, ou revient). Renvoie ce qui était glissé. */
  const lacher = useCallback((): Glisse | null => {
    const g = geste.current;
    geste.current = null;
    if (!g?.glisse) return null;
    cancelAnimationFrame(g.image);
    noter(g.glisse.ids);
    // Le clic qui suit le lâcher n'ouvre pas la conversation.
    avalerClic.current = true;
    setTimeout(() => {
      avalerClic.current = false;
    }, 0);
    setGlisse(null);
    return g.glisse;
  }, [noter]);

  const enCours = glisse !== null;
  useEffect(() => {
    if (!enCours) return;
    const defilement = liste.current;
    const echap = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      lacher();
    };
    const defile = () => {
      if (geste.current) suivre(geste.current);
    };
    window.addEventListener("keydown", echap, true);
    defilement?.addEventListener("scroll", defile);
    return () => {
      window.removeEventListener("keydown", echap, true);
      defilement?.removeEventListener("scroll", defile);
    };
  }, [enCours, lacher, suivre, liste]);

  const surAppui = (id: string) => (e: PointerEvent<HTMLDivElement>) => {
    // Bouton principal seul : le clic droit (ou Ctrl + clic) ouvre le menu. Un appui d'avant,
    // relâché hors de la ligne sans avoir glissé, est simplement remplacé.
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || geste.current?.glisse) return;
    const g: Geste = {
      id,
      el: e.currentTarget,
      pointeur: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      y: e.clientY,
      glisse: null,
      milieux: [],
      defilement0: 0,
      vitesse: 0,
      image: 0,
    };
    geste.current = g;
    // La fin du geste est écoutée sur toute la fenêtre : un relâché qui suit de près le début du
    // glisser part encore vers l'élément sous le pointeur (la capture n'est pas encore active).
    const fin = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== g.pointeur) return;
      window.removeEventListener("pointerup", fin, true);
      window.removeEventListener("pointercancel", fin, true);
      if (geste.current !== g) return;
      const fini = lacher();
      if (fini && ev.type === "pointerup") poser(fini);
    };
    window.addEventListener("pointerup", fin, true);
    window.addEventListener("pointercancel", fin, true);
  };

  const surMouvement = (e: PointerEvent<HTMLDivElement>) => {
    const g = geste.current;
    if (!g || e.pointerId !== g.pointeur) return;
    // Bouton relâché sans qu'on l'ait vu (hors de la fenêtre, avant la capture) : rien n'est posé.
    if (!(e.buttons & 1)) {
      if (g.glisse) lacher();
      else geste.current = null;
      return;
    }
    g.y = e.clientY;
    if (!g.glisse) {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < SEUIL_PX) return;
      const ids = groupeDe(g.id);
      if (!ids || ids.length < 2) {
        geste.current = null;
        return;
      }
      g.el.setPointerCapture(e.pointerId);
      g.milieux = ids.map((id) => milieu(noeuds.current.get(id)));
      g.defilement0 = liste.current?.scrollTop ?? 0;
      const depart = ids.indexOf(g.id);
      g.glisse = { id: g.id, ids, depart, place: depart, pas: g.milieux[1] - g.milieux[0] };
      setGlisse(g.glisse);
    }
    suivre(g);
    defilerAuBord(g);
  };

  /** Écrit le nouvel ordre, sauf si le groupe a changé pendant le geste (agent masqué, épinglé…). */
  const poser = (fini: Glisse) => {
    const apres = aLaPlace(fini.ids, fini.id, fini.place);
    if (actuel.current.groupeDe(fini.id)?.join() === fini.ids.join() && apres.join() !== fini.ids.join()) actuel.current.ecrire(apres);
  };

  /** Ce que porte l'enveloppe d'une ligne déplaçable. */
  const proprietes = (id: string) => {
    const leve = glisse?.id === id;
    const i = glisse && !leve ? glisse.ids.indexOf(id) : -1;
    const dy = glisse && i >= 0 ? ecart(i, glisse.depart, glisse.place, glisse.pas) : 0;
    return {
      ref: (el: HTMLDivElement | null) => {
        if (el) noeuds.current.set(id, el);
        else noeuds.current.delete(id);
      },
      style: glisse && !leve ? { translate: `0 ${dy}px` } : undefined,
      className: cn(
        // Sans glisser natif du lien ni de l'avatar : il détournerait le relâché du bouton.
        "relative rounded-md select-none transition-[box-shadow,scale] duration-[220ms] ease-sortie [&_*]:[-webkit-user-drag:none]",
        glisse && !leve && "transition-[translate,box-shadow,scale]",
        leve && "z-10 scale-[1.02] cursor-grabbing bg-fond-surface shadow-ombre-levee *:cursor-grabbing [&>a:active]:scale-100",
      ),
      onPointerDown: surAppui(id),
      onPointerMove: surMouvement,
      onLostPointerCapture: lacher,
      onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
        if (!avalerClic.current) return;
        avalerClic.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
      // Au cas où le glisser natif partirait quand même : lâché ailleurs, il n'ouvrirait rien, et il couperait le geste.
      onDragStart: (e: { preventDefault: () => void }) => e.preventDefault(),
    };
  };

  return { proprietes, noter };
}
