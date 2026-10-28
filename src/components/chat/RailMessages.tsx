"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { texteDe, useRoles } from "@/lib/workspace";
import type { Message } from "@/types/domain";

/** Distance (px) où le curseur « s'accroche » au segment le plus proche. */
const AIMANT = 10;
/** Écart entre deux segments, comme dans la maquette. */
const ECART = 4;
/** Un segment ne descend pas sous cette hauteur, même pour un message d'une ligne. */
const SEGMENT_MIN = 4;
/** Le rail prend au plus cette part de la hauteur de la conversation… */
const PART_MAX = 0.6;
/** …et un message n'y fait jamais plus du quart de sa vraie hauteur. */
const ECHELLE_MAX = 0.25;
/** En dessous, la conversation se lit d'un coup d'œil : pas de rail. */
const MESSAGES_MIN = 2;

interface Segment {
  id: string;
  /** Haut et bas du message dans le fil, en px depuis le haut du contenu. */
  debut: number;
  fin: number;
}

/**
 * Le rail d'une conversation (maquette Figma « Portfolio », nœud 172:8), à la
 * place de la barre de défilement : un segment par message, aussi haut que le
 * message est long, centré sur le bord droit. Les segments à l'écran sont plus
 * foncés. Au survol, le curseur s'accroche au segment le plus proche et
 * l'aperçu du message s'affiche ; un clic y mène.
 */
export function RailMessages({ zone, messages }: { zone: RefObject<HTMLDivElement | null>; messages: Message[] }) {
  const roles = useRoles();
  const rail = useRef<HTMLDivElement>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [vue, setVue] = useState({ haut: 0, bas: 0, hauteur: 0 });
  const [vise, setVise] = useState<string | null>(null);

  /* Mesure chaque message et la partie visible, à chaque changement du fil. */
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    let image = 0;
    const mesurer = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => {
        const base = el.getBoundingClientRect().top - el.scrollTop;
        const liste: Segment[] = [];
        el.querySelectorAll<HTMLElement>("[data-message]").forEach((n) => {
          const r = n.getBoundingClientRect();
          liste.push({ id: n.dataset.message!, debut: r.top - base, fin: r.bottom - base });
        });
        setSegments(liste);
        setVue({ haut: el.scrollTop, bas: el.scrollTop + el.clientHeight, hauteur: el.clientHeight });
      });
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(el);
    if (el.firstElementChild) observateur.observe(el.firstElementChild);
    el.addEventListener("scroll", mesurer, { passive: true });
    return () => {
      cancelAnimationFrame(image);
      observateur.disconnect();
      el.removeEventListener("scroll", mesurer);
    };
  }, [zone, messages.length]);

  if (messages.length < MESSAGES_MIN || segments.length < MESSAGES_MIN) return null;

  /* Les hauteurs du rail : proportionnelles aux messages, le tout tenant dans PART_MAX de l'écran. */
  const somme = segments.reduce((s, g) => s + (g.fin - g.debut), 0) || 1;
  const place = vue.hauteur * PART_MAX - ECART * (segments.length - 1);
  const echelle = Math.max(0, Math.min(ECHELLE_MAX, place / somme));
  const hauteurs = segments.map((g) => Math.max(SEGMENT_MIN, (g.fin - g.debut) * echelle));
  const traces = segments.map((g, i) => ({
    ...g,
    y: hauteurs.slice(0, i).reduce((s, h) => s + h + ECART, 0),
    h: hauteurs[i],
    visible: g.fin > vue.haut && g.debut < vue.bas,
  }));
  const total = hauteurs.reduce((s, h) => s + h, 0) + ECART * (segments.length - 1);

  const viser = (clientY: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r) return;
    const py = clientY - r.top;
    let proche: string | null = null;
    let ecart = AIMANT;
    for (const t of traces) {
      const d = py < t.y ? t.y - py : py > t.y + t.h ? py - t.y - t.h : 0;
      if (d <= ecart) {
        ecart = d;
        proche = t.id;
      }
    }
    setVise(proche);
  };
  const aller = (id: string) => {
    const cible = zone.current?.querySelector<HTMLElement>(`[data-message="${CSS.escape(id)}"]`);
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cible?.scrollIntoView({ block: "start", behavior: reduit ? "auto" : "smooth" });
  };

  const trace = traces.find((t) => t.id === vise);
  const message = trace ? messages.find((m) => m.id === trace.id) : null;
  const auteur = message
    ? message.author.kind === "user"
      ? "Toi"
      : (roles.find((r) => message.author.kind === "role" && r.id === message.author.roleId)?.name ?? "Agent")
    : "";
  const extrait = message ? texteDe(message).replace(/[*`#>]/g, "").replace(/\s+/g, " ").trim() : "";

  return (
    <div
      ref={rail}
      role="navigation"
      aria-label="Messages de la conversation"
      onPointerMove={(e) => viser(e.clientY)}
      onPointerLeave={() => setVise(null)}
      onClick={() => vise && aller(vise)}
      className={cn("absolute top-1/2 right-1 z-10 w-5 -translate-y-1/2", vise ? "cursor-pointer" : "cursor-default")}
      style={{ height: total + AIMANT * 2, paddingBlock: AIMANT }}
    >
      <div className="relative h-full">
        {traces.map((t) => (
          <span
            key={t.id}
            aria-hidden="true"
            className={cn(
              "absolute right-2 rounded-full transition-[width,background-color] duration-[120ms] ease-sortie",
              t.id === vise ? "w-[2px] bg-texte-principal" : cn("w-px", t.visible ? "bg-texte-tertiaire" : "bg-bordure-forte"),
            )}
            style={{ top: t.y, height: t.h }}
          />
        ))}

        {trace && message && (
          <div
            role="tooltip"
            className="pointer-events-none absolute right-6 w-[280px] -translate-y-1/2 rounded-md border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-md"
            style={{ top: trace.y + trace.h / 2 }}
          >
            <span className="flex items-baseline justify-between gap-2 text-ui-2xs text-texte-tertiaire">
              <span className="font-medium text-texte-secondaire">{auteur}</span>
              {formatTime(message.createdAt)}
            </span>
            <p className="m-0 mt-1 line-clamp-3 text-ui-xs leading-[1.5] text-texte-principal">{extrait || "Étapes de travail, sans texte."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
