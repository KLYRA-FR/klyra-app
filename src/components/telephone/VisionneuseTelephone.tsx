"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { DocumentMarkdown } from "@/components/project/apercu/DocumentMarkdown";
import { DocumentWord } from "@/components/project/apercu/DocumentWord";
import { Classeur, TableauTexte } from "@/components/project/apercu/Grille";
import { COULEURS, VueSource } from "@/components/project/apercu/VueSource";
import { colorer, langageDe, type Langage } from "@/lib/apercu/coloration";
import { ancreDe, cibleLien } from "@/lib/apercu/liens";
import { lireMarkdown } from "@/lib/apercu/markdown";
import { indenterJson, renduDe } from "@/lib/apercu/texte";
import { nomFichier } from "@/lib/fichiers";
import { useGestePoste, useLecturePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { dossierAffiche, montrerDans, ouvrableADistance, tailleLisible, urlFichier, urlRetourFichier, type FichierLu } from "@/lib/telephone/dossiers";
import { EnteteTelephone } from "./EnteteTelephone";
import { MenuFeuille, type ActionMenu } from "./Feuille";
import { NotePoste, SurLePoste, useBandeau, VueLecture } from "./etats";
import { usePostes, useSupport } from "./poste";

/**
 * T-13 : un fichier du projet en page pleine (la barre du bas est recouverte). Le poste lit et met
 * en forme, le téléphone affiche avec les rendus du bureau, recomposés pour une colonne. Le contenu
 * n'est gardé ni dans le compte (M-7) ni sur le téléphone : il vit le temps de l'écran.
 */

/** Une image de 15 Mo passe par le stockage du compte, à l'aller puis au retour : plus que le délai de P-10. */
const DELAI_LECTURE_MS = 45_000;
/** Les fichiers ouverts par des liens qu'on garde pour « ‹ ». */
const PILE_MAX = 20;

/**
 * Les rendus du bureau (Markdown, Word, tableaux, source) recomposés pour le téléphone (spec § 6 et
 * § 9) : marges de 16 px, titres aux tailles du téléphone (h1 24, h2 18, h3 16), texte de 12 px au
 * moins, pas de gris tertiaire pour du texte, onglets des feuilles à 44 px.
 */
const RECOMPOSITION = [
  "[&_article]:px-4 [&_article]:pt-4 [&_article]:pb-10",
  "[&_article_h1]:mt-6 [&_article_h1]:text-h4 [&_article_h2]:mt-6 [&_article_h2]:text-body [&_article_h3]:text-body-s [&_article_p.text-h2]:text-h4",
  "[&_.text-ui-2xs]:text-ui-xs [&_.text-ui-3xs]:text-ui-xs [&_.text-texte-tertiaire]:text-texte-secondaire",
  "[&_[data-vue=source]]:text-body-s [&_[role=tab]]:min-h-11",
].join(" ");

export function VisionneuseTelephone({
  projetId,
  nomProjet,
  chemin,
  ancre,
  retour,
}: {
  projetId: string;
  nomProjet: string;
  chemin: string;
  ancre: string | null;
  retour: string[];
}) {
  const router = useRouter();
  const sur = useSupport();
  const { ouvert, principal } = usePostes();
  const lecture = useLecturePoste<FichierLu>("fichiers.lire", projetId ? { projetId, chemin } : null, { delai: DELAI_LECTURE_MS });
  const { faire, occupe } = useGestePoste();
  const [bandeau, dire] = useBandeau();
  const [vue, setVue] = useState<"apercu" | "source">("apercu");
  const [couper, setCouper] = useState(true);
  const [menu, setMenu] = useState(false);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const corps = useRef<HTMLDivElement>(null);
  const nom = nomFichier(chemin);
  const rendu = renduDe(chemin);
  const langage = langageDe(chemin);

  const lu = lecture.etat === "ok" ? lecture.data : null;
  const contenu = lu?.contenu ?? null;
  const texte = contenu?.type === "texte" ? contenu.texte : null;
  const lignes = useMemo(() => (texte === null ? 0 : texte.split("\n").length), [texte]);
  const markdown = useMemo(() => (texte !== null && rendu === "markdown" ? lireMarkdown(texte) : null), [texte, rendu]);
  const jsonIndente = useMemo(() => (texte !== null && rendu === "json" ? indenterJson(texte) : null), [texte, rendu]);
  /** Une vue mise en forme existe : le choix Aperçu / Source s'affiche (comme au bureau). */
  const formate = texte !== null && (rendu === "markdown" || rendu === "tableau" || jsonIndente !== null);
  const source = texte !== null && (!formate || vue === "source" || (rendu === "json" && jsonIndente !== null));

  const defiler = useCallback((cible: string | null) => {
    if (!cible || !corps.current) return;
    const titre =
      corps.current.querySelector<HTMLElement>(`[data-ancre="${CSS.escape(cible)}"]`) ??
      corps.current.querySelector<HTMLElement>(`[data-ancre="${CSS.escape(ancreDe(cible))}"]`);
    titre?.scrollIntoView({ block: "start" });
  }, []);

  // Arrivé par un lien `fichier.md#titre` : on va au titre dès que le document est affiché.
  useEffect(() => {
    if (markdown && vue === "apercu") defiler(ancre);
  }, [markdown, vue, ancre, defiler]);

  /** Web et e-mail : le navigateur ou la messagerie du téléphone. Chemin relatif : ce fichier, ici (T-13). */
  const suivreLien = useCallback(
    (href: string) => {
      const cible = cibleLien(href, chemin);
      if (cible.type === "externe" && cible.url.startsWith("mailto:")) window.location.href = cible.url;
      else if (cible.type === "externe") window.open(cible.url, "_blank", "noreferrer");
      else if (cible.type === "ancre") defiler(cible.ancre);
      else if (cible.type === "fichier" && cible.chemin === chemin) defiler(cible.ancre);
      else if (cible.type === "fichier") router.push(urlFichier(projetId, cible.chemin, { ancre: cible.ancre, retour: [...retour, chemin].slice(-PILE_MAX) }));
    },
    [chemin, defiler, projetId, retour, router],
  );

  const ouvrirSurPoste = async () => {
    const r = await faire("fichiers.ouvrir", { projetId, chemin });
    if (r.ok) dire(`Ouvert sur ${sur}`);
    else dire(r.code === "delai" ? `${majuscule(sur)} ne répond pas.` : r.message || "Le geste a échoué sur l’ordinateur.");
  };
  /* Un fichier d'un VPS n'est pas sur l'ordinateur : rien à y ouvrir (comme au bureau). Un programme ne s'ouvre pas à distance. */
  const ouvrable = lu?.surPoste !== false;
  const aDistance = ouvrableADistance(chemin);
  const noteOuvrir = !aDistance ? <SurLePoste raison="ce type de fichier ne s’ouvre que devant l’ordinateur." /> : ouvert ? undefined : <NotePoste />;

  const actions: ActionMenu[] = [
    ...(ouvrable ? [{ libelle: `Ouvrir sur ${sur}`, onChoisir: () => void ouvrirSurPoste(), desactivee: !aDistance || !ouvert || occupe, note: noteOuvrir }] : []),
    { libelle: montrerDans(principal?.systeme ?? null), onChoisir: () => undefined, desactivee: true, note: <SurLePoste raison="s’ouvre sur l’écran de l’ordinateur." /> },
    ...(source ? [{ libelle: couper ? "Ne pas couper les lignes" : "Couper les lignes", onChoisir: () => setCouper((c) => !c) }] : []),
  ];

  const details = [
    dossierAffiche(nomProjet, chemin),
    contenu && tailleLisible(contenu.taille),
    dimensions,
    texte !== null && `${lignes} lignes`,
    contenu?.type === "classeur" && contenu.feuilles.length > 1 && `${contenu.feuilles.length} feuilles`,
  ].filter(Boolean);

  return (
    <div role="dialog" aria-label={nom} className="fixed inset-0 z-30 flex flex-col bg-fond-page">
      <EnteteTelephone
        titre={nom}
        retour={() => router.push(urlRetourFichier(projetId, chemin, retour))}
        droite={<BoutonIcone variant="discret" taille="md" libelle="Actions du fichier" onClick={() => setMenu(true)} icone={<Icon name="dot-horizontal" size={24} />} />}
      />
      <div className="shrink-0 border-b border-bordure-subtile px-4 pb-2">
        <p className="klyra-mono truncate text-ui-xs text-texte-secondaire">{details.join(" · ")}</p>
        {formate ? (
          <Onglets
            libelle="Affichage du fichier"
            onglets={[
              { id: "apercu", label: "Aperçu" },
              { id: "source", label: "Source" },
            ]}
            valeur={vue}
            onChange={setVue}
            className="mt-2 flex w-full [&>button]:min-h-10 [&>button]:flex-1 [&>button]:justify-center [&>button]:text-ui"
          />
        ) : null}
      </div>

      <div ref={corps} className={`flex min-h-0 flex-1 flex-col bg-fond-surface pb-[env(safe-area-inset-bottom)] ${RECOMPOSITION}`}>
        <VueLecture lecture={lecture} ferme={(s) => `les fichiers de ce projet sont sur ${s}. Ils s’affichent quand KLYRA y est ouverte.`}>
          {({ contenu: c }) => (
            <>
              {c.type === "image" ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  <div className="flex min-h-full items-center justify-center bg-fond-surface-grise p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element -- image du projet, reçue en data URL */}
                    <img
                      src={c.dataUrl}
                      alt={nom}
                      onLoad={(e) => setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)}
                      className="h-auto max-w-full"
                    />
                  </div>
                </div>
              ) : null}

              {texte !== null &&
                (source ? (
                  couper ? (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <SourceCoupee texte={rendu === "json" && jsonIndente !== null && vue === "apercu" ? jsonIndente : texte} langage={langage} />
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-auto">
                      <VueSource texte={rendu === "json" && jsonIndente !== null && vue === "apercu" ? jsonIndente : texte} langage={langage} />
                    </div>
                  )
                ) : markdown ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <DocumentMarkdown document={markdown} chemin={chemin} dossier="" suivre={suivreLien} />
                  </div>
                ) : (
                  <TableauTexte texte={texte} tsv={/\.tsv$/i.test(chemin)} />
                ))}

              {c.type === "classeur" ? <Classeur feuilles={c.feuilles} /> : null}

              {c.type === "document" ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <DocumentWord blocs={c.blocs} chemin={chemin} suivre={suivreLien} />
                </div>
              ) : null}

              {c.type === "autre" ? (
                <div className="px-4 pt-8">
                  <p className="text-body-s text-texte-principal">{c.raison}</p>
                  {ouvrable ? (
                    <>
                      <Bouton variant="blanc" taille="md" className="mt-4" disabled={!aDistance || !ouvert || occupe} onClick={() => void ouvrirSurPoste()}>
                        Ouvrir sur {sur}
                      </Bouton>
                      {noteOuvrir}
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </VueLecture>
      </div>
      {menu ? <MenuFeuille titre={nom} actions={actions} onFermer={() => setMenu(false)} /> : null}
      {bandeau}
    </div>
  );
}

/**
 * La source sur le téléphone : les lignes longues sont coupées (le numéro reste sur la première
 * ligne visuelle), la coloration est celle du bureau. Lecture seule, texte sélectionnable sans les numéros.
 */
function SourceCoupee({ texte, langage }: { texte: string; langage: Langage | null }) {
  const lignes = useMemo(() => colorer(texte, langage), [texte, langage]);
  const largeur = `${String(lignes.length).length + 1}ch`;
  return (
    <div data-vue="source" data-langage={langage ?? ""} className="klyra-mono py-2 text-body-s leading-[1.6]">
      {lignes.map((ligne, i) => (
        <div key={i} className="flex">
          <span aria-hidden="true" style={{ width: largeur }} className="shrink-0 pr-2 pl-2 text-right text-texte-secondaire select-none box-content">
            {i + 1}
          </span>
          <span data-ligne={i + 1} className="min-h-[1.6em] min-w-0 flex-1 pr-4 whitespace-pre-wrap text-texte-principal [overflow-wrap:anywhere] select-text">
            {ligne.map((m, k) =>
              m.jeton ? (
                <span key={k} data-jeton={m.jeton} className={COULEURS[m.jeton]}>
                  {m.texte}
                </span>
              ) : (
                m.texte
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
