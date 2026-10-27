"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { apparition } from "@/lib/mouvement";

/** Côté de la zone de recadrage, et de la photo enregistrée. */
const VUE = 288;
const SORTIE = 256;
const ZOOM_MAX = 4;

type Cadre = { zoom: number; x: number; y: number };

/**
 * Recadrer une photo de profil : on la fait glisser dans le rond, on zoome
 * (curseur ou molette), puis on valide. La photo enregistrée est un carré
 * de 256 px, affiché en rond.
 */
export function Recadrage({ src, onValider, onAnnuler }: { src: string; onValider: (photo: string) => void; onAnnuler: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [taille, setTaille] = useState<{ l: number; h: number } | null>(null);
  const [cadre, setCadre] = useState<Cadre>({ zoom: 1, x: 0, y: 0 });
  const prise = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  /* À zoom 1, la photo couvre juste le rond (comme object-fit: cover). */
  const base = taille ? Math.max(VUE / taille.l, VUE / taille.h) : 1;
  const echelle = base * cadre.zoom;
  const largeur = (taille?.l ?? 0) * echelle;
  const hauteur = (taille?.h ?? 0) * echelle;

  /* La photo ne laisse jamais de vide dans le cadre. */
  const borner = (c: Cadre): Cadre => {
    if (!taille) return c;
    const e = base * c.zoom;
    return {
      zoom: c.zoom,
      x: Math.min(0, Math.max(VUE - taille.l * e, c.x)),
      y: Math.min(0, Math.max(VUE - taille.h * e, c.y)),
    };
  };

  /* Zoomer autour du centre du cadre. */
  const zoomer = (zoom: number) =>
    setCadre((c) => {
      const z = Math.min(ZOOM_MAX, Math.max(1, zoom));
      const k = z / c.zoom;
      return borner({ zoom: z, x: VUE / 2 - (VUE / 2 - c.x) * k, y: VUE / 2 - (VUE / 2 - c.y) * k });
    });

  /* La photo chargée : à zoom 1 elle couvre le cadre, centrée. */
  const mesurer = (i: HTMLImageElement) => {
    if (!i.naturalWidth) return;
    const b = Math.max(VUE / i.naturalWidth, VUE / i.naturalHeight);
    setTaille({ l: i.naturalWidth, h: i.naturalHeight });
    setCadre({ zoom: 1, x: (VUE - i.naturalWidth * b) / 2, y: (VUE - i.naturalHeight * b) / 2 });
  };

  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onAnnuler();
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [onAnnuler]);

  const valider = () => {
    if (!img.current || !taille) return;
    const toile = document.createElement("canvas");
    toile.width = toile.height = SORTIE;
    const cote = VUE / echelle;
    toile.getContext("2d")!.drawImage(img.current, -cadre.x / echelle, -cadre.y / echelle, cote, cote, 0, 0, SORTIE, SORTIE);
    onValider(toile.toDataURL("image/jpeg", 0.9));
  };

  /* Rendue à la racine de la page : dans une carte « @container », une fenêtre
     fixe resterait enfermée (et rognée) dans la carte. */
  return createPortal(
    <div
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onAnnuler()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-fond-inverse-fort/40 p-4"
    >
      <div
        ref={apparition}
        role="dialog"
        aria-modal="true"
        aria-label="Recadrer ta photo"
        className="flex w-[336px] flex-col gap-4 rounded-xl border border-bordure-subtile bg-fond-surface p-6 shadow-ombre-lg"
      >
        <h2 className="m-0 text-ui font-semibold text-texte-principal">Recadrer ta photo</h2>

        <div
          onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            prise.current = { px: e.clientX, py: e.clientY, x: cadre.x, y: cadre.y };
          }}
          onPointerMove={(e) => {
            const p = prise.current;
            if (p) setCadre((c) => borner({ ...c, x: p.x + e.clientX - p.px, y: p.y + e.clientY - p.py }));
          }}
          onPointerUp={() => (prise.current = null)}
          onPointerCancel={() => (prise.current = null)}
          onWheel={(e) => zoomer(cadre.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          className="relative cursor-grab touch-none overflow-hidden rounded-lg bg-fond-surface-grise select-none active:cursor-grabbing"
          style={{ width: VUE, height: VUE }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- image locale choisie, dessinée ensuite sur une toile */}
          <img
            ref={img}
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => mesurer(e.currentTarget)}
            className="absolute top-0 left-0 max-w-none"
            style={{ width: largeur || undefined, height: hauteur || undefined, transform: `translate(${cadre.x}px, ${cadre.y}px)` }}
          />
          {/* Le rond : ce qui sera vu dans le menu ; le reste est voilé. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_200px_rgb(5_5_5/0.45)] ring-2 ring-texte-inverse" />
        </div>

        <label className="flex items-center gap-3 text-ui-xs text-texte-secondaire">
          Zoom
          <input
            type="range"
            min={1}
            max={ZOOM_MAX}
            step={0.01}
            value={cadre.zoom}
            onChange={(e) => zoomer(Number(e.target.value))}
            className="flex-1 accent-bleu-k1-500"
          />
        </label>

        <div className="flex justify-end gap-2">
          <Bouton type="button" variant="blanc" taille="md" onClick={onAnnuler}>
            Annuler
          </Bouton>
          <BoutonPrincipal type="button" disabled={!taille} onClick={valider}>
            Enregistrer
          </BoutonPrincipal>
        </div>
      </div>
    </div>,
    document.body,
  );
}
