"use client";

import { nomLieu, useLieuActif, useServeursRelies } from "@/lib/lieux";

/** Sur un VPS, ce que ce réglage veut dire : il agit sur cet ordinateur, pas sur le serveur affiché. */
export function NotePoste({ texte }: { texte: (serveur: string) => string }) {
  const lieu = useLieuActif();
  const nom = nomLieu(lieu, useServeursRelies());
  if (!lieu) return null;
  return (
    <p role="note" className="m-0 rounded-md bg-fond-surface-grise px-3 py-2 text-ui-s text-texte-secondaire">
      {texte(nom)}
    </p>
  );
}
