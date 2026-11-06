"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { ElementContextuel, MenuContextuel, SeparateurContextuel, type MenuOuvert } from "@/components/ui/MenuContextuel";
import { getBridge } from "@/lib/bridge";
import { tailleLisible } from "@/lib/fichiers";
import { poste } from "@/lib/plateforme";
import { lieuDuRendu } from "@/lib/rendus-espace";
import { nomDuFichier } from "@/lib/rendus";
import type { Rendu } from "@/types/domain";

/**
 * Le clic droit sur un fichier de l'onglet Fichiers du panneau : Télécharger (un livrable, de ce PC ou du VPS,
 * copié dans Téléchargements par le main, en flux), Ouvrir, Afficher dans le dossier, Copier le chemin.
 * Le suivi des téléchargements s'affiche sous la liste des livrables.
 */

type Suivi =
  | { etat: "en-cours"; nom: string; recu: number; total: number }
  | { etat: "fait"; nom: string; chemin: string }
  | { etat: "erreur"; nom: string; message: string };

/** Le chemin d'un livrable du VPS, sur le serveur (`https://hôte#/chemin`). */
const cheminSurLeVps = (origine: string) => origine.slice(origine.indexOf("#") + 1);

export function ouvrirLivrable(r: Rendu): void {
  const bridge = getBridge();
  if (!bridge) return;
  if (r.chemin) {
    void bridge.rendus.ouvrir(r.chemin);
    return;
  }
  const lieu = lieuDuRendu(r.origine);
  if (r.distantId && lieu && bridge.rendus.ouvrirVps) void bridge.rendus.ouvrirVps(lieu, r.distantId, r.roleId, nomDuFichier(r.origine), r.dossier === true);
}

/** Les téléchargements lancés depuis ce panneau, par livrable. */
export function useTelechargements() {
  const [suivis, setSuivis] = useState<Record<string, Suivi>>({});
  const bridge = getBridge();

  useEffect(
    () =>
      bridge?.rendus.onTelechargement?.((cle, recu, total) =>
        setSuivis((s) => {
          const avant = s[cle];
          return avant?.etat === "en-cours" ? { ...s, [cle]: { ...avant, recu, total: total || avant.total } } : s;
        }),
      ),
    [bridge],
  );

  const telecharger = useCallback(
    (r: Rendu) => {
      const nom = nomDuFichier(r.origine);
      const lieu = lieuDuRendu(r.origine);
      const appel = r.chemin
        ? bridge?.rendus.telecharger?.(r.id, r.chemin)
        : r.distantId && lieu
          ? bridge?.rendus.telechargerVps?.(r.id, lieu, r.distantId, nom, r.dossier === true)
          : undefined;
      if (!appel) {
        setSuivis((s) => ({ ...s, [r.id]: { etat: "erreur", nom, message: "Ce livrable ne se télécharge pas depuis cet espace." } }));
        return;
      }
      setSuivis((s) => ({ ...s, [r.id]: { etat: "en-cours", nom, recu: 0, total: r.taille ?? 0 } }));
      void appel.then((rep) =>
        setSuivis((s) => ({ ...s, [r.id]: rep.ok ? { etat: "fait", nom: nomDuFichier(rep.data), chemin: rep.data } : { etat: "erreur", nom, message: rep.message } })),
      );
    },
    [bridge],
  );

  const oublier = useCallback(
    (cle: string) =>
      setSuivis((s) => {
        const reste = { ...s };
        delete reste[cle];
        return reste;
      }),
    [],
  );
  const enCours = (cle: string) => suivis[cle]?.etat === "en-cours";
  return { suivis, telecharger, oublier, enCours };
}

/** Sous la liste : la progression, puis « Afficher » une fois le fichier arrivé, ou la raison d'un échec. */
export function SuivisTelechargement({ suivis, oublier }: { suivis: Record<string, Suivi>; oublier: (cle: string) => void }) {
  const bridge = getBridge();
  const liste = Object.entries(suivis);
  if (!liste.length) return null;
  return (
    <ul aria-live="polite" aria-label="Téléchargements" className="m-0 flex list-none flex-col gap-1 p-0">
      {liste.map(([cle, s]) => (
        <li
          key={cle}
          role={s.etat === "erreur" ? "alert" : undefined}
          className="flex flex-col gap-1.5 rounded-md border border-bordure-subtile bg-fond-surface px-2.5 py-2 text-ui-xs"
        >
          <div className="flex items-center gap-2">
            <Icon name="download-02" size={14} className={s.etat === "erreur" ? "shrink-0 text-texte-erreur" : "shrink-0 text-icone-secondaire"} />
            <span className="min-w-0 flex-1 truncate text-texte-principal">
              {s.etat === "en-cours" && <>Téléchargement de « {s.nom} »…</>}
              {s.etat === "fait" && <>« {s.nom} » est dans Téléchargements</>}
              {s.etat === "erreur" && <>Échec du téléchargement de « {s.nom} »</>}
            </span>
            {s.etat === "fait" && bridge && (
              <Bouton variant="discret" taille="compact" onClick={() => void bridge.fichiers.montrer(s.chemin)}>
                Afficher
              </Bouton>
            )}
            {s.etat !== "en-cours" && (
              <BoutonIcone taille="mini" icone={<Icon name="x-01" size={12} />} libelle="Masquer" data-son="fermer" onClick={() => oublier(cle)} className="text-icone-secondaire" />
            )}
          </div>
          {s.etat === "en-cours" && (
            <div className="flex items-center gap-2">
              <span
                role="progressbar"
                aria-label={`Téléchargement de ${s.nom}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={s.total ? Math.min(100, Math.round((s.recu / s.total) * 100)) : undefined}
                className="h-1 flex-1 overflow-hidden rounded-pill bg-fond-surface-grise"
              >
                <span
                  className="block h-full rounded-pill bg-bleu-k1-500 transition-[width] duration-[200ms] ease-sortie"
                  style={{ width: `${s.total ? Math.min(100, (s.recu / s.total) * 100) : 0}%` }}
                />
              </span>
              <span className="klyra-mono shrink-0 text-ui-2xs text-texte-tertiaire">
                {tailleLisible(s.recu)}
                {s.total ? ` / ${tailleLisible(s.total)}` : ""}
              </span>
            </div>
          )}
          {s.etat === "erreur" && <span className="leading-[1.45] text-texte-erreur">{s.message}</span>}
        </li>
      ))}
    </ul>
  );
}

const copierTexte = (texte: string) => void navigator.clipboard.writeText(texte).catch(() => undefined);

/** Le menu d'un livrable. « Afficher dans le dossier » seulement pour une copie de ce PC. */
export function MenuLivrable({
  menu,
  fermer,
  enCours,
  onTelecharger,
}: {
  menu: MenuOuvert<Rendu>;
  fermer: (rendreFocus?: boolean) => void;
  enCours: boolean;
  onTelecharger: (r: Rendu) => void;
}) {
  const bridge = getBridge();
  const r = menu.cible;
  const surLeVps = !r.chemin && !!r.distantId;
  return (
    <MenuContextuel key={r.id + menu.x + menu.y} x={menu.x} y={menu.y} libelle={`Livrable ${r.titre}`} onFermer={fermer}>
      <ElementContextuel icone="download-02" desactive={enCours} detail={enCours ? "Téléchargement en cours" : undefined} onChoisir={() => onTelecharger(r)}>
        Télécharger
      </ElementContextuel>
      <ElementContextuel icone="link-external" onChoisir={() => ouvrirLivrable(r)}>
        Ouvrir
      </ElementContextuel>
      {r.chemin && bridge && (
        <ElementContextuel icone="folder-open-01" onChoisir={() => void bridge.rendus.montrer(r.chemin)}>
          Afficher {poste.dansExplorateur}
        </ElementContextuel>
      )}
      <SeparateurContextuel />
      <ElementContextuel icone="copy-left" detail={surLeVps ? "Sur le serveur" : undefined} onChoisir={() => copierTexte(surLeVps ? cheminSurLeVps(r.origine) : r.chemin)}>
        Copier le chemin
      </ElementContextuel>
    </MenuContextuel>
  );
}

/** Le menu d'un fichier de la conversation (joint, créé, modifié, lu). Sur un VPS, seul le chemin se copie. */
export function MenuFichierConversation({ menu, fermer, surCePc }: { menu: MenuOuvert<string>; fermer: (rendreFocus?: boolean) => void; surCePc: boolean }) {
  const bridge = getBridge();
  const chemin = menu.cible;
  return (
    <MenuContextuel key={chemin + menu.x + menu.y} x={menu.x} y={menu.y} libelle={`Fichier ${nomDuFichier(chemin)}`} onFermer={fermer}>
      {surCePc && bridge && (
        <>
          <ElementContextuel icone="link-external" onChoisir={() => void bridge.rendus.ouvrir(chemin)}>
            Ouvrir
          </ElementContextuel>
          <ElementContextuel icone="folder-open-01" onChoisir={() => void bridge.fichiers.montrer(chemin)}>
            Afficher {poste.dansExplorateur}
          </ElementContextuel>
          <SeparateurContextuel />
        </>
      )}
      <ElementContextuel icone="copy-left" onChoisir={() => copierTexte(chemin)}>
        Copier le chemin
      </ElementContextuel>
    </MenuContextuel>
  );
}
