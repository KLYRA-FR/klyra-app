"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "klyra-ui";
import type { IconName } from "@/components/icons/Icon";
import { SECTIONS, type IdSection } from "@/components/reglages/catalogue";
import { ancreReglage } from "@/components/reglages/ui";
import { TEINTES } from "@/components/team/AgentVisuel";
import { cn } from "@/lib/cn";
import type { LecturePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { etatLigne, iconeLigne, initialesDe, titreCourt } from "@/lib/telephone/reglages";
import { ROLE_TEINTES, type RoleTeinte } from "@/types/domain";
import { Etiquette, GroupeListe, LigneListe, TuileIcone } from "./Liste";
import { useSupport } from "./poste";

/** Le contenu d'une section : colonne, marges de 16, 20 px entre les blocs. */
export function Pile({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-5 px-4 pt-2", className)}>{children}</div>;
}

/** Une ligne « Sur ton Mac » (P-8) : son nom, l'étiquette, sa raison en ligne 2. */
export function LigneSurPoste({ id, nom, icone, raison }: { id?: string; nom: string; icone: IconName; raison: string }) {
  const sur = useSupport();
  return <LigneListe id={id} debut={<TuileIcone icone={icone} />} retrait="tuile" nom={nom} etiquette={<Etiquette>{`Sur ${sur}`}</Etiquette>} ligne2={majuscule(raison)} />;
}

/** Les lignes d'une section qui restent sur l'ordinateur (P-8), chacune avec sa raison. */
export function LignesSurPoste({ section, seulement }: { section: IdSection; seulement?: string[] }) {
  const s = SECTIONS.find((x) => x.id === section)!;
  const entrees = s.entrees.filter((e) => etatLigne(e.id).type === "ordinateur" && (!seulement || seulement.includes(e.id)));
  if (!entrees.length) return null;
  return (
    <GroupeListe>
      {entrees.map((e) => {
        const etat = etatLigne(e.id);
        return <LigneSurPoste key={e.id} id={ancreReglage(e.id)} nom={titreCourt(e.titre)} icone={iconeLigne(e.id, s.icone)} raison={etat.type === "ordinateur" ? etat.raison : ""} />;
      })}
    </GroupeListe>
  );
}

/** Un succès sur place, 3 s (lot 8 § 4) : il ne s'affiche qu'après le résultat de la source. */
export function useSucces(): [string | null, (texte: string) => void] {
  const [texte, setTexte] = useState<string | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (minuteur.current && clearTimeout(minuteur.current)), []);
  const montrer = useCallback((t: string) => {
    if (minuteur.current) clearTimeout(minuteur.current);
    setTexte(t);
    minuteur.current = setTimeout(() => setTexte(null), 3000);
  }, []);
  return [texte, montrer];
}

/**
 * Une lecture qu'on relit après un geste : la dernière valeur lue reste affichée pendant la relecture,
 * la coche ne repart pas de rien. Une erreur, un ordinateur fermé ou aucun ordinateur restent dits.
 */
export function useLectureStable<T>(lecture: LecturePoste<T> & { relancer: () => void }): LecturePoste<T> & { relancer: () => void } {
  const [dernier, setDernier] = useState<{ data: T } | null>(null);
  if (lecture.etat === "ok" && lecture.data !== dernier?.data) setDernier({ data: lecture.data });
  if (lecture.etat === "attente" && dernier) return { etat: "ok", data: dernier.data, relancer: lecture.relancer };
  return lecture;
}

const teinteDe = (couleur: string): RoleTeinte => ((ROLE_TEINTES as string[]).includes(couleur) ? (couleur as RoleTeinte) : "bleu-k1");

/** Une personne : l'`Avatar` de klyra-ui, ses initiales sur sa couleur d'équipe. */
export function RondPersonne({ nom, couleur, taille = 40 }: { nom: string; couleur?: string; taille?: number }) {
  const fond = couleur ? TEINTES[teinteDe(couleur)] : "var(--color-fond-surface-grise)";
  return (
    <Avatar
      shape="circle"
      size="lg"
      initials={initialesDe(nom)}
      alt=""
      gradient={false}
      aria-hidden="true"
      className="bg-[var(--fond-personne)]! text-texte-principal!"
      style={{ width: taille, height: taille, fontSize: taille > 40 ? 15 : 13, "--fond-personne": fond } as React.CSSProperties}
    />
  );
}
