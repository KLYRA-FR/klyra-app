"use client";

import { useMemo, useState } from "react";
import { Onglets } from "@/components/ui/Onglets";
import { aUnEntete, estNombre, lireCsv, LIGNES_TABLEAU_MAX } from "@/lib/apercu/texte";
import type { CelluleClasseur, FeuilleClasseur } from "@/lib/bridge";
import { cn } from "@/lib/cn";

/** 0 → A, 25 → Z, 26 → AA : les colonnes d'un tableur. */
function lettre(n: number): string {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

/** Au-delà de ce nombre de caractères, une colonne passe à la ligne. */
const TEXTE_LONG = 40;

const NUMERO_LIGNE = "klyra-mono sticky left-0 z-10 border-r border-b border-bordure-subtile bg-fond-page px-2 py-1.5 text-right align-top text-ui-2xs leading-[1.7] font-normal text-texte-tertiaire select-none";
const EN_TETE = "sticky top-0 z-20 border-r border-b bg-fond-page";

/**
 * Une grille de tableur : numéros de ligne figés à gauche, en-tête figé en haut
 * (lettres A, B, C… pour un classeur, ou la première ligne d'un CSV qui en est
 * une). Les nombres s'alignent à droite, en chiffres de même largeur.
 */
function Grille({ lignes, colonnes, entete, lettres }: { lignes: (CelluleClasseur | null)[][]; colonnes: number; entete: CelluleClasseur[] | null; lettres: boolean }) {
  // Seules les colonnes de phrases longues passent à la ligne ; identifiants, dates, chemins et adresses restent sur une ligne.
  const longues = useMemo(
    () => Array.from({ length: colonnes }, (_, c) => lignes.some((l) => (l[c]?.texte.length ?? 0) > TEXTE_LONG && /\s/.test(l[c]?.texte ?? ""))),
    [lignes, colonnes],
  );
  return (
    <table data-grille="" className="min-w-full border-separate border-spacing-0 text-ui-s leading-[1.45]">
      {(lettres || entete) && (
        <thead>
          <tr>
            <th aria-hidden="true" className={cn(EN_TETE, "left-0 z-30 w-12 min-w-12 border-bordure-subtile")} />
            {Array.from({ length: colonnes }, (_, c) =>
              entete ? (
                <th
                  key={c}
                  scope="col"
                  className={cn(EN_TETE, "border-bordure-defaut px-3 py-2 font-semibold whitespace-nowrap text-texte-principal", entete[c]?.nombre ? "text-right" : "text-left")}
                >
                  {entete[c]?.texte}
                </th>
              ) : (
                <th key={c} scope="col" className={cn(EN_TETE, "klyra-mono border-bordure-subtile px-3 py-1 text-center text-ui-2xs font-medium text-texte-tertiaire")}>
                  {lettre(c)}
                </th>
              ),
            )}
          </tr>
        </thead>
      )}
      <tbody>
        {lignes.map((ligne, r) => (
          <tr key={r} className="hover:bg-fond-survol">
            <th scope="row" className={NUMERO_LIGNE}>
              {r + 1}
            </th>
            {Array.from({ length: colonnes }, (_, c) => {
              const cellule = ligne[c];
              return (
                <td
                  key={c}
                  className={cn(
                    "border-r border-b border-bordure-subtile px-3 py-1.5 align-top text-texte-principal",
                    cellule?.nombre ? "klyra-mono text-right whitespace-nowrap" : longues[c] ? "w-72 min-w-72 whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-nowrap",
                  )}
                >
                  {cellule?.texte}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Limite({ children }: { children: string }) {
  return <span className="text-ui-xs text-texte-tertiaire">{children}</span>;
}

/** Un classeur Excel : une grille par feuille, des onglets pour passer de l'une à l'autre. */
export function Classeur({ feuilles }: { feuilles: FeuilleClasseur[] }) {
  const [rang, setRang] = useState(0);
  const feuille = feuilles[rang] ?? feuilles[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(feuilles.length > 1 || feuille.tronquee) && (
        <div className="flex shrink-0 items-center gap-3 border-b border-bordure-subtile px-4 py-2">
          {feuilles.length > 1 && (
            <div className="min-w-0 overflow-x-auto">
              <Onglets
                libelle="Feuilles du classeur"
                onglets={feuilles.map((f, i) => ({ id: String(i), label: f.nom }))}
                valeur={String(rang)}
                onChange={(id) => setRang(Number(id))}
              />
            </div>
          )}
          {feuille.tronquee && <Limite>Aperçu limité au début de la feuille : ouvre le fichier pour tout voir.</Limite>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {feuille.colonnes > 0 ? (
          <Grille key={rang} lignes={feuille.lignes} colonnes={feuille.colonnes} entete={null} lettres />
        ) : (
          <p className="m-0 p-6 text-ui-s text-texte-tertiaire">Cette feuille est vide.</p>
        )}
      </div>
    </div>
  );
}

/** Un CSV ou un TSV en tableau ; sa première ligne devient l'en-tête si elle en est un. */
export function TableauTexte({ texte, tsv }: { texte: string; tsv: boolean }) {
  const { lignes, colonnes, entete, tronque } = useMemo(() => {
    const brutes = lireCsv(texte, tsv);
    const avecEntete = aUnEntete(brutes);
    const cellules = brutes.map((l) => l.map((v): CelluleClasseur | null => (v === "" ? null : estNombre(v) ? { texte: v, nombre: true } : { texte: v })));
    const corps = avecEntete ? cellules.slice(1) : cellules;
    // Une colonne de nombres : son en-tête s'aligne à droite, au-dessus des chiffres.
    const chiffree = (c: number) => corps.some((l) => l[c]) && corps.every((l) => !l[c] || l[c]?.nombre);
    return {
      lignes: corps.slice(0, LIGNES_TABLEAU_MAX),
      colonnes: brutes.reduce((max, l) => Math.max(max, l.length), 0),
      entete: avecEntete ? brutes[0].map((texte, c): CelluleClasseur => (chiffree(c) ? { texte, nombre: true } : { texte })) : null,
      tronque: corps.length > LIGNES_TABLEAU_MAX,
    };
  }, [texte, tsv]);

  if (!colonnes) return <p className="m-0 p-6 text-ui-s text-texte-tertiaire">Ce fichier est vide.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tronque && (
        <div className="shrink-0 border-b border-bordure-subtile px-4 py-2">
          <Limite>{`Aperçu limité aux ${LIGNES_TABLEAU_MAX.toLocaleString("fr-FR")} premières lignes : la vue Source montre tout.`}</Limite>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <Grille lignes={lignes} colonnes={colonnes} entete={entete} lettres={false} />
      </div>
    </div>
  );
}
