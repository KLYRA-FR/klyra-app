"use client";

import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { etatTirage } from "@/lib/telephone/dossiers";
import { vibrer } from "./zone-visible";

const LECTURE_MIN_MS = 600;

/**
 * Tirer pour relire (socle mobile § 7, une seule version) sur toute liste qui se lit : depuis le haut
 * de la liste, le doigt descend 1:1 jusqu'au seuil (64 px), puis avec résistance (96 px au plus). Un
 * rond blanc porte la flèche qui tourne avec la traction ; au seuil il passe en bleu, la légende dit
 * « Relâche pour relire » et le téléphone vibre (Android). Relâché, il tourne pendant la lecture puis
 * remonte (220 ms). « Relire » reste aussi dans le ⋯ de la page (M-9).
 * `props` va sur la zone qui défile, `indicateur` en tête de cette zone.
 */
export function useTirerPourRelire(relire: () => void, { actif = true, enCours = false }: { actif?: boolean; enCours?: boolean } = {}): { props: object; indicateur: ReactNode } {
  const depart = useRef<number | null>(null);
  const [distance, setDistance] = useState(0);
  const [tourne, setTourne] = useState(false);
  const { hauteur, pret } = etatTirage(distance);
  const etaitPret = useRef(false);

  useEffect(() => {
    if (pret && !etaitPret.current) vibrer();
    etaitPret.current = pret;
  }, [pret]);

  useEffect(() => {
    if (!tourne || enCours) return;
    const minuteur = setTimeout(() => setTourne(false), LECTURE_MIN_MS);
    return () => clearTimeout(minuteur);
  }, [tourne, enCours]);

  const arreter = () => {
    depart.current = null;
    setDistance(0);
  };
  const props = {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      depart.current = actif && e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null;
    },
    onTouchMove: (e: TouchEvent<HTMLElement>) => {
      if (depart.current === null) return;
      if (e.currentTarget.scrollTop > 0) return arreter();
      setDistance(e.touches[0].clientY - depart.current);
    },
    onTouchEnd: () => {
      if (depart.current !== null && pret) {
        setTourne(true);
        relire();
      }
      arreter();
    },
    onTouchCancel: arreter,
  };

  const visible = hauteur > 0 || tourne;
  const indicateur = (
    <div
      aria-hidden={!tourne}
      role={tourne ? "status" : undefined}
      style={{ height: tourne ? 56 : hauteur }}
      className={cn("flex flex-col items-center justify-end gap-1 overflow-hidden", distance === 0 && "transition-[height] duration-[220ms] ease-sortie", !visible && "h-0")}
    >
      <span className={cn("flex size-8 items-center justify-center rounded-full bg-fond-surface shadow-ombre-sm", pret || tourne ? "text-icone-accent" : "text-icone-secondaire")}>
        <Icon name="refresh-01" size={18} className={tourne ? "motion-safe:animate-spin" : undefined} style={tourne ? undefined : { transform: `rotate(${(hauteur / 96) * 360}deg)` }} />
      </span>
      <span className="pb-2 text-ui-xs text-texte-secondaire">{tourne ? "Lecture…" : pret ? "Relâche pour relire" : hauteur > 24 ? "Tire pour relire" : ""}</span>
    </div>
  );
  return { props, indicateur };
}
