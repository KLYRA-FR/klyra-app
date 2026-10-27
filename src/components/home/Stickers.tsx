"use client";

import Image from "next/image";
import { useRef, useState, type PointerEvent } from "react";
import { useIsClient } from "@/hooks/useIsClient";
import { cn } from "@/lib/cn";

/**
 * Les stickers de l'équipe, collés sur la carte du bonjour. Fixes au repos ;
 * au survol un coin se soulève, et on peut les décoller pour les recoller ailleurs.
 * Chaque personne garde sa disposition (stockage local de l'app).
 */
type Sticker = { id: string; nom: string; x: number; y: number; r: number; taille: number; ratio: number };

/* Position du centre en % de la carte, rotation en degrés, taille en px (largeur). */
const STICKERS: Sticker[] = [
  { id: "pelin-tournesol", nom: "Le tournesol de Pelin", x: 8, y: 26, r: -8, taille: 64, ratio: 47 / 38 },
  { id: "corentin-manette", nom: "La manette de Corentin", x: 16, y: 64, r: 6, taille: 76, ratio: 1 },
  { id: "yanis-poulet", nom: "Le poulet de Yanis", x: 84, y: 24, r: 10, taille: 72, ratio: 1 },
  { id: "clement-chat", nom: "Le chat de Clément", x: 83, y: 72, r: -6, taille: 80, ratio: 38 / 42 },
  { id: "pelin-frites", nom: "Les frites de Pelin", x: 94, y: 40, r: 4, taille: 62, ratio: 45 / 38 },
  { id: "yanis-ballon", nom: "Le ballon de Yanis", x: 6, y: 84, r: -12, taille: 58, ratio: 1 },
  { id: "clement-dino", nom: "Le dino de Clément", x: 94, y: 86, r: 12, taille: 64, ratio: 1 },
];

/* Ombre douce sous le liseré blanc (valeurs des ombre-sm et ombre-md) ; plus marquée une fois décollé. */
const OMBRE = "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.06)) drop-shadow(0 4px 8px rgba(17, 17, 18, 0.06))";
const OMBRE_LEVEE = "drop-shadow(0 2px 2px rgba(0, 0, 0, 0.06)) drop-shadow(0 12px 18px rgba(17, 17, 18, 0.12))";

type Places = Record<string, { x: number; y: number }>;

function lire(cle: string): Places {
  try {
    return JSON.parse(localStorage.getItem(cle) ?? "{}") as Places;
  } catch {
    return {};
  }
}

/* Les places sont lues dans le stockage local : rien à rendre côté serveur. */
export function Stickers({ utilisateur }: { utilisateur: string }) {
  const client = useIsClient();
  return client ? <Planche key={utilisateur} cle={`klyra-stickers-2:${utilisateur}`} /> : null;
}

function Planche({ cle }: { cle: string }) {
  const zone = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Places>(() => lire(cle));
  const [tenu, setTenu] = useState<string | null>(null);
  const [survole, setSurvole] = useState<string | null>(null);
  /* Les places à enregistrer au moment de recoller. */
  const aEnregistrer = useRef<Places>({});
  const prise = useRef<{ dx: number; dy: number } | null>(null);

  const enregistrer = (suivantes: Places) => {
    try {
      localStorage.setItem(cle, JSON.stringify(suivantes));
    } catch {
      /* Sans stockage, les stickers reprennent leur place à la prochaine ouverture. */
    }
  };

  /* Pointeur → centre du sticker, en % de la carte, sans sortir des bords. */
  const versPourcent = (e: PointerEvent) => {
    const r = zone.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left - prise.current!.dx) / r.width) * 100;
    const y = ((e.clientY - r.top - prise.current!.dy) / r.height) * 100;
    return { x: Math.min(98, Math.max(2, x)), y: Math.min(96, Math.max(4, y)) };
  };

  const decoller = (id: string) => (e: PointerEvent<HTMLButtonElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    prise.current = { dx: e.clientX - (b.left + b.width / 2), dy: e.clientY - (b.top + b.height / 2) };
    e.currentTarget.setPointerCapture(e.pointerId);
    setTenu(id);
  };
  const glisser = (id: string) => (e: PointerEvent) => {
    if (tenu !== id || !prise.current) return;
    const p = versPourcent(e);
    aEnregistrer.current = { ...places, [id]: p };
    setPlaces(aEnregistrer.current);
  };
  const recoller = () => {
    if (!tenu) return;
    prise.current = null;
    setTenu(null);
    enregistrer({ ...places, ...aEnregistrer.current });
  };

  return (
    <div ref={zone} className="pointer-events-none absolute inset-0">
      {STICKERS.map((s) => {
        const p = places[s.id] ?? s;
        const leve = tenu === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-label={`${s.nom} : à décoller`}
            title={s.nom}
            onPointerDown={decoller(s.id)}
            onPointerMove={glisser(s.id)}
            onPointerUp={recoller}
            onPointerCancel={recoller}
            onPointerEnter={() => setSurvole(s.id)}
            onPointerLeave={() => setSurvole(null)}
            className={cn(
              "pointer-events-auto absolute touch-none border-0 bg-transparent p-0",
              leve ? "z-10 cursor-grabbing" : "cursor-grab",
            )}
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: s.taille, transform: "translate(-50%, -50%)" }}
          >
            {/* Le sticker pivote autour de son coin haut gauche : c'est le coin d'en face qui se soulève. */}
            <span
              className={cn(
                "block origin-top-left transition-[transform,filter] duration-[220ms] ease-sortie motion-reduce:transition-none",
              )}
              style={{
                transform: leve
                  ? `perspective(320px) rotate(${s.r * 0.4}deg) scale(1.08)`
                  : survole === s.id
                    ? `perspective(320px) rotate(${s.r}deg) rotateX(14deg) rotateY(-16deg)`
                    : `perspective(320px) rotate(${s.r}deg)`,
                filter: leve ? OMBRE_LEVEE : OMBRE,
              }}
            >
              <Image
                src={`/stickers/${s.id}.svg`}
                alt=""
                width={s.taille}
                height={Math.round(s.taille * s.ratio)}
                draggable={false}
                unoptimized
                className="block select-none"
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
