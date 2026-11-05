"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { getBridge } from "@/lib/bridge";
import { nomImage } from "@/lib/collage";
import { estImage, nomFichier, tailleLisible } from "@/lib/fichiers";
import { poste } from "@/lib/plateforme";

/**
 * Une image jointe, comme dans OpenBot : une vignette, une puce « image.png 234 Ko »
 * derrière le texte, et un clic qui l'ouvre dans le panneau de droite de la conversation.
 * Hors d'une conversation (l'accueil), l'image s'ouvre avec l'app du système.
 */

const OUVRIR_IMAGE = "klyra:image";

interface DemandeImage {
  chemin: string;
  pris: boolean;
}

export function ouvrirImage(chemin: string) {
  const demande: DemandeImage = { chemin, pris: false };
  window.dispatchEvent(new CustomEvent<DemandeImage>(OUVRIR_IMAGE, { detail: demande }));
  if (!demande.pris) void getBridge()?.rendus.ouvrir(chemin);
}

interface ImageLue {
  url: string;
  taille: number;
}

/* La vignette et la puce d'une même image ne la lisent qu'une fois. */
const VIGNETTES_GARDEES = 40;
const vignettes = new Map<string, Promise<ImageLue>>();

async function lireDuDisque(chemin: string, pleine: boolean): Promise<ImageLue> {
  const lire = getBridge()?.fichiers.image;
  if (!lire) throw new Error("Aperçu indisponible.");
  const r = await lire(chemin, pleine);
  if (!r.ok) throw new Error(r.message);
  return r.data;
}

function lireImage(chemin: string, pleine: boolean): Promise<ImageLue> {
  if (pleine) return lireDuDisque(chemin, true);
  const deja = vignettes.get(chemin);
  if (deja) return deja;
  const lecture = lireDuDisque(chemin, false);
  vignettes.set(chemin, lecture);
  lecture.catch(() => vignettes.delete(chemin));
  if (vignettes.size > VIGNETTES_GARDEES) vignettes.delete(vignettes.keys().next().value as string);
  return lecture;
}

function useImageJointe(chemin: string, pleine = false) {
  const [lue, setLue] = useState<{ chemin: string; image: ImageLue | null; erreur: string | null } | null>(null);
  useEffect(() => {
    let actif = true;
    lireImage(chemin, pleine).then(
      (image) => actif && setLue({ chemin, image, erreur: null }),
      (e: unknown) => actif && setLue({ chemin, image: null, erreur: e instanceof Error ? e.message : "Image illisible." }),
    );
    return () => {
      actif = false;
    };
  }, [chemin, pleine]);
  return lue?.chemin === chemin ? lue : null;
}

/** La vignette d'une image avant l'envoi. `repli` : la carte du fichier, si l'image ne se lit pas. */
export function VignettePiece({ chemin, croix, repli }: { chemin: string; croix: ReactNode; repli: ReactNode }) {
  const lue = useImageJointe(chemin);
  if (lue?.erreur) return repli;
  return (
    <div title={nomFichier(chemin)} className="group/piece relative size-[52px] shrink-0">
      <button
        type="button"
        onClick={() => ouvrirImage(chemin)}
        aria-label={`Ouvrir ${nomImage(chemin)}`}
        className="block size-full cursor-pointer overflow-hidden rounded-md border border-bordure-subtile bg-fond-surface-grise p-0 transition-colors duration-[120ms] hover:border-bordure-forte"
      >
        {lue?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lue.image.url} alt="" className="size-full object-cover object-top" />
        )}
      </button>
      {croix}
    </div>
  );
}

function PuceImage({ chemin }: { chemin: string }) {
  const lue = useImageJointe(chemin);
  if (lue?.erreur) return null;
  return (
    <button
      type="button"
      onClick={() => ouvrirImage(chemin)}
      title={nomFichier(chemin)}
      className="flex h-[34px] max-w-full cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-ui text-bleu-k1-500 hover:underline"
    >
      <Icon name="image-01" size={14} className="shrink-0" />
      <span className="truncate">{nomImage(chemin)}</span>
      {lue?.image && <span className="shrink-0 text-ui-xs text-texte-tertiaire">{tailleLisible(lue.image.taille)}</span>}
    </button>
  );
}

/** Les puces des images, posées derrière le texte du message. */
export function PucesImages({ fichiers }: { fichiers: string[] }) {
  return fichiers.filter(estImage).map((chemin) => <PuceImage key={chemin} chemin={chemin} />);
}

/** Une image dans un message envoyé. `repli` : la carte du fichier, si l'image n'est plus là. */
export function VignetteMessage({ chemin, repli }: { chemin: string; repli: ReactNode }) {
  const lue = useImageJointe(chemin);
  if (lue?.erreur) return repli;
  return (
    <button
      type="button"
      onClick={() => ouvrirImage(chemin)}
      title={`${nomFichier(chemin)}\nClic pour l’ouvrir`}
      className="block h-[140px] w-full cursor-pointer overflow-hidden rounded-md border border-bordure-subtile bg-fond-surface-grise p-0 transition-colors duration-[120ms] hover:border-bordure-forte"
    >
      {lue?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={lue.image.url} alt={nomImage(chemin)} className="size-full object-cover object-top" />
      )}
    </button>
  );
}

/** L'image en grand, dans le panneau de droite. */
export function VueImage({ chemin, onFermer }: { chemin: string; onFermer?: () => void }) {
  const lue = useImageJointe(chemin, true);
  const bridge = getBridge();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-bordure-subtile pr-2 pl-3">
        <span title={nomFichier(chemin)} className="min-w-0 truncate text-ui-xs font-medium text-texte-principal">
          {nomImage(chemin)}
        </span>
        {lue?.image && <span className="shrink-0 text-ui-2xs text-texte-tertiaire">{tailleLisible(lue.image.taille)}</span>}
        <span className="flex-1" />
        <BoutonIcone taille="mini" icone={<Icon name="link-external" size={16} />} libelle="Ouvrir avec l’app du système" onClick={() => void bridge?.rendus.ouvrir(chemin)} className="text-icone-secondaire" />
        <BoutonIcone taille="mini" icone={<Icon name="folder" size={16} />} libelle={`Montrer ${poste.dansExplorateur}`} onClick={() => void bridge?.fichiers.montrer(chemin)} className="text-icone-secondaire" />
        {onFermer && <BoutonIcone taille="mini" icone={<Icon name="x-01" size={16} />} libelle="Fermer l’image" data-son="fermer" onClick={onFermer} className="text-icone-secondaire" />}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-fond-surface-grise p-3">
        {lue?.erreur && <span className="text-center text-ui-xs text-texte-tertiaire">{lue.erreur}</span>}
        {lue?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lue.image.url} alt={nomImage(chemin)} className="max-h-full max-w-full rounded-2xs object-contain" />
        )}
      </div>
    </div>
  );
}

/** Les images ouvertes dans le panneau d'une conversation. Elles ne survivent pas à un changement de conversation. */
export function useImagesOuvertes(chatId: string, surOuverture: () => void) {
  const vide = { chatId, ouvertes: [] as string[], active: null as string | null };
  const [etat, setEtat] = useState(vide);
  if (etat.chatId !== chatId) setEtat(vide);

  useEffect(() => {
    const prendre = (e: Event) => {
      const demande = (e as CustomEvent<DemandeImage>).detail;
      demande.pris = true;
      setEtat((s) => ({ ...s, ouvertes: s.ouvertes.includes(demande.chemin) ? s.ouvertes : [...s.ouvertes, demande.chemin], active: demande.chemin }));
      surOuverture();
    };
    window.addEventListener(OUVRIR_IMAGE, prendre);
    return () => window.removeEventListener(OUVRIR_IMAGE, prendre);
  }, [surOuverture]);

  const choisir = useCallback((chemin: string | null) => setEtat((s) => (s.active === chemin ? s : { ...s, active: chemin })), []);
  const fermer = useCallback(
    (chemin: string) =>
      setEtat((s) => {
        const ouvertes = s.ouvertes.filter((c) => c !== chemin);
        return { ...s, ouvertes, active: s.active === chemin ? (ouvertes.at(-1) ?? null) : s.active };
      }),
    [],
  );
  return { ouvertes: etat.ouvertes, active: etat.active, choisir, fermer };
}
