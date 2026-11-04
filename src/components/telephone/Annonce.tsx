"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";

/**
 * L'annonce du téléphone (socle mobile § 6.1, D-12) : une seule à la fois, au-dessus de la barre
 * d'onglets ; la nouvelle remplace l'ancienne. 3 s, 8 s avec une action (« Annuler »), le minuteur
 * s'arrête tant que le doigt est dessus, glisser vers le bas la ferme. Lue par les lecteurs d'écran
 * (`status`, ou `alert` pour une erreur).
 */

export interface Annonce {
  texte: string;
  icone?: IconName;
  erreur?: boolean;
  action?: { libelle: string; onChoisir: () => void };
  /** Appelée quand l'annonce part sans que l'action ait été choisie (fin du délai, remplacée, fermée). */
  onFin?: () => void;
}

type Annoncer = (annonce: Annonce | string) => void;

const ContexteAnnonce = createContext<Annoncer | null>(null);

/** Montrer une annonce. Hors de la coque (tests), rien ne s'affiche. */
export function useAnnonce(): Annoncer {
  return useContext(ContexteAnnonce) ?? (() => undefined);
}

const DUREE_MS = 3000;
const DUREE_ACTION_MS = 8000;

export function FournisseurAnnonce({ barreOnglets, children }: { barreOnglets: boolean; children: ReactNode }) {
  const [courante, setCourante] = useState<(Annonce & { cle: number }) | null>(null);
  const [sortie, setSortie] = useState(false);
  const [tenue, setTenue] = useState(false);
  const [glisse, setGlisse] = useState(0);
  const compteur = useRef(0);
  const actionChoisie = useRef(false);

  const finir = useCallback(() => {
    setCourante((avant) => {
      if (avant && !actionChoisie.current) avant.onFin?.();
      return null;
    });
    setSortie(false);
    setGlisse(0);
  }, []);

  const annoncer = useCallback<Annoncer>((a) => {
    const annonce = typeof a === "string" ? { texte: a } : a;
    setCourante((avant) => {
      if (avant && !actionChoisie.current) avant.onFin?.();
      actionChoisie.current = false;
      return { ...annonce, cle: ++compteur.current };
    });
    setSortie(false);
    setGlisse(0);
  }, []);

  /* Le délai, arrêté tant que le doigt est dessus ; puis le fondu de sortie (120 ms). */
  useEffect(() => {
    if (!courante || tenue || sortie) return;
    const minuteur = setTimeout(() => setSortie(true), courante.action ? DUREE_ACTION_MS : DUREE_MS);
    return () => clearTimeout(minuteur);
  }, [courante, tenue, sortie]);
  useEffect(() => {
    if (!sortie) return;
    const minuteur = setTimeout(finir, 120);
    return () => clearTimeout(minuteur);
  }, [sortie, finir]);

  const glisser = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const depart = e.clientY;
    setTenue(true);
    let dy = 0;
    const bouger = (ev: PointerEvent) => {
      dy = Math.max(0, ev.clientY - depart);
      setGlisse(dy);
    };
    const lacher = () => {
      window.removeEventListener("pointermove", bouger, true);
      window.removeEventListener("pointerup", lacher, true);
      window.removeEventListener("pointercancel", lacher, true);
      setTenue(false);
      if (dy > 24) setSortie(true);
      else setGlisse(0);
    };
    window.addEventListener("pointermove", bouger, true);
    window.addEventListener("pointerup", lacher, true);
    window.addEventListener("pointercancel", lacher, true);
  };

  return (
    <ContexteAnnonce.Provider value={annoncer}>
      {children}
      {courante ? (
        <div
          key={courante.cle}
          role={courante.erreur ? "alert" : "status"}
          data-sortie={sortie || undefined}
          onPointerDown={glisser}
          style={glisse ? { transform: `translateY(${glisse}px)` } : undefined}
          className={cn(
            "klyra-annonce fixed inset-x-3 z-50 flex min-h-12 touch-none items-center gap-2.5 rounded-md bg-fond-inverse py-1.5 pr-1.5 pl-4 text-ui text-texte-inverse shadow-ombre-md",
            courante.erreur && "shadow-[var(--shadow-ombre-md),inset_3px_0_0_var(--color-rouge-500)]",
            barreOnglets ? "bottom-[calc(68px+env(safe-area-inset-bottom))]" : "bottom-[calc(12px+env(safe-area-inset-bottom))]",
          )}
        >
          {courante.icone ? <Icon name={courante.icone} size={20} className="shrink-0" /> : null}
          <span className="min-w-0 flex-1 py-2 leading-[1.35]">{courante.texte}</span>
          {courante.action ? (
            <button
              type="button"
              onClick={() => {
                actionChoisie.current = true;
                courante.action?.onChoisir();
                setSortie(true);
              }}
              className="relative flex h-11 shrink-0 items-center rounded-xs px-3 text-ui font-semibold text-texte-inverse underline underline-offset-[3px]"
            >
              {courante.action.libelle}
            </button>
          ) : null}
        </div>
      ) : null}
    </ContexteAnnonce.Provider>
  );
}
