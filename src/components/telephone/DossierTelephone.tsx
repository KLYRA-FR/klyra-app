"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { nomFichier } from "@/lib/fichiers";
import { useLecturePoste, type LecturePoste } from "@/lib/poste/client";
import {
  estCache,
  filAriane,
  iconeElement,
  montrerDans,
  parentDe,
  texteCoupure,
  urlDossier,
  urlFichier,
  urlProjet,
  type ElementDossier,
  type NiveauDossier,
} from "@/lib/telephone/dossiers";
import { useHorsLigne } from "./BandeauReseau";
import { EnteteTelephone } from "./EnteteTelephone";
import { MenuFeuille, type ActionMenu } from "./Feuille";
import { Bandeau, EtatEcran, useGestePossible, VueLecture } from "./etats";
import { Etiquette, GroupeListe, LigneListe, TuileIcone } from "./Liste";
import { usePostes, useSupport } from "./poste";
import { useTirerPourRelire } from "./TirerPourRelire";

/**
 * E6-13 à E6-21 : le dossier d'un projet, un niveau par écran (l'arbre du bureau devient une descente).
 * Chaque niveau est lu sur le poste à son ouverture, relu au retour dans l'app, en tirant la liste vers
 * le bas et par « Relire ». Ordinateur fermé : la dernière vue lue sur ce téléphone, rien dans le compte.
 */

const FERME = (sur: string) => `les fichiers de ce projet sont sur ${sur}. Ils s’affichent ici quand KLYRA y est ouverte.`;

export interface Niveau {
  lecture: LecturePoste<NiveauDossier> & { relancer: () => void };
  /** Ce qu'on montre : la liste lue, ou la précédente pendant une relecture. */
  affiche: NiveauDossier | null;
  relecture: boolean;
  relancer: () => void;
  /** « Relire » (le pendant du geste de tirer, M-9) et « Montrer dans le Finder » (P-8). */
  actions: ActionMenu[];
}

/** Un niveau du dossier lu sur le poste. `actif` à faux : rien n'est demandé (un autre onglet est affiché). */
export function useNiveau(projetId: string, chemin: string, actif = true): Niveau {
  const { principal } = usePostes();
  const enLigne = !useHorsLigne();
  const sur = useSupport();
  const { possible, raison } = useGestePossible();
  const lecture = useLecturePoste<NiveauDossier>("fichiers.arbre", actif && projetId ? { projetId, chemin } : null, { horsLigne: !enLigne });
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
      { libelle: "Relire", icone: "refresh-01", onChoisir: relancer, desactivee: !possible, note: raison },
      {
        libelle: montrerDans(principal?.systeme ?? null),
        icone: "folder-open-01",
        onChoisir: () => undefined,
        desactivee: true,
        note: "S’ouvre sur l’écran de l’ordinateur.",
        fin: <Etiquette>{`Sur ${sur}`}</Etiquette>,
      },
    ],
  };
}

/** L'écran d'un dossier : « ‹ » remonte d'un niveau, le chemin en haut ramène à n'importe lequel. */
export function DossierTelephone({ projetId, nomProjet, chemin }: { projetId: string; nomProjet: string; chemin: string }) {
  const [menu, setMenu] = useState(false);
  const niveau = useNiveau(projetId, chemin);
  const nom = nomFichier(chemin);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone
        titre={nom}
        parent={urlDossier(projetId, parentDe(chemin) ?? "")}
        droite={<BoutonIcone variant="discret" className="size-11" libelle="Actions du dossier" aria-haspopup="dialog" onClick={() => setMenu(true)} icone={<Icon name="dot-horizontal" size={24} />} />}
      />
      <ListeDossier projetId={projetId} niveau={niveau} tete={<FilAriane projetId={projetId} nomProjet={nomProjet} chemin={chemin} />} />
      {menu ? <MenuFeuille titre={nom} objet={{ visuel: <TuileIcone icone="folder" grande />, sous: `Dossier de ${nomProjet}` }} actions={niveau.actions} onFermer={() => setMenu(false)} /> : null}
    </div>
  );
}

/** « Menuiserie Arlod › maquettes » : des noms relatifs au projet ; défile à l'horizontale, chaque segment ramène à son niveau. */
function FilAriane({ projetId, nomProjet, chemin }: { projetId: string; nomProjet: string; chemin: string }) {
  const liste = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (liste.current) liste.current.scrollLeft = liste.current.scrollWidth;
  }, [chemin]);
  const segments = filAriane(nomProjet, chemin);
  return (
    <nav aria-label="Chemin du dossier" className="px-4">
      <ol ref={liste} className="-mx-1.5 flex h-11 items-center overflow-x-auto text-ui whitespace-nowrap [scrollbar-width:none]">
        {segments.map((segment, i) => (
          <Fragment key={segment.chemin}>
            {i > 0 ? (
              <li aria-hidden="true" className="flex shrink-0 items-center text-icone-secondaire">
                <Icon name="chevron-right" size={16} />
              </li>
            ) : null}
            <li className="flex shrink-0 items-center">
              {i === segments.length - 1 ? (
                <span aria-current="page" className="px-1.5 font-semibold text-texte-principal">
                  {segment.nom}
                </span>
              ) : (
                <Link href={urlDossier(projetId, segment.chemin)} className="flex min-h-11 items-center px-1.5 font-medium text-texte-secondaire no-underline active:bg-fond-survol">
                  {segment.nom}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** « Ce dossier n'existe plus » (E6-20) : la raison probable et une sortie claire. La vue gardée n'est pas touchée. */
function DossierDisparu({ projetId, message }: { projetId: string; message: string }) {
  const router = useRouter();
  return (
    <EtatEcran
      forme="plein"
      className="pt-8"
      erreur
      icone="help-circle-contained"
      titre={message.replace(/\.$/, "")}
      texte="Il a pu être renommé ou déplacé depuis ta dernière visite."
      action={
        <Bouton variant="blanc" taille="md" onClick={() => router.push(urlProjet(projetId, "fichiers"))}>
          Revenir au projet
        </Bouton>
      }
    />
  );
}

/** Les éléments d'un niveau, dossiers d'abord (l'ordre vient du poste), et ses états. Tirer la liste la relit. */
export function ListeDossier({ projetId, niveau, tete }: { projetId: string; niveau: Niveau; tete?: ReactNode }) {
  const sur = useSupport();
  const { possible } = useGestePossible();
  const tirage = useTirerPourRelire(niveau.relancer, { actif: possible, enCours: niveau.relecture });
  const affiche = niveau.affiche;
  const contenu = (n: NiveauDossier) => {
    const coupure = texteCoupure(n, sur);
    return n.elements.length === 0 ? (
      <EtatEcran forme="encadre" icone="folder-open-01" titre="Dossier vide" texte="Ce que tes agents y écriront s’affichera ici." />
    ) : (
      <div className="flex flex-col gap-3 px-4">
        <GroupeListe>
          {n.elements.map((element) => (
            <LigneElement key={element.chemin} projetId={projetId} element={element} />
          ))}
        </GroupeListe>
        {coupure ? (
          <Bandeau icone="list" role="status">
            {coupure}
          </Bandeau>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain pb-6" {...tirage.props}>
      {tirage.indicateur}
      {tete}
      <div className={tete ? "pt-1" : "pt-3"}>
        {affiche ? (
          contenu(affiche)
        ) : niveau.lecture.etat === "erreur" && niveau.lecture.code === "introuvable" ? (
          <DossierDisparu projetId={projetId} message={niveau.lecture.message} />
        ) : (
          /* Ordinateur fermé : la vue gardée du niveau. Un dossier ou un fichier jamais lu ici dit pourquoi à son ouverture. */
          <VueLecture
            lecture={niveau.lecture}
            ferme={FERME}
            lignes={6}
            verrou={false}
            sansRecours
            gestes="Les fichiers déjà ouverts sur ce téléphone restent lisibles. Relire"
          >
            {contenu}
          </VueLecture>
        )}
      </div>
    </div>
  );
}

/** Une ligne : sa tuile selon le type, son nom, ses marques écrites (plus de points de couleur à deviner). */
function LigneElement({ projetId, element }: { projetId: string; element: ElementDossier }) {
  const dossier = element.type === "dossier";
  const cache = estCache(element.nom);
  const marque = element.modifie ? "Modifié par un agent" : element.contientModifies ? "Contient des fichiers modifiés" : null;
  const lignes: ReactNode[] = [
    marque ? (
      <span key="marque" className="font-medium text-texte-accent">
        {marque}
      </span>
    ) : null,
    cache ? <span key="cache">{dossier ? "Dossier caché" : "Fichier caché"}</span> : null,
  ].filter(Boolean);
  return (
    <LigneListe
      href={dossier ? urlDossier(projetId, element.chemin) : urlFichier(projetId, element.chemin)}
      debut={<TuileIcone icone={iconeElement(element)} bleue={element.modifie} />}
      retrait="tuile"
      nom={cache ? <span className="text-texte-secondaire">{element.nom}</span> : element.nom}
      ligne2={
        lignes.length ? (
          <>
            {lignes.map((l, i) => (
              <Fragment key={i}>
                {i > 0 ? " · " : null}
                {l}
              </Fragment>
            ))}
          </>
        ) : undefined
      }
      fin={dossier ? "chevron" : undefined}
    />
  );
}
