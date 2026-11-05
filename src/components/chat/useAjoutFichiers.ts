"use client";

import { useCallback, useEffect, useRef, type ClipboardEvent } from "react";
import { getBridge } from "@/lib/bridge";
import { analyserCollage } from "@/lib/collage";

/** Pas plus de 10 fichiers par message. */
const MAX_FICHIERS = 10;

/**
 * Ajouter des pièces jointes à un composeur, commun à la conversation et à l'accueil :
 * des chemins (trombone, glisser), ou un collage (Ctrl/Cmd+V) dans le champ, où une
 * capture devient une pièce jointe et du texte se colle normalement.
 */
export function useAjoutFichiers(fichiers: string[], setFichiers: (fichiers: string[]) => void, setAlerte: (alerte: string | null) => void) {
  /* Les pièces jointes à jour même entre deux rendus : deux ajouts rapprochés (collages) ne s'écrasent pas. */
  const fichiersRef = useRef(fichiers);
  useEffect(() => {
    fichiersRef.current = fichiers;
  }, [fichiers]);

  const ajouter = useCallback(
    (chemins: string[]) => {
      const tous = [...new Set([...fichiersRef.current, ...chemins.filter(Boolean)])];
      setAlerte(tous.length > MAX_FICHIERS ? `${MAX_FICHIERS} fichiers au plus par message.` : null);
      fichiersRef.current = tous.slice(0, MAX_FICHIERS);
      setFichiers(fichiersRef.current);
    },
    [setFichiers, setAlerte],
  );

  const coller = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const bridge = getBridge();
    const colles = [...event.clipboardData.files];
    const collage = analyserCollage(
      event.clipboardData.getData("text/plain"),
      colles.map((f) => ({ type: f.type, taille: f.size, chemin: bridge?.fichiers.cheminDe(f) ?? "" })),
    );
    if (collage.action === "texte") return;
    event.preventDefault();
    const enregistrer = bridge?.fichiers.enregistrerCollage;
    if (!enregistrer) {
      setAlerte("Joindre des fichiers marche dans l’app de bureau.");
      return;
    }
    if (collage.chemins.length) ajouter(collage.chemins);
    if (collage.alerte) setAlerte(collage.alerte);
    if (collage.image === null) return;
    if (fichiersRef.current.length >= MAX_FICHIERS) {
      setAlerte(`${MAX_FICHIERS} fichiers au plus par message.`);
      return;
    }
    const image = colles[collage.image];
    void image
      .arrayBuffer()
      .then((contenu) => enregistrer(new Uint8Array(contenu), image.type))
      .then((r) => (r.ok ? ajouter([r.data]) : setAlerte(r.message)))
      .catch(() => setAlerte("L’image collée n’a pas pu être lue."));
  };

  return { ajouter, coller };
}
