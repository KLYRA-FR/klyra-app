"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { texteDe, useRoles } from "@/lib/workspace";
import type { Message } from "@/types/domain";

/** Distance (px) où le curseur « s'accroche » au segment le plus proche. */
const AIMANT = 10;
/** Écart entre deux segments, comme dans la maquette ; il se resserre jusqu'à 1 px s'il y a beaucoup d'échanges. */
const ECART = 4;
/** Un segment ne descend pas sous cette hauteur, tant que le rail a la place. */
const SEGMENT_MIN = 3;
/** Le rail ne grandit jamais au-delà, quelle que soit la longueur de la conversation… */
const HAUTEUR_MAX = 220;
/** …ni au-delà de cette part de la hauteur visible. */
const PART_MAX = 0.5;
/** Un échange n'y fait jamais plus du quart de sa vraie hauteur. */
const ECHELLE_MAX = 0.25;
/** En dessous, la conversation se lit d'un coup d'œil : pas de rail. */
const ECHANGES_MIN = 2;

/** Un échange : ta question et les réponses qui la suivent, jusqu'à ta question suivante. */
interface Segment {
  /** Le premier message de l'échange (ta question, le plus souvent). */
  id: string;
  /** Haut et bas de l'échange dans le fil, en px depuis le haut du contenu. */
  debut: number;
  fin: number;
  reponses: number;
}

/**
 * Le rail d'une conversation (maquette Figma « Portfolio », nœud 172:8), à la
 * place de la barre de défilement : un segment par échange (ta question et ses
 * réponses), proportionnel à sa longueur, dans un rail de hauteur fixe centré
 * sur le bord droit. Les segments à l'écran sont plus foncés. Au survol, le
 * curseur s'accroche au segment le plus proche et la question s'affiche ; un
 * clic y mène.
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
          const dernier = liste.at(-1);
          if (dernier && n.dataset.auteur !== "user") {
            dernier.fin = r.bottom - base;
            dernier.reponses += 1;
          } else {
            liste.push({ id: n.dataset.message!, debut: r.top - base, fin: r.bottom - base, reponses: 0 });
          }
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

  if (segments.length < ECHANGES_MIN) return null;

  /* Les hauteurs du rail : proportionnelles aux échanges, le tout tenant dans une hauteur fixe. */
  const n = segments.length;
  const max = Math.min(HAUTEUR_MAX, vue.hauteur * PART_MAX);
  const ecart = Math.max(1, Math.min(ECART, (max - n * SEGMENT_MIN) / (n - 1)));
  const place = Math.max(n, max - ecart * (n - 1));
  const somme = segments.reduce((s, g) => s + (g.fin - g.debut), 0) || 1;
  const echelle = Math.min(ECHELLE_MAX, place / somme);
  const bruts = segments.map((g) => Math.max(Math.min(SEGMENT_MIN, place / n), (g.fin - g.debut) * echelle));
  const reduction = Math.min(1, place / bruts.reduce((s, h) => s + h, 0));
  const hauteurs = bruts.map((h) => h * reduction);
  const traces = segments.map((g, i) => ({
    ...g,
    y: hauteurs.slice(0, i).reduce((s, h) => s + h + ecart, 0),
    h: hauteurs[i],
    visible: g.fin > vue.haut && g.debut < vue.bas,
  }));
  const total = hauteurs.reduce((s, h) => s + h, 0) + ecart * (n - 1);

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
              <span>
                {formatTime(message.createdAt)}
                {!!trace.reponses && ` · ${trace.reponses} réponse${trace.reponses > 1 ? "s" : ""}`}
              </span>
            </span>
            <p className="m-0 mt-1 line-clamp-3 text-ui-xs leading-[1.5] text-texte-principal">{extrait || "Étapes de travail, sans texte."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
