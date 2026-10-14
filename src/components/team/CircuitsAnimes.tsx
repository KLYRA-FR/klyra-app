"use client";

import { useEffect, useRef } from "react";
import { moinsDAnimations } from "@/components/ui/Apparition";
import type { TeamCircuit } from "@/types/domain";
import { CircuitRow } from "./CircuitRow";

/** Attente avant le premier passage : l'entrée des circuits se termine d'abord. */
const ATTENTE_DEPART = 1600;
/** Vitesse de la lueur, constante d'un bout à l'autre de la rangée (px/s). */
const VITESSE = 340;
/** La lueur entre et sort un peu au-delà des bords, pour arriver et partir en douceur. */
const MARGE = 60;

/** Un circuit au hasard, jamais deux fois de suite le même. */
function auHasard(nombre: number, precedent: number): number {
  if (nombre < 2) return 0;
  const tirage = Math.floor(Math.random() * (nombre - 1));
  return tirage >= precedent ? tirage + 1 : tirage;
}

/**
 * Les circuits, avec une lueur qui glisse sur leurs pointillés : d'un bout à
 * l'autre d'une rangée, en continu, puis sur un autre circuit tiré au hasard.
 * Elle passe derrière les étapes sans s'arrêter. En pause hors de l'écran ou
 * fenêtre cachée ; absente si l'on demande moins d'animations.
 */
export function CircuitsAnimes({ circuits }: { circuits: TeamCircuit[] }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const rangees = useRef<(HTMLOListElement | null)[]>([]);

  useEffect(() => {
    const el = conteneur.current;
    if (!el || moinsDAnimations()) return;

    /* Chaque pointillé connaît sa position dans sa rangée (--debut). */
    const mesurer = () => {
      for (const ol of rangees.current) {
        if (!ol) continue;
        const gauche = ol.getBoundingClientRect().left - ol.scrollLeft;
        ol.querySelectorAll<HTMLElement>(".klyra-pointilles").forEach((p) => {
          p.style.setProperty("--debut", `${p.getBoundingClientRect().left - gauche}px`);
        });
      }
    };

    let enVue = false;
    let frame = 0;
    let ligne = -1;
    let x = 0;
    let dernier: number | null = null;
    let attente = ATTENTE_DEPART;

    const eteindre = () => rangees.current.forEach((ol) => ol?.style.removeProperty("--lueur-x"));

    const pas = (t: number) => {
      const dt = dernier === null ? 0 : t - dernier;
      dernier = t;
      if (attente > 0) {
        attente -= dt;
      } else {
        const ol = rangees.current[ligne];
        const largeur = ol?.scrollWidth ?? 0;
        if (!ol || x > largeur + MARGE) {
          // Fin de la rangée : la lueur repart aussitôt sur un autre circuit.
          ol?.style.removeProperty("--lueur-x");
          ligne = auHasard(rangees.current.length, ligne);
          x = -MARGE;
          mesurer();
        } else {
          x += (VITESSE * dt) / 1000;
          ol.style.setProperty("--lueur-x", `${x}px`);
        }
      }
      frame = requestAnimationFrame(pas);
    };

    const demarrer = () => {
      if (frame || !enVue || document.hidden) return;
      dernier = null;
      frame = requestAnimationFrame(pas);
    };
    const arreter = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const maj = () => (enVue && !document.hidden ? demarrer() : arreter());

    const observer = new IntersectionObserver(([e]) => {
      enVue = !!e?.isIntersecting;
      maj();
    });
    observer.observe(el);
    document.addEventListener("visibilitychange", maj);
    window.addEventListener("resize", mesurer);
    return () => {
      arreter();
      eteindre();
      observer.disconnect();
      document.removeEventListener("visibilitychange", maj);
      window.removeEventListener("resize", mesurer);
    };
  }, [circuits]);

  return (
    <div ref={conteneur} className="flex flex-col gap-2">
      {circuits.map((circuit, i) => (
        <CircuitRow
          key={circuit.id}
          circuit={circuit}
          ordre={i}
          refRangee={(ol) => {
            rangees.current[i] = ol;
          }}
        />
      ))}
    </div>
  );
}
