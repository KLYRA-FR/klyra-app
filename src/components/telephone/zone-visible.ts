"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * La partie visible de l'écran (`visualViewport`) : quand le clavier s'ouvre, une feuille ou une page
 * pleine s'y loge, et son pied (le bouton d'enregistrement) reste juste au-dessus du clavier
 * (socle mobile § 4.1, S-12). Sans `visualViewport` : tout l'écran.
 */
export function useZoneVisible(): CSSProperties {
  const [zone, setZone] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const lire = () => setZone({ height: vv.height, top: vv.offsetTop });
    lire();
    vv.addEventListener("resize", lire);
    vv.addEventListener("scroll", lire);
    return () => {
      vv.removeEventListener("resize", lire);
      vv.removeEventListener("scroll", lire);
    };
  }, []);
  return zone ? { top: zone.top, height: zone.height } : { top: 0, bottom: 0 };
}

/** Une vibration courte (§ 7) : Android seulement (Safari n'a pas `vibrate`), jamais si « réduire les animations ». */
export function vibrer(ms = 10) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate(ms);
}

export const mouvementReduit = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
