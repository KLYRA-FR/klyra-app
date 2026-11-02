"use client";

import { useMemo } from "react";
import { qrMatrice } from "../../../serveur/qr.mjs";

const MARGE = 4;

/**
 * Le QR d'une adresse, dessiné par le générateur du serveur VPS (`serveur/qr.mjs`, sans dépendance) :
 * un carré SVG par module, à la couleur du texte. Jamais de SVG injecté. L'adresse reste écrite à
 * côté : le QR n'est jamais le seul chemin.
 */
export function QrCode({ texte, libelle, taille = 160 }: { texte: string; libelle: string; taille?: number }) {
  const modules = useMemo<number[][] | null>(() => {
    try {
      return qrMatrice(texte);
    } catch {
      return null;
    }
  }, [texte]);
  if (!modules) return null;
  const cote = modules.length + MARGE * 2;
  return (
    <svg
      role="img"
      aria-label={libelle}
      viewBox={`0 0 ${cote} ${cote}`}
      width={taille}
      height={taille}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-md bg-fond-surface text-texte-principal"
    >
      {modules.flatMap((ligne, y) =>
        ligne.map((plein, x) => (plein ? <rect key={`${x}-${y}`} x={x + MARGE} y={y + MARGE} width={1} height={1} fill="currentColor" /> : null)),
      )}
    </svg>
  );
}
