"use client";

import { Fragment } from "react";
import type { BlocDocument, MorceauDocument } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { LienDocument, type SuivreLien } from "./LienDocument";
import { NUMERO, PAGE, PUCE, TABLEAU, TITRE_BASE, TITRES } from "./styles";

/** Le retrait d'un élément de liste selon son niveau dans Word. */
const RETRAITS = ["", "pl-6", "pl-12", "pl-18", "pl-24", "pl-30", "pl-36"];

/**
 * Le texte d'un document Word, lu sans sa mise en page : titres, paragraphes,
 * listes, tableaux, gras, italique et liens externes. Les polices, marges et
 * images de Word ne sont pas reproduites.
 */
export function DocumentWord({ blocs, chemin, suivre }: { blocs: BlocDocument[]; chemin: string; suivre: SuivreLien }) {
  if (!blocs.length) return <p className="m-0 p-6 text-ui-s text-texte-tertiaire">Ce document n’a pas de texte à montrer.</p>;
  return (
    <article data-vue="apercu" className={PAGE}>
      {blocs.map((bloc, i) => {
        switch (bloc.type) {
          case "titre": {
            const Balise = `h${Math.min(6, Math.max(1, bloc.niveau))}` as "h1";
            return (
              <Balise key={i} className={cn(TITRE_BASE, TITRES[Math.min(5, Math.max(0, bloc.niveau - 1))])}>
                <Morceaux morceaux={bloc.morceaux} chemin={chemin} suivre={suivre} />
              </Balise>
            );
          }
          case "paragraphe":
            return (
              <p
                key={i}
                className={cn(
                  "m-0 whitespace-pre-wrap [overflow-wrap:anywhere]",
                  bloc.style === "titre" && "text-h2 leading-[1.1] font-semibold tracking-[-0.04em]",
                  bloc.style === "sous-titre" && "-mt-2 text-body text-texte-secondaire",
                  bloc.style === "citation" && "border-l-2 border-bordure-forte pl-4 text-texte-secondaire",
                )}
              >
                <Morceaux morceaux={bloc.morceaux} chemin={chemin} suivre={suivre} />
              </p>
            );
          case "liste":
            return (
              <div key={i} className={cn("-mt-2.5 flex gap-3", RETRAITS[Math.min(RETRAITS.length - 1, bloc.niveau)])}>
                {bloc.marque === null ? (
                  <span aria-hidden="true" className={PUCE} />
                ) : (
                  <span aria-hidden="true" className={NUMERO}>
                    {bloc.marque}
                  </span>
                )}
                <p className="m-0 min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <Morceaux morceaux={bloc.morceaux} chemin={chemin} suivre={suivre} />
                </p>
              </div>
            );
          case "tableau":
            return (
              <div key={i} className={TABLEAU.cadre}>
                <table className={TABLEAU.table}>
                  <tbody>
                    {bloc.lignes.map((ligne, r) => (
                      <tr key={r} className={cn(TABLEAU.rangee, r === 0 && "bg-fond-page font-semibold")}>
                        {ligne.map((cellule, c) => (
                          <td key={c} colSpan={cellule.etendue} className={cn(TABLEAU.cellule, "whitespace-pre-wrap")}>
                            <Morceaux morceaux={cellule.morceaux} chemin={chemin} suivre={suivre} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </article>
  );
}

function Morceaux({ morceaux, chemin, suivre }: { morceaux: MorceauDocument[]; chemin: string; suivre: SuivreLien }) {
  return morceaux.map((m, i) => {
    const style = cn(m.gras && "font-semibold", m.italique && "italic", m.souligne && "underline underline-offset-2", m.barre && "line-through");
    const texte = style ? <span className={style}>{m.texte}</span> : <Fragment>{m.texte}</Fragment>;
    return m.lien ? (
      <LienDocument key={i} href={m.lien} chemin={chemin} suivre={suivre}>
        {texte}
      </LienDocument>
    ) : (
      <Fragment key={i}>{texte}</Fragment>
    );
  });
}
