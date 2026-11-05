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
import { cn } from "@/lib/cn";
import { ancreDe, cibleLien } from "@/lib/apercu/liens";
import { lireMarkdown } from "@/lib/apercu/markdown";
import { indenterJson, renduDe } from "@/lib/apercu/texte";
import { nomFichier } from "@/lib/fichiers";
import { useGestePoste, useLecturePoste } from "@/lib/poste/client";
import { texteErreurPoste } from "@/lib/poste-texte";
import { dossierAffiche, iconeElement, montrerDans, ouvrableADistance, parentDe, tailleLisible, urlFermerFichier, urlFichier, urlRetourFichier, type FichierLu } from "@/lib/telephone/dossiers";
import { rangDansLApp } from "@/lib/telephone/retour";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { ONGLETS_TELEPHONE } from "./CommunAgentsTelephone";
import { MenuFeuille, type ActionMenu } from "./Feuille";
import { BandeauVueGardee, EtatEcran, useGestePossible, VueLecture } from "./etats";
import { Etiquette, TuileIcone } from "./Liste";
import { PagePleine } from "./PagePleine";
import { usePostes, useSupport } from "./poste";
import { useRetour } from "./retour";

/**
 * E6-22 à E6-32 : un fichier du projet en page pleine, sans barre d'onglets. Le poste lit et met en
 * forme, le téléphone affiche avec les rendus du bureau, recomposés pour une colonne. Rien dans le
 * compte (M-7) ; la dernière lecture peut rester sur ce téléphone (moins de 1 Mo), « Vue à HH:MM ».
 */

/** Une image de 15 Mo passe par le stockage du compte, à l'aller puis au retour : plus que le délai de P-10. */
const DELAI_LECTURE_MS = 45_000;
/** Les fichiers ouverts par des liens qu'on garde pour « Revenir à ». */
const PILE_MAX = 20;
/** La préférence « Couper les lignes longues » : locale à ce téléphone (E6-32). */
const CLE_COUPER = "klyra:telephone:couper-lignes";

/**
 * Les rendus du bureau (Markdown, Word, tableaux, source) recomposés pour le téléphone : marges de
 * 16 px, titres aux tailles du téléphone (h1 24, h2 18, h3 16), corps en 16, texte de 12 px au moins,
 * pas de gris tertiaire pour du texte, onglets des feuilles à 44 px.
 */
const RECOMPOSITION = [
  "[&_article]:px-4 [&_article]:pt-4 [&_article]:pb-10",
  "[&_article_h1]:mt-1 [&_article_h1]:text-h4 [&_article_h2]:mt-[22px] [&_article_h2]:text-body [&_article_h3]:text-body-s [&_article_p.text-h2]:text-h4",
  "[&_.text-ui-2xs]:text-ui-xs [&_.text-ui-3xs]:text-ui-xs [&_.text-texte-tertiaire]:text-texte-secondaire",
  "[&_[data-vue=source]]:text-ui [&_[role=tab]]:min-h-11",
].join(" ");

function lirePreference(): boolean {
  try {
    return localStorage.getItem(CLE_COUPER) !== "0";
  } catch {
    return true;
  }
}

/** Le texte d'un fichier sans aperçu, sous la phrase du bureau (E6-27, E6-28). */
function detailSansApercu(chemin: string, raison: string): string | null {
  if (/trop lourd/i.test(raison)) return "Au-delà de 1,5 Mo de texte (15 Mo pour une image), il ne passe pas par le téléphone.";
  if (/\.pdf$/i.test(chemin)) return "Un PDF se lit sur l’ordinateur.";
  return null;
}

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
  const annoncer = useAnnonce();
  const enLigne = !useHorsLigne();
  const { principal } = usePostes();
  const { possible, raison } = useGestePossible();
  const lecture = useLecturePoste<FichierLu>("fichiers.lire", projetId ? { projetId, chemin } : null, { delai: DELAI_LECTURE_MS, horsLigne: !enLigne });
  const { faire, occupe } = useGestePoste();
  const [vue, setVue] = useState<"apercu" | "source">("apercu");
  const [couper, setCouper] = useState(lirePreference);
  const [menu, setMenu] = useState(false);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const corps = useRef<HTMLDivElement>(null);
  const nom = nomFichier(chemin);
  const rendu = renduDe(chemin);
  const langage = langageDe(chemin);
  /* Pile des liens suivis : « Revenir à » remonte d'un document, ✕ retourne au dossier. */
  const precedent = retour.at(-1) ?? null;
  const revenir = useRetour(urlRetourFichier(projetId, chemin, retour));
  const fermer = () => {
    const pas = retour.length + 1;
    if (rangDansLApp(window.history.state) >= pas) window.history.go(-pas);
    else router.replace(urlFermerFichier(projetId, chemin, retour));
  };

  const changerCouper = () => {
    const suivant = !couper;
    setCouper(suivant);
    try {
      localStorage.setItem(CLE_COUPER, suivant ? "1" : "0");
    } catch {
      /* sans stockage, la préférence vaut pour cet écran */
    }
  };

  /* La lecture du moment, ou la dernière lue sur ce téléphone si l'ordinateur est fermé (E6-30). */
  const gardee = lecture.etat === "ferme" ? lecture.gardee : null;
  const lu = lecture.etat === "ok" ? lecture.data : (gardee?.data ?? null);
  const contenu = lu?.contenu ?? null;
  const texte = contenu?.type === "texte" ? contenu.texte : null;
  const markdown = useMemo(() => (texte !== null && rendu === "markdown" ? lireMarkdown(texte) : null), [texte, rendu]);
  const jsonIndente = useMemo(() => (texte !== null && rendu === "json" ? indenterJson(texte) : null), [texte, rendu]);
  /** Une vue mise en forme existe : le choix Aperçu / Source s'affiche (comme au bureau). */
  const formate = texte !== null && (rendu === "markdown" || rendu === "tableau" || jsonIndente !== null);
  const source = texte !== null && (!formate || vue === "source" || (rendu === "json" && jsonIndente !== null));
  const texteSource = rendu === "json" && jsonIndente !== null && vue === "apercu" ? jsonIndente : (texte ?? "");
  /* Ce qui est affiché : un JSON minifié compte ses lignes mises en forme. */
  const lignes = useMemo(() => (texte === null ? 0 : (formate && vue === "apercu" && rendu === "json" ? texteSource : texte).split("\n").length), [texte, formate, vue, rendu, texteSource]);
  const attente = lecture.etat === "attente";
  const segments = formate || (attente && (rendu === "markdown" || rendu === "tableau" || rendu === "json"));

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

  /** Web et e-mail : le navigateur ou la messagerie du téléphone. Chemin relatif : ce fichier, ici. */
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
    if (r.ok) annoncer({ texte: `Ouvert sur ${sur}`, icone: "check-01" });
    else annoncer({ texte: texteErreurPoste(r, sur), erreur: true });
  };
  /* Un fichier d'un VPS n'est pas sur l'ordinateur : rien à y ouvrir (comme au bureau). Un programme ne s'ouvre pas à distance. */
  const ouvrable = lu?.surPoste !== false;
  const aDistance = ouvrableADistance(chemin);
  const noteOuvrir = !aDistance ? "Ce type de fichier ne s’ouvre que devant l’ordinateur." : raison;
  const surPoste = <Etiquette>{`Sur ${sur}`}</Etiquette>;

  const actions: ActionMenu[] = [
    ...(ouvrable ? [{ libelle: `Ouvrir sur ${sur}`, icone: "link-external" as const, onChoisir: () => void ouvrirSurPoste(), desactivee: !aDistance || !possible || occupe, note: noteOuvrir }] : []),
    ...(ouvrable
      ? [{ libelle: montrerDans(principal?.systeme ?? null), icone: "folder-open-01" as const, onChoisir: () => undefined, desactivee: true, note: "S’ouvre sur l’écran de l’ordinateur.", fin: surPoste }]
      : []),
    ...(source ? [{ libelle: "Couper les lignes longues", icone: "align-left" as const, onChoisir: changerCouper, interrupteur: couper, separateurAvant: true }] : []),
  ];

  const parent = parentDe(chemin);
  const details = [
    dossierAffiche(nomProjet, chemin),
    contenu && tailleLisible(contenu.taille),
    dimensions,
    texte !== null && `${lignes} ligne${lignes > 1 ? "s" : ""}`,
    contenu?.type === "classeur" && contenu.feuilles.length > 1 && `${contenu.feuilles.length} feuilles`,
  ].filter(Boolean);
  const sousMenu = [parent ? `Dans ${nomFichier(parent)}` : `Dans ${nomProjet}`, contenu ? tailleLisible(contenu.taille) : null].filter(Boolean).join(" · ");

  return (
    <PagePleine
      titre={nom}
      onFermer={fermer}
      libre
      droite={<BoutonIcone variant="discret" className="size-11" libelle="Actions du fichier" aria-haspopup="dialog" onClick={() => setMenu(true)} icone={<Icon name="dot-horizontal" size={24} />} />}
    >
      <div className="relative z-[1] flex shrink-0 flex-col gap-2 bg-fond-page px-4 pb-2.5 shadow-[inset_0_-1px_0_var(--color-bordure-defaut)]">
        {precedent ? (
          <Bouton variant="gris" taille="compact" className="relative self-start after:absolute after:-inset-x-0.5 after:-inset-y-1.5" iconeGauche={<Icon name="chevron-left" size={20} />} onClick={revenir}>
            Revenir à {nomFichier(precedent)}
          </Bouton>
        ) : null}
        <p className="truncate text-ui-xs text-texte-secondaire [font-variant-numeric:tabular-nums]">{details.join(" · ")}</p>
        {segments ? (
          <Onglets
            libelle="Affichage du fichier"
            onglets={[
              { id: "apercu", label: "Aperçu" },
              { id: "source", label: "Source" },
            ]}
            valeur={vue}
            onChange={setVue}
            className={cn(ONGLETS_TELEPHONE, "[&>[role=tab][aria-selected=true]]:font-semibold")}
          />
        ) : null}
        {gardee ? <BandeauVueGardee lu={gardee.lu} /> : null}
      </div>

      <div ref={corps} className={`flex min-h-0 flex-1 flex-col bg-fond-surface pb-[env(safe-area-inset-bottom)] ${RECOMPOSITION}`}>
        {contenu ? (
          <>
            {contenu.type === "image" ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex min-h-full items-center justify-center bg-fond-surface-grise p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- image du projet, reçue en data URL */}
                  <img
                    src={contenu.dataUrl}
                    alt={dimensions ? `${nom}, ${dimensions}` : nom}
                    onLoad={(e) => setDimensions(`${e.currentTarget.naturalWidth.toLocaleString("fr-FR")} × ${e.currentTarget.naturalHeight.toLocaleString("fr-FR")} px`)}
                    className="h-auto max-w-full rounded-xs shadow-ombre-md"
                  />
                </div>
              </div>
            ) : null}

            {texte !== null &&
              (source ? (
                couper ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SourceCoupee texte={texteSource} langage={langage} />
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto">
                    <VueSource texte={texteSource} langage={langage} />
                  </div>
                )
              ) : markdown ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <DocumentMarkdown document={markdown} chemin={chemin} dossier="" suivre={suivreLien} />
                </div>
              ) : (
                <TableauTexte texte={texte} tsv={/\.tsv$/i.test(chemin)} />
              ))}

            {contenu.type === "classeur" ? <Classeur feuilles={contenu.feuilles} /> : null}

            {contenu.type === "document" ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <DocumentWord blocs={contenu.blocs} chemin={chemin} suivre={suivreLien} />
              </div>
            ) : null}

            {contenu.type === "autre" ? (
              <EtatEcran
                className="pt-8"
                icone="file-01"
                titre={contenu.raison.replace(/\.$/, "")}
                texte={detailSansApercu(chemin, contenu.raison)}
                action={
                  ouvrable ? (
                    <>
                      <Bouton variant="blanc" taille="md" disabled={!aDistance || !possible || occupe} iconeGauche={<Icon name="link-external" size={20} />} onClick={() => void ouvrirSurPoste()}>
                        Ouvrir sur {sur}
                      </Bouton>
                      {noteOuvrir ? <p className="text-ui-xs text-texte-secondaire">{noteOuvrir}</p> : null}
                    </>
                  ) : null
                }
              />
            ) : null}
          </>
        ) : attente ? (
          <SqueletteTexte lent={lecture.lent} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <VueLecture lecture={lecture} ferme={(s) => `ce fichier est sur ${s}. Il s’affiche ici quand KLYRA y est ouverte.`} sansRecours>
              {() => null}
            </VueLecture>
          </div>
        )}
      </div>
      {menu ? <MenuFeuille titre={nom} objet={{ visuel: <TuileIcone icone={iconeElement({ nom, type: "fichier" })} grande />, sous: sousMenu }} actions={actions} onFermer={() => setMenu(false)} /> : null}
    </PagePleine>
  );
}

/** E6-29 : rien pendant 300 ms, puis « Demande à ton Mac… » et des lignes de texte (45 s avant « ne répond pas »). */
function SqueletteTexte({ lent }: { lent: boolean }) {
  const sur = useSupport();
  if (!lent) return <div aria-busy="true" />;
  const barre = "block rounded-sm bg-fond-surface-grise motion-safe:animate-pulse";
  return (
    <div aria-busy="true" className="flex flex-col gap-2.5 px-4 py-5">
      <p className="flex items-center gap-2 pb-1.5 text-ui text-texte-secondaire">
        <Icon name="loader-01" size={16} className="shrink-0" />
        Demande à {sur}…
      </p>
      <span className={cn(barre, "h-5 w-[62%]")} />
      {["w-[96%]", "w-[90%]", "w-[74%]"].map((l) => (
        <span key={l} className={cn(barre, "h-3", l)} />
      ))}
      <span className={cn(barre, "mt-3 h-4 w-2/5")} />
      {["w-[94%]", "w-[82%]"].map((l) => (
        <span key={l} className={cn(barre, "h-3", l)} />
      ))}
    </div>
  );
}

/**
 * La source sur le téléphone : les lignes longues sont coupées (le numéro reste sur la première
 * ligne visuelle), la coloration est celle du bureau. Lecture seule, texte sélectionnable sans les numéros.
 */
function SourceCoupee({ texte, langage }: { texte: string; langage: Langage | null }) {
  const lignes = useMemo(() => colorer(texte, langage), [texte, langage]);
  const largeur = `${String(lignes.length).length}ch`;
  return (
    <div data-vue="source" data-langage={langage ?? ""} className="py-2.5 pb-6 text-ui leading-[1.6] [font-variant-numeric:tabular-nums]">
      {lignes.map((ligne, i) => (
        <div key={i} className="flex">
          <span aria-hidden="true" style={{ width: largeur }} className="box-content shrink-0 pr-2.5 pl-2 text-right text-texte-secondaire select-none">
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
