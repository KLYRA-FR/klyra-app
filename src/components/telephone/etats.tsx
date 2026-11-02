"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bouton } from "@/components/ui/Bouton";
import type { LecturePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { useSupport } from "./poste";

/**
 * Les états d'un écran qui lit l'ordinateur (spec mobile § 2 et § 5) : P-6 fermé, P-7 sous un bouton
 * désactivé, P-8 « Sur ton Mac », P-9 demande en cours, P-10 sans réponse. Les mots du poste viennent
 * de `useSupport` (« ton Mac », « ton PC », le nom du poste), jamais écrits en dur.
 */

/** P-6. `phrase` reçoit « ton Mac » : « les fichiers de ce projet sont sur ton Mac. Ils s'affichent quand KLYRA y est ouverte. » */
export function PosteFerme({ phrase }: { phrase: (sur: string) => string }) {
  const sur = useSupport();
  return (
    <div className="px-4 pt-8">
      <h2 className="text-body-s font-medium text-texte-principal">{majuscule(sur)} est fermé</h2>
      <p className="mt-2 text-ui text-texte-secondaire">
        {majuscule(phrase(sur))}
      </p>
    </div>
  );
}

/** P-7, sous un bouton désactivé. */
export function NotePoste({ className }: { className?: string }) {
  const sur = useSupport();
  return <p className={className ?? "mt-1 text-ui-xs text-texte-secondaire"}>Possible quand {sur} est ouvert</p>;
}

/** P-8 : un geste gardé sur l'ordinateur (spec § 7), avec sa raison. */
export function SurLePoste({ titre, raison }: { titre?: string; raison: string }) {
  const sur = useSupport();
  return (
    <div className="py-3">
      {titre ? <p className="text-body-s text-texte-principal">{titre}</p> : null}
      <p className="mt-0.5 text-ui-xs text-texte-secondaire">
        <span className="font-medium text-texte-principal">Sur {sur}</span> : {raison}
      </p>
    </div>
  );
}

/** P-9 : squelette aux formes des lignes, seulement après 300 ms (déjà compté par `useLecturePoste`). */
export function DemandeEnCours({ lent, lignes = 4 }: { lent: boolean; lignes?: number }) {
  const sur = useSupport();
  return (
    <div className="px-4 pt-4" aria-busy="true">
      <p className="text-ui text-texte-secondaire">Demande à {sur}…</p>
      {lent ? (
        <ul className="mt-3 flex flex-col gap-2">
          {Array.from({ length: lignes }, (_, i) => (
            <li key={i} className="h-12 rounded-md bg-fond-surface-grise motion-safe:animate-pulse" />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** P-10. */
export function PasDeReponse({ relancer }: { relancer: () => void }) {
  const sur = useSupport();
  return (
    <div className="px-4 pt-8" role="alert">
      <p className="text-body-s text-texte-principal">{majuscule(sur)} ne répond pas.</p>
      <Bouton variant="blanc" taille="md" className="mt-3" onClick={relancer}>
        Réessayer
      </Bouton>
    </div>
  );
}

export function ErreurPoste({ message, relancer }: { message: string; relancer?: () => void }) {
  return (
    <div className="px-4 pt-8" role="alert">
      <p className="text-body-s text-texte-principal">{message || "Le geste a échoué sur l’ordinateur."}</p>
      {relancer ? (
        <Bouton variant="blanc" taille="md" className="mt-3" onClick={relancer}>
          Réessayer
        </Bouton>
      ) : null}
    </div>
  );
}

/**
 * Les cinq états d'une lecture sur l'ordinateur, en un composant : fermé, en cours, sans réponse,
 * erreur, et le contenu.
 */
export function VueLecture<T>({
  lecture,
  ferme,
  lignes,
  children,
}: {
  lecture: LecturePoste<T> & { relancer: () => void };
  ferme: (sur: string) => string;
  lignes?: number;
  children: (data: T) => ReactNode;
}) {
  if (lecture.etat === "ferme") return <PosteFerme phrase={ferme} />;
  if (lecture.etat === "attente") return <DemandeEnCours lent={lecture.lent} lignes={lignes} />;
  if (lecture.etat === "delai") return <PasDeReponse relancer={lecture.relancer} />;
  if (lecture.etat === "erreur") return <ErreurPoste message={lecture.message} relancer={lecture.relancer} />;
  return <>{children(lecture.data)}</>;
}

/** Bandeau bas éphémère (« Enregistré », « Workflow lancé »), au-dessus de la barre du bas. */
export function useBandeau(): [ReactNode, (texte: string) => void] {
  const [texte, setTexte] = useState<string | null>(null);
  useEffect(() => {
    if (!texte) return;
    const minuteur = setTimeout(() => setTexte(null), 3000);
    return () => clearTimeout(minuteur);
  }, [texte]);
  const bandeau = texte ? (
    <p
      role="status"
      className="fixed inset-x-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 rounded-md bg-texte-principal px-4 py-3 text-ui text-texte-inverse shadow-ombre-flottante"
    >
      {texte}
    </p>
  ) : null;
  return [bandeau, setTexte];
}
