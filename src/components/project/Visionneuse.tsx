"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { getBridge, type ContenuFichier } from "@/lib/bridge";
import type { Project } from "@/types/domain";

/** Ce qu'on demande quand on clique un fichier : le projet et son chemin relatif. */
export interface DemandeFichier {
  projectId: string;
  chemin: string;
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

/**
 * La visionneuse d'un fichier du projet, comme l'aperçu de VS Code : l'image
 * sur un fond neutre, ou le texte avec ses numéros de ligne. Échap ferme.
 */
export function Visionneuse({ project, chemin, onFermer }: { project: Project; chemin: string; onFermer: () => void }) {
  const bridge = getBridge();
  const [contenu, setContenu] = useState<ContenuFichier | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const nom = chemin.split("/").pop() ?? chemin;

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

  const lignes = contenu?.type === "texte" ? contenu.texte.split("\n") : [];

  return (
    <div role="dialog" aria-label={nom} className="absolute inset-0 z-40 flex flex-col bg-fond-surface">
      <header className="flex items-center gap-3 border-b border-bordure-subtile px-4 py-3">
        <Icon name={contenu?.type === "image" ? "image-01" : "file-code"} size={20} className="shrink-0 text-icone-secondaire" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-semibold text-texte-principal">{nom}</span>
          <span className="klyra-mono truncate text-ui-2xs text-texte-tertiaire">
            {chemin}
            {contenu ? ` · ${taille(contenu.taille)}` : ""}
            {dimensions ? ` · ${dimensions}` : ""}
            {contenu?.type === "texte" ? ` · ${lignes.length} lignes` : ""}
          </span>
        </div>
        {bridge && (
          <>
            <Bouton variant="blanc" taille="compact" onClick={() => void bridge.projets.ouvrirFichier(project.folder, chemin)}>
              Ouvrir avec l’app par défaut
            </Bouton>
            <BoutonIcone
              taille="compact"
              icone={<Icon name="folder-open-01" size={16} />}
              libelle="Montrer dans le Finder"
              onClick={() => void bridge.projets.montrerFichier(project.folder, chemin)}
            />
          </>
        )}
        <BoutonIcone taille="compact" icone={<Icon name="x-01" size={16} />} libelle="Fermer (Échap)" onClick={onFermer} />
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {!bridge && <p className="m-0 p-6 text-ui-s text-texte-secondaire">La visionneuse marche dans l’app de bureau.</p>}
        {erreur && (
          <p role="alert" className="m-0 p-6 text-ui-s text-texte-erreur">
            {erreur}
          </p>
        )}
        {bridge && !contenu && !erreur && <p className="m-0 p-6 text-ui-s text-texte-tertiaire">Lecture…</p>}

        {contenu?.type === "image" && (
          /* Damier discret derrière l'image, pour voir la transparence. */
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
        )}

        {contenu?.type === "texte" && (
          <table className="klyra-mono w-full border-collapse text-ui-xs leading-[1.6]">
            <tbody>
              {lignes.map((ligne, i) => (
                <tr key={i}>
                  <td className="w-12 pr-3 pl-4 text-right align-top text-texte-tertiaire select-none">{i + 1}</td>
                  <td className="pr-4 whitespace-pre-wrap text-texte-principal [overflow-wrap:anywhere]">{ligne || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
