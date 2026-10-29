"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import type { Message } from "@/types/domain";

/** Le rail ne grandit jamais au-delà, quelle que soit la longueur de la conversation… */
const HAUTEUR_MAX = 220;
/** …ni au-delà de cette part de la hauteur visible. */
const PART_MAX = 0.5;
/** Le repère « tu es ici » garde au moins cette hauteur, même dans une très longue conversation. */
const POUCE_MIN = 12;
/** Deux repères plus proches que ça sur le rail n'en font qu'un. */
const FUSION = 8;
/** Distance (px) où le curseur « s'accroche » au repère le plus proche. */
const AIMANT = 6;
/** En dessous (fil / hauteur visible), la conversation tient presque à l'écran : pas de rail. */
const LONGUEUR_MIN = 1.5;

type Genre = "erreur" | "commit" | "fichiers";

/** Un moment fort de la conversation, posé sur le rail. */
interface Repere {
  id: string;
  genre: Genre;
  /** Position dans le fil, en px depuis le haut du contenu. */
  y: number;
  detail: string;
}

const LIBELLES: Record<Genre, string> = { erreur: "Erreur", commit: "Commit", fichiers: "Fichiers modifiés" };
const COMMIT = /\b(commit|push|pouss)/i;

/** Ce qui compte dans un message : une erreur, un commit, des fichiers modifiés. Le reste n'est pas un repère. */
function genreDe(message: Message): { genre: Genre; detail: string } | null {
  if (message.author.kind === "user") return null;
  const etapes = message.parts.flatMap((p) => (p.type === "etapes" ? p.etapes : []));
  if (message.statut === "erreur") return { genre: "erreur", detail: message.erreur ?? "La réponse s’est arrêtée sur une erreur." };
  const commit = etapes.find((e) => e.outil === "Bash" && COMMIT.test(e.libelle));
  if (commit) return { genre: "commit", detail: commit.libelle };
  const fichiers = new Set(etapes.filter((e) => /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(e.outil)).map((e) => e.chemin ?? e.libelle));
  if (fichiers.size) {
    const noms = [...fichiers].map((f) => f.split("/").at(-1));
    return { genre: "fichiers", detail: noms.length > 3 ? `${noms.slice(0, 3).join(", ")} et ${noms.length - 3} autres` : noms.join(", ") };
  }
  return null;
}

/**
 * Le rail d'une conversation, à la place de la barre de défilement : une ligne
 * de hauteur fixe, centrée sur le bord droit. Le repère foncé montre où tu es
 * dans la conversation ; les points marquent les moments forts (erreurs,
 * commits, fichiers modifiés). On le glisse ou on clique pour s'y déplacer ;
 * au survol d'un point, son détail s'affiche et un clic y mène.
 */
export function RailMessages({ zone, messages }: { zone: RefObject<HTMLDivElement | null>; messages: Message[] }) {
  const rail = useRef<HTMLDivElement>(null);
  const glisse = useRef(false);
  const [mesure, setMesure] = useState({ haut: 0, visible: 0, total: 0 });
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [vise, setVise] = useState<string | null>(null);

  /* Mesure le fil, la partie visible et la place de chaque message. */
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    let image = 0;
    const mesurer = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => {
        const base = el.getBoundingClientRect().top - el.scrollTop;
        const liste: Record<string, number> = {};
        el.querySelectorAll<HTMLElement>("[data-message]").forEach((n) => {
          liste[n.dataset.message!] = n.getBoundingClientRect().top - base;
        });
        setPositions(liste);
        setMesure({ haut: el.scrollTop, visible: el.clientHeight, total: el.scrollHeight });
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

  if (!mesure.total || mesure.total < mesure.visible * LONGUEUR_MIN) return null;

  const hauteur = Math.min(HAUTEUR_MAX, mesure.visible * PART_MAX);
  const echelle = hauteur / mesure.total;
  const pouce = {
    y: mesure.haut * echelle,
    h: Math.max(POUCE_MIN, mesure.visible * echelle),
  };

  /* Les repères, fusionnés quand ils se touchent : l'erreur l'emporte, puis le commit. */
  const reperes: (Repere & { r: number })[] = [];
  for (const m of messages) {
    const g = genreDe(m);
    const y = positions[m.id];
    if (!g || y === undefined) continue;
    const r = y * echelle;
    const dernier = reperes.at(-1);
    if (dernier && r - dernier.r < FUSION) {
      const rang = (x: Genre) => ["fichiers", "commit", "erreur"].indexOf(x);
      if (rang(g.genre) > rang(dernier.genre)) Object.assign(dernier, { id: m.id, ...g });
      continue;
    }
    reperes.push({ id: m.id, y, r, ...g });
  }

  const defiler = (top: number, doux = false) => {
    const el = zone.current;
    if (!el) return;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top, behavior: doux && !reduit ? "smooth" : "auto" });
  };
  /* Le point du rail sous le curseur devient le centre de la partie visible. */
  const allerA = (clientY: number, doux = false) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r) return;
    defiler((clientY - r.top) / echelle - mesure.visible / 2, doux);
  };
  const viser = (clientY: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r) return;
    const py = clientY - r.top;
    const proche = reperes.reduce<(typeof reperes)[number] | null>(
      (p, x) => (Math.abs(x.r - py) <= AIMANT && (!p || Math.abs(x.r - py) < Math.abs(p.r - py)) ? x : p),
      null,
    );
    setVise(proche?.id ?? null);
  };

  const appui = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (vise) {
      const cible = reperes.find((x) => x.id === vise);
      if (cible) defiler(cible.y - 16, true);
      return;
    }
    glisse.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    allerA(e.clientY);
  };

  const repere = reperes.find((x) => x.id === vise);
  const message = repere ? messages.find((m) => m.id === repere.id) : null;

  return (
    <div
      ref={rail}
      role="scrollbar"
      aria-label="Position dans la conversation"
      aria-orientation="vertical"
      aria-controls={zone.current?.id || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((mesure.haut / Math.max(1, mesure.total - mesure.visible)) * 100)}
      onPointerDown={appui}
      onPointerMove={(e) => (glisse.current ? allerA(e.clientY) : viser(e.clientY))}
      onPointerUp={() => (glisse.current = false)}
      onPointerCancel={() => (glisse.current = false)}
      onPointerLeave={() => !glisse.current && setVise(null)}
      className={cn("absolute top-1/2 right-1 z-10 w-5 -translate-y-1/2 touch-none select-none", vise ? "cursor-pointer" : "cursor-default")}
      style={{ height: hauteur }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 right-2 w-px rounded-full bg-bordure-forte" />
      <span
        aria-hidden="true"
        className="absolute right-[7px] w-[3px] rounded-full bg-texte-tertiaire"
        style={{ top: Math.min(pouce.y, hauteur - pouce.h), height: pouce.h }}
      />
      {reperes.map((x) => (
        <span
          key={x.id}
          aria-hidden="true"
          className={cn(
            "absolute right-[6px] size-[5px] -translate-y-1/2 border border-fond-surface transition-transform duration-[120ms] ease-sortie",
            x.genre === "commit" ? "rounded-[1px]" : "rounded-full",
            x.genre === "erreur" ? "bg-texte-erreur" : "bg-texte-principal",
            x.id === vise && "scale-150",
          )}
          style={{ top: x.r }}
        />
      ))}

      {repere && message && (
        <div
          role="tooltip"
          className="pointer-events-none absolute right-6 w-[260px] -translate-y-1/2 rounded-md border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-md"
          style={{ top: repere.r }}
        >
          <span className="flex items-baseline justify-between gap-2 text-ui-2xs text-texte-tertiaire">
            <span className={cn("font-medium", repere.genre === "erreur" ? "text-texte-erreur" : "text-texte-secondaire")}>{LIBELLES[repere.genre]}</span>
            <span>{formatTime(message.createdAt)}</span>
          </span>
          <p className="m-0 mt-1 line-clamp-3 text-ui-xs leading-[1.5] text-texte-principal">{repere.detail}</p>
        </div>
      )}
    </div>
  );
}
