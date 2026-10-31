"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { ancreDe, cibleLien } from "@/lib/apercu/liens";
import { lireMarkdown } from "@/lib/apercu/markdown";
import { indenterJson, renduDe } from "@/lib/apercu/texte";
import { getBridge, type ContenuFichier } from "@/lib/bridge";
import { poste } from "@/lib/plateforme";
import { nomFichier } from "@/lib/fichiers";
import type { Project } from "@/types/domain";
import { DocumentMarkdown } from "./apercu/DocumentMarkdown";
import { DocumentWord } from "./apercu/DocumentWord";
import { Classeur, TableauTexte } from "./apercu/Grille";
import { VueSource } from "./apercu/VueSource";

/** Ce qu'on demande quand on clique un fichier : le projet et son chemin relatif. */
export interface DemandeFichier {
  projectId: string;
  chemin: string;
  /** Le titre à atteindre, pour un lien `fichier.md#titre`. */
  ancre?: string | null;
  /** Les fichiers ouverts avant celui-ci par des liens : le bouton retour y revient. */
  retour?: string[];
}

/** Clic sur un fichier d'un projet : la visionneuse s'ouvre (cf. AppShell). */
export function ouvrirFichier(demande: DemandeFichier) {
  window.dispatchEvent(new CustomEvent<DemandeFichier>("klyra:fichier", { detail: demande }));
}

function taille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

const SANS_RETOUR: string[] = [];

function Defilant({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto">{children}</div>;
}

/**
 * La visionneuse d'un fichier du projet. Un document se lit mis en forme
 * (Markdown, Word, CSV, Excel) ; le bouton « Source » rend la vue numérotée,
 * comme l'aperçu de VS Code, qui reste celle du code. Une image s'affiche sur
 * un fond neutre. Les liens d'un document ouvrent les fichiers du projet ici,
 * et les adresses web hors de l'app. Échap ferme.
 */
export function Visionneuse({
  project,
  chemin,
  ancre = null,
  retour = SANS_RETOUR,
  onFermer,
}: {
  project: Project;
  chemin: string;
  ancre?: string | null;
  retour?: string[];
  onFermer: () => void;
}) {
  const bridge = getBridge();
  const [contenu, setContenu] = useState<ContenuFichier | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [vue, setVue] = useState<"apercu" | "source">("apercu");
  const corps = useRef<HTMLDivElement>(null);
  const nom = nomFichier(chemin);
  const rendu = renduDe(chemin);

  useEffect(() => {
    if (!bridge) return;
    let actif = true;
    void bridge.projets.lireFichier(project.folder, chemin).then((r) => {
      if (!actif) return;
      if (r.ok) setContenu(r.data);
      else setErreur(r.message);
    });
    return () => {
      actif = false;
    };
  }, [bridge, project.folder, chemin]);

  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);

  const texte = contenu?.type === "texte" ? contenu.texte : null;
  const lignes = useMemo(() => (texte === null ? 0 : texte.split("\n").length), [texte]);
  const markdown = useMemo(() => (texte !== null && rendu === "markdown" ? lireMarkdown(texte) : null), [texte, rendu]);
  const jsonIndente = useMemo(() => (texte !== null && rendu === "json" ? indenterJson(texte) : null), [texte, rendu]);
  /** Une vue mise en forme existe : le choix Aperçu / Source s'affiche. */
  const formate = texte !== null && (rendu === "markdown" || rendu === "tableau" || jsonIndente !== null);

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

  const suivreLien = useCallback(
    (href: string) => {
      const cible = cibleLien(href, chemin);
      if (cible.type === "externe") window.open(cible.url, "_blank", "noreferrer");
      else if (cible.type === "ancre") defiler(cible.ancre);
      else if (cible.type === "fichier" && cible.chemin === chemin) defiler(cible.ancre);
      else if (cible.type === "fichier") ouvrirFichier({ projectId: project.id, chemin: cible.chemin, ancre: cible.ancre, retour: [...retour, chemin] });
    },
    [chemin, defiler, project.id, retour],
  );

  const precedent = retour[retour.length - 1];
  const details = [
    chemin,
    contenu && taille(contenu.taille),
    dimensions,
    texte !== null && `${lignes} lignes`,
    contenu?.type === "classeur" && contenu.feuilles.length > 1 && `${contenu.feuilles.length} feuilles`,
  ].filter(Boolean);

  return (
    <div role="dialog" aria-label={nom} className="absolute inset-0 z-40 flex flex-col bg-fond-surface">
      <header className="flex items-center gap-3 border-b border-bordure-subtile px-4 py-3">
        {precedent && (
          <BoutonIcone
            taille="compact"
            icone={<Icon name="chevron-left" size={16} />}
            libelle={`Revenir à ${nomFichier(precedent)}`}
            onClick={() => ouvrirFichier({ projectId: project.id, chemin: precedent, retour: retour.slice(0, -1) })}
          />
        )}
        <Icon
          name={contenu?.type === "image" ? "image-01" : contenu?.type === "texte" && (!formate || vue === "source") ? "file-code" : "file-01"}
          size={20}
          className="shrink-0 text-icone-secondaire"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-semibold text-texte-principal">{nom}</span>
          <span className="klyra-mono truncate text-ui-2xs text-texte-tertiaire">{details.join(" · ")}</span>
        </div>
        {formate && (
          <Onglets
            libelle="Affichage du fichier"
            onglets={[
              { id: "apercu", label: "Aperçu" },
              { id: "source", label: "Source" },
            ]}
            valeur={vue}
            onChange={setVue}
          />
        )}
        {bridge && (
          <>
            <Bouton variant="blanc" taille="compact" onClick={() => void bridge.projets.ouvrirFichier(project.folder, chemin)}>
              Ouvrir avec l’app par défaut
            </Bouton>
            <BoutonIcone
              taille="compact"
              icone={<Icon name="folder-open-01" size={16} />}
              libelle={`Montrer ${poste.dansExplorateur}`}
              onClick={() => void bridge.projets.montrerFichier(project.folder, chemin)}
            />
          </>
        )}
        <BoutonIcone taille="compact" icone={<Icon name="x-01" size={16} />} libelle="Fermer (Échap)" onClick={onFermer} />
      </header>

      <div ref={corps} className="flex min-h-0 flex-1 flex-col">
        {!bridge && <p className="m-0 p-6 text-ui-s text-texte-secondaire">La visionneuse marche dans l’app de bureau.</p>}
        {erreur && (
          <p role="alert" className="m-0 p-6 text-ui-s text-texte-erreur">
            {erreur}
          </p>
        )}
        {bridge && !contenu && !erreur && <p className="m-0 p-6 text-ui-s text-texte-tertiaire">Lecture…</p>}

        {contenu?.type === "image" && (
          <Defilant>
            {/* Damier discret derrière l'image, pour voir la transparence. */}
            <div
              className="flex min-h-full items-center justify-center p-8"
              style={{
                backgroundColor: "var(--color-fond-page)",
                backgroundImage:
                  "linear-gradient(45deg, var(--color-fond-surface-grise) 25%, transparent 25%), linear-gradient(-45deg, var(--color-fond-surface-grise) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-fond-surface-grise) 75%), linear-gradient(-45deg, transparent 75%, var(--color-fond-surface-grise) 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- image locale en data URL */}
              <img
                src={contenu.dataUrl}
                alt={nom}
                onLoad={(e) => setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)}
                className="max-h-full max-w-full object-contain shadow-ombre-xs"
              />
            </div>
          </Defilant>
        )}

        {texte !== null &&
          (!formate || vue === "source" ? (
            <Defilant>
              <VueSource texte={texte} />
            </Defilant>
          ) : markdown ? (
            <Defilant>
              <DocumentMarkdown document={markdown} chemin={chemin} dossier={project.folder} suivre={suivreLien} />
            </Defilant>
          ) : rendu === "tableau" ? (
            <TableauTexte texte={texte} tsv={/\.tsv$/i.test(chemin)} />
          ) : (
            <Defilant>
              <VueSource texte={jsonIndente ?? texte} />
            </Defilant>
          ))}

        {contenu?.type === "classeur" && <Classeur feuilles={contenu.feuilles} />}

        {contenu?.type === "document" && (
          <Defilant>
            <DocumentWord blocs={contenu.blocs} chemin={chemin} suivre={suivreLien} />
          </Defilant>
        )}

        {contenu?.type === "autre" && (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="text-ui-s text-texte-secondaire">{contenu.raison}</span>
            {bridge && (
              <Bouton variant="sombre" taille="compact" onClick={() => void bridge.projets.ouvrirFichier(project.folder, chemin)}>
                Ouvrir avec l’app par défaut
              </Bouton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
