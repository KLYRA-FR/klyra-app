"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { nomFichier } from "@/lib/fichiers";
import { useLecturePoste, type LecturePoste } from "@/lib/poste/client";
import {
  etatTirage,
  filAriane,
  montrerDans,
  parentDe,
  texteCoupure,
  urlDossier,
  urlFichier,
  type ElementDossier,
  type NiveauDossier,
} from "@/lib/telephone/dossiers";
import { EnteteTelephone } from "./EnteteTelephone";
import { MenuFeuille, type ActionMenu } from "./Feuille";
import { NotePoste, SurLePoste, VueLecture } from "./etats";
import { usePostes } from "./poste";

/**
 * T-12 : le dossier d'un projet, un niveau par écran (spec § 6 : l'arbre du bureau devient une
 * descente). Chaque niveau est lu sur le poste à son ouverture, relu au retour dans l'app et en
 * tirant la liste vers le bas. Rien n'est gardé dans le compte (M-7).
 */

const FERME = (sur: string) => `les fichiers de ce projet sont sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`;

export interface Niveau {
  lecture: LecturePoste<NiveauDossier> & { relancer: () => void };
  /** Ce qu'on montre : la liste lue, ou la précédente pendant une relecture. */
  affiche: NiveauDossier | null;
  relecture: boolean;
  relancer: () => void;
  /** « Relire » (le pendant du geste de tirer, M-9) et « Montrer dans le Finder » (P-8). */
  actions: ActionMenu[];
}

/** Un niveau du dossier lu sur le poste. `actif` à faux : rien n'est demandé (onglet Chats affiché). */
export function useNiveau(projetId: string, chemin: string, actif = true): Niveau {
  const { ouvert, principal } = usePostes();
  const lecture = useLecturePoste<NiveauDossier>("fichiers.arbre", actif && projetId ? { projetId, chemin } : null);
  const { relancer } = lecture;
  const cle = `${projetId}|${chemin}`;
  const lu = lecture.etat === "ok" ? lecture.data : null;
  /* La dernière liste reste affichée pendant qu'on la relit : pas de clignotement au retour dans l'app. */
  const [dernier, setDernier] = useState<{ cle: string; niveau: NiveauDossier } | null>(null);
  if (lu && dernier?.niveau !== lu) setDernier({ cle, niveau: lu });

  // Ce qui a changé sur le disque pendant qu'on était ailleurs : relu au retour, comme au bureau.
  useEffect(() => {
    if (!actif) return;
    const auRetour = () => {
      if (document.visibilityState === "visible") relancer();
    };
    document.addEventListener("visibilitychange", auRetour);
    return () => document.removeEventListener("visibilitychange", auRetour);
  }, [actif, relancer]);

  const relecture = lecture.etat === "attente" && dernier?.cle === cle;
  return {
    lecture,
    affiche: lu ?? (relecture ? dernier!.niveau : null),
    relecture,
    relancer,
    actions: [
      { libelle: "Relire", onChoisir: relancer, desactivee: !ouvert, note: ouvert ? undefined : <NotePoste /> },
      { libelle: montrerDans(principal?.systeme ?? null), onChoisir: () => undefined, desactivee: true, note: <SurLePoste raison="s’ouvre sur l’écran de l’ordinateur." /> },
    ],
  };
}

/** L'écran d'un dossier : « ‹ » remonte d'un niveau, le chemin en haut ramène à n'importe lequel. */
export function DossierTelephone({ projetId, nomProjet, chemin }: { projetId: string; nomProjet: string; chemin: string }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const niveau = useNiveau(projetId, chemin);
  const nom = nomFichier(chemin);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone
        titre={nom}
        retour={() => router.push(urlDossier(projetId, parentDe(chemin) ?? ""))}
        droite={<BoutonIcone variant="discret" taille="md" libelle="Actions du dossier" onClick={() => setMenu(true)} icone={<Icon name="dot-horizontal" size={24} />} />}
      />
      <FilAriane projetId={projetId} nomProjet={nomProjet} chemin={chemin} />
      <ListeDossier projetId={projetId} niveau={niveau} />
      {menu ? <MenuFeuille titre={nom} actions={niveau.actions} onFermer={() => setMenu(false)} /> : null}
    </div>
  );
}

/** « DIGITAL-OS › 30_CLIENTS » : défile à l'horizontale, le dernier en gras, chaque segment ramène à son niveau. */
function FilAriane({ projetId, nomProjet, chemin }: { projetId: string; nomProjet: string; chemin: string }) {
  const liste = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (liste.current) liste.current.scrollLeft = liste.current.scrollWidth;
  }, [chemin]);
  const segments = filAriane(nomProjet, chemin);
  return (
    <nav aria-label="Chemin du dossier" className="shrink-0 border-b border-bordure-subtile">
      <ol ref={liste} className="flex items-center overflow-x-auto px-3 whitespace-nowrap [scrollbar-width:none]">
        {segments.map((segment, i) => (
          <li key={segment.chemin} className="flex shrink-0 items-center">
            {i > 0 ? (
              <span aria-hidden="true" className="px-0.5 text-ui text-texte-secondaire">
                ›
              </span>
            ) : null}
            {i === segments.length - 1 ? (
              <span aria-current="page" className="flex min-h-11 items-center px-1 text-ui font-medium text-texte-principal">
                {segment.nom}
              </span>
            ) : (
              <Link href={urlDossier(projetId, segment.chemin)} className="flex min-h-11 min-w-11 items-center justify-center px-1 text-ui text-texte-secondaire active:bg-fond-survol">
                {segment.nom}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Tirer la liste vers le bas, depuis son haut, la relit. « Relire » du menu fait la même chose (M-9). */
function useTirerPourRelire(relire: () => void, actif: boolean) {
  const [distance, setDistance] = useState(0);
  const depart = useRef<number | null>(null);
  const etat = etatTirage(distance);
  const arreter = () => {
    depart.current = null;
    setDistance(0);
  };
  return {
    ...etat,
    gestes: {
      onTouchStart: (e: TouchEvent<HTMLElement>) => {
        depart.current = actif && e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null;
      },
      onTouchMove: (e: TouchEvent<HTMLElement>) => {
        if (depart.current === null) return;
        if (e.currentTarget.scrollTop > 0) return arreter();
        setDistance(e.touches[0].clientY - depart.current);
      },
      onTouchEnd: () => {
        if (depart.current !== null && etat.pret) relire();
        arreter();
      },
      onTouchCancel: arreter,
    },
  };
}

/** Les éléments d'un niveau, dossiers d'abord (l'ordre vient du poste), et ses cinq états. */
export function ListeDossier({ projetId, niveau }: { projetId: string; niveau: Niveau }) {
  const { ouvert } = usePostes();
  const tirage = useTirerPourRelire(niveau.relancer, ouvert);
  const affiche = niveau.affiche;
  const coupure = affiche ? texteCoupure(affiche) : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-4" {...tirage.gestes}>
      {tirage.hauteur > 0 ? (
        <div style={{ height: tirage.hauteur }} className="flex items-end justify-center pb-2 text-ui-xs text-texte-secondaire">
          {tirage.pret ? "Relâche pour relire" : "Tire pour relire"}
        </div>
      ) : null}
      {niveau.relecture ? (
        <p role="status" className="px-4 pt-1 text-ui-xs text-texte-secondaire">
          Relecture…
        </p>
      ) : null}
      {affiche ? (
        affiche.elements.length === 0 ? (
          <p className="px-4 pt-8 text-body-s text-texte-principal">Dossier vide</p>
        ) : (
          <ul className="px-4">
            {affiche.elements.map((element) => (
              <LigneElement key={element.chemin} projetId={projetId} element={element} />
            ))}
          </ul>
        )
      ) : (
        <VueLecture lecture={niveau.lecture} ferme={FERME} lignes={6}>
          {() => null}
        </VueLecture>
      )}
      {coupure ? (
        <p role="status" className="px-4 pt-3 text-ui-xs text-texte-secondaire">
          {coupure}
        </p>
      ) : null}
    </div>
  );
}

/** Une ligne de 48 px. Les marques sont des points pour l'œil, et un texte pour les lecteurs d'écran. */
function LigneElement({ projetId, element }: { projetId: string; element: ElementDossier }) {
  const dossier = element.type === "dossier";
  return (
    <li className="border-b border-bordure-subtile last:border-b-0">
      <Link href={dossier ? urlDossier(projetId, element.chemin) : urlFichier(projetId, element.chemin)} className="flex min-h-12 items-center gap-3 active:bg-fond-survol">
        <Icon name={dossier ? "folder" : "file-01"} size={20} className={cn("shrink-0", element.modifie ? "text-icone-accent" : "text-icone-secondaire")} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-body-s",
            element.modifie ? "font-medium text-texte-accent" : element.nom.startsWith(".") ? "text-texte-secondaire" : "text-texte-principal",
          )}
        >
          {element.nom}
        </span>
        {element.modifie ? <span role="img" aria-label="Modifié par un agent" className="size-2 shrink-0 bg-bleu-k1-500" /> : null}
        {element.contientModifies ? <span role="img" aria-label="Contient des fichiers modifiés" className="size-2 shrink-0 bg-bleu-k1-200" /> : null}
        {dossier ? <Icon name="chevron-right" size={16} className="shrink-0 text-icone-secondaire" /> : null}
      </Link>
    </li>
  );
}
