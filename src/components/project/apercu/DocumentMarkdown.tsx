"use client";

import { Fragment, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { cibleLien } from "@/lib/apercu/liens";
import type { Alerte, Alignement, Bloc, DocumentMarkdown as Document, Inline } from "@/lib/apercu/markdown";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { LienDocument, type SuivreLien } from "./LienDocument";
import { CODE_EN_LIGNE, NUMERO, PAGE, PUCE, TABLEAU, TITRE_BASE, TITRES } from "./styles";

/** Où se trouve le document : ses liens et images relatifs partent de là. */
interface Lieu {
  chemin: string;
  dossier: string;
  suivre: SuivreLien;
}

/** Un document Markdown mis en forme : titres, listes, citations, code, tableaux, liens. */
export function DocumentMarkdown({ document, ...lieu }: { document: Document } & Lieu) {
  return (
    <article data-vue="apercu" className={PAGE}>
      {document.proprietes.length > 0 && <Proprietes valeurs={document.proprietes} />}
      <Blocs blocs={document.blocs} lieu={lieu} />
    </article>
  );
}

/** L'en-tête YAML : une fiche discrète de propriétés, comme Obsidian. */
function Proprietes({ valeurs }: { valeurs: [string, string][] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border border-bordure-subtile bg-fond-page px-4 py-3 text-ui-s leading-[1.5]">
      {valeurs.map(([cle, valeur], i) => (
        <Fragment key={i}>
          <dt className="truncate text-texte-tertiaire">{cle}</dt>
          <dd className="m-0 text-texte-principal [overflow-wrap:anywhere]">{valeur}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

const ALERTES: Record<Alerte, { libelle: string; cadre: string; titre: string }> = {
  note: { libelle: "Note", cadre: "border-bordure-accent-legere bg-fond-teinte-bleue", titre: "text-texte-accent" },
  astuce: { libelle: "Astuce", cadre: "border-bordure-subtile bg-fond-page", titre: "text-texte-accent" },
  important: { libelle: "Important", cadre: "border-bordure-accent-survol bg-fond-teinte-bleue", titre: "text-texte-accent" },
  attention: { libelle: "Attention", cadre: "border-transparent bg-fond-tag-orange", titre: "text-texte-accent-orange" },
  prudence: { libelle: "Prudence", cadre: "border-bordure-erreur/30 bg-fond-page", titre: "text-texte-erreur" },
};

const ALIGNEMENTS = { gauche: "text-left", centre: "text-center", droite: "text-right" } as const;
const aligne = (a: Alignement | undefined) => (a ? ALIGNEMENTS[a] : null);

function Blocs({ blocs, lieu }: { blocs: Bloc[]; lieu: Lieu }) {
  return blocs.map((bloc, i) => <BlocRendu key={i} bloc={bloc} lieu={lieu} />);
}

function BlocRendu({ bloc, lieu }: { bloc: Bloc; lieu: Lieu }) {
  switch (bloc.type) {
    case "titre": {
      const Balise = `h${bloc.niveau}` as "h1";
      return (
        <Balise data-ancre={bloc.id} className={cn(TITRE_BASE, TITRES[bloc.niveau - 1])}>
          <EnLigne noeuds={bloc.contenu} lieu={lieu} />
        </Balise>
      );
    }
    case "paragraphe":
      return (
        <p className="m-0 [overflow-wrap:anywhere]">
          <EnLigne noeuds={bloc.contenu} lieu={lieu} />
        </p>
      );
    case "code":
      return (
        <div className="relative">
          {bloc.langage && <span className="absolute top-2 right-3 text-ui-3xs text-texte-tertiaire select-none">{bloc.langage}</span>}
          <pre className="klyra-mono m-0 overflow-x-auto rounded-md border border-bordure-subtile bg-fond-page p-4 text-ui-xs leading-[1.65] whitespace-pre text-texte-principal">
            {bloc.texte}
          </pre>
        </div>
      );
    case "citation":
      if (bloc.alerte) {
        const a = ALERTES[bloc.alerte];
        return (
          <div role="note" className={cn("flex flex-col gap-2 rounded-md border px-4 py-3 text-ui leading-[1.6]", a.cadre)}>
            <span className={cn("text-ui-s font-semibold", a.titre)}>{a.libelle}</span>
            <Blocs blocs={bloc.blocs} lieu={lieu} />
          </div>
        );
      }
      return (
        <blockquote className="m-0 flex flex-col gap-3 border-l-2 border-bordure-forte pl-4 text-texte-secondaire">
          <Blocs blocs={bloc.blocs} lieu={lieu} />
        </blockquote>
      );
    case "liste": {
      const Liste = bloc.ordonnee ? "ol" : "ul";
      return (
        <Liste className={cn("m-0 flex list-none flex-col pl-0", bloc.serree ? "gap-1" : "gap-3")}>
          {bloc.elements.map((el, j) => (
            <li key={j} className="flex gap-3">
              {el.coche !== null ? (
                <span className="flex h-[1.7em] w-[18px] shrink-0 items-center justify-center">
                  {el.coche ? <PixelCheck className="h-[13px] w-[18px]" /> : <span className="size-3 rounded-2xs border border-gris-k1-300 bg-fond-surface" />}
                  <span className="sr-only">{el.coche ? "Fait : " : "À faire : "}</span>
                </span>
              ) : bloc.ordonnee ? (
                <span aria-hidden="true" className={NUMERO}>
                  {String(bloc.debut + j).padStart(2, "0")}
                </span>
              ) : (
                <span aria-hidden="true" className={PUCE} />
              )}
              <div className={cn("flex min-w-0 flex-1 flex-col", bloc.serree ? "gap-1" : "gap-3", el.coche && "text-texte-secondaire")}>
                <Blocs blocs={el.blocs} lieu={lieu} />
              </div>
            </li>
          ))}
        </Liste>
      );
    }
    case "tableau":
      return (
        <div className={TABLEAU.cadre}>
          <table className={TABLEAU.table}>
            <thead>
              <tr>
                {bloc.entete.map((cellule, k) => (
                  <th key={k} scope="col" className={cn(TABLEAU.entete, aligne(bloc.alignements[k]))}>
                    <EnLigne noeuds={cellule} lieu={lieu} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloc.lignes.map((ligne, r) => (
                <tr key={r} className={TABLEAU.rangee}>
                  {ligne.map((cellule, k) => (
                    <td key={k} className={cn(TABLEAU.cellule, aligne(bloc.alignements[k]))}>
                      <EnLigne noeuds={cellule} lieu={lieu} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "separateur":
      return <hr className="my-2 h-px w-full border-0 bg-bordure-defaut" />;
  }
}

function EnLigne({ noeuds, lieu }: { noeuds: Inline[]; lieu: Lieu }) {
  return noeuds.map((n, i) => {
    switch (n.type) {
      case "texte":
        return <Fragment key={i}>{n.texte}</Fragment>;
      case "saut":
        return <br key={i} />;
      case "code":
        return (
          <code key={i} className={CODE_EN_LIGNE}>
            {n.texte}
          </code>
        );
      case "gras":
        return (
          <strong key={i} className="font-semibold">
            <EnLigne noeuds={n.enfants} lieu={lieu} />
          </strong>
        );
      case "italique":
        return (
          <em key={i}>
            <EnLigne noeuds={n.enfants} lieu={lieu} />
          </em>
        );
      case "barre":
        return (
          <del key={i} className="text-texte-tertiaire">
            <EnLigne noeuds={n.enfants} lieu={lieu} />
          </del>
        );
      case "lien":
        return (
          <LienDocument key={i} href={n.href} titre={n.titre} chemin={lieu.chemin} suivre={lieu.suivre}>
            <EnLigne noeuds={n.enfants} lieu={lieu} />
          </LienDocument>
        );
      case "image":
        return <ImageDocument key={i} src={n.src} alt={n.alt} titre={n.titre} lieu={lieu} />;
    }
  });
}

/**
 * Une image du document : lue dans le projet si elle y est. Une image en ligne
 * n'est pas chargée (l'app ne va pas chercher sur internet pour un aperçu) :
 * son texte reste, avec un lien pour l'ouvrir dans le navigateur.
 */
function ImageDocument({ src, alt, titre, lieu }: { src: string; alt: string; titre: string | null; lieu: Lieu }) {
  const cible = cibleLien(src, lieu.chemin);
  const cheminImage = cible.type === "fichier" ? cible.chemin : null;
  const [lue, setLue] = useState<{ chemin: string; dataUrl: string } | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge || !cheminImage) return;
    let actif = true;
    void bridge.projets.lireFichier(lieu.dossier, cheminImage).then((r) => {
      if (actif && r.ok && r.data.type === "image") setLue({ chemin: cheminImage, dataUrl: r.data.dataUrl });
    });
    return () => {
      actif = false;
    };
  }, [lieu.dossier, cheminImage]);

  if (lue && lue.chemin === cheminImage) {
    /* eslint-disable-next-line @next/next/no-img-element -- image du projet, lue en data URL */
    return <img src={lue.dataUrl} alt={alt} title={titre ?? undefined} className="inline-block max-w-full rounded-md align-middle" />;
  }
  const etiquette = (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-fond-surface-grise px-2 py-0.5 align-middle text-ui-xs text-texte-secondaire no-underline">
      <Icon name="image-01" size={14} className="shrink-0 text-icone-secondaire" />
      {alt || "Image"}
    </span>
  );
  return cible.type === "externe" ? (
    <LienDocument href={src} titre={titre} chemin={lieu.chemin} suivre={lieu.suivre}>
      {etiquette}
    </LienDocument>
  ) : (
    etiquette
  );
}
