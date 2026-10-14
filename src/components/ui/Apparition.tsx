"use client";

import { createContext, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Vrai quand le bloc parent est entré à l'écran : les animations d'entrée peuvent partir. */
const VisibleContext = createContext(true);

export function useVisible(): boolean {
  return useContext(VisibleContext);
}

/** Vrai si le système demande moins d'animations. */
export function moinsDAnimations(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface ApparitionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Part du bloc qui doit être visible pour lancer l'entrée (0 à 1). */
  seuil?: number;
}

/**
 * Lance les animations d'entrée de son contenu (classes `klyra-entree`,
 * `klyra-barre-progres`, `klyra-trace` de globals.css) quand il arrive à
 * l'écran, une seule fois. Ses enfants le savent via `useVisible()`.
 */
export function Apparition({ children, seuil = 0.15, className, ...rest }: ApparitionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entree]) => {
        if (entree?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: seuil },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seuil]);

  return (
    <div ref={ref} data-visible={visible} className={cn(className)} {...rest}>
      <VisibleContext.Provider value={visible}>{children}</VisibleContext.Provider>
    </div>
  );
}
