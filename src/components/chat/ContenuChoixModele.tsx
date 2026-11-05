"use client";

import { Icon } from "@/components/icons/Icon";
import { LogoFournisseur } from "@/components/ui/LogoFournisseur";
import { cn } from "@/lib/cn";
import { fournisseur, FOURNISSEURS, nomEffort, PAR_DEFAUT } from "@/lib/fournisseurs";
import type { ModeleMoteur } from "@/lib/bridge";
import type { EtatMoteur } from "@/lib/moteurs";

/** Le même choix à deux colonnes dans le menu du bureau et la feuille du téléphone. */
export function ContenuChoixModele({
  vue, moteur, modele, effort, modeleFiche, moteurs, modelesVue, modelesActuels,
  recherche, connexion, onVue, onRecherche, onModele, onEffort, onConnecter, onAjouter, tactile = false, lieu = null,
}: {
  vue: string;
  moteur: string;
  modele: string | null;
  effort: string | null;
  modeleFiche: string | null;
  moteurs: EtatMoteur[] | null;
  modelesVue: ModeleMoteur[];
  modelesActuels: ModeleMoteur[];
  recherche: string;
  connexion: { etat: "en-cours" } | { etat: "erreur"; message: string } | null;
  onVue: (id: string) => void;
  onRecherche: (texte: string) => void;
  onModele: (modele: ModeleMoteur) => void;
  onEffort: (effort: string) => void;
  onConnecter: () => void;
  onAjouter: () => void;
  tactile?: boolean;
  lieu?: string | null;
}) {
  const disponibles = FOURNISSEURS.filter((f) => f.id === PAR_DEFAUT || moteurs?.some((m) => m.moteur.id === f.id && m.moteur.chemin));
  const etatVue = moteurs?.find((m) => m.moteur.id === vue);
  const connecte = vue === PAR_DEFAUT || !!etatVue?.compte?.connecte;
  const filtres = modelesVue.filter((m) => m.nom.toLowerCase().includes(recherche.trim().toLowerCase()));
  const efforts = modelesActuels.find((m) => m.id === modele)?.efforts ?? [];
  return (
    <>
      <div role="tablist" aria-label="Fournisseurs" aria-orientation="vertical" className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-bordure-subtile p-2">
        {disponibles.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={vue === f.id} title={f.nom} onClick={() => onVue(f.id)}
            className={cn("flex size-10 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent hover:bg-fond-survol", tactile && "min-h-11 min-w-11", vue === f.id && "bg-fond-surface-grise")}>
            <LogoFournisseur id={f.id} initiale={f.initiale} taille={32} />
            <span className="sr-only">{f.nom}</span>
          </button>
        ))}
        <button type="button" title="Ajouter un fournisseur" aria-label="Ajouter un fournisseur" onClick={onAjouter}
          className={cn("mt-auto flex size-10 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-icone-secondaire hover:bg-fond-survol hover:text-texte-principal", tactile && "min-h-11 min-w-11")}>
          <Icon name="plus-01" size={18} />
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-0.5 px-3 pt-3 pb-2">
          <span className="truncate text-ui-s font-medium text-texte-principal">{fournisseur(vue).nom}{etatVue?.compte?.email ? ` · ${etatVue.compte.email}` : ""}</span>
          <span className="text-ui-xs text-texte-tertiaire">{vue === moteur ? "Dans cette conversation" : `Passer cette conversation sur ${fournisseur(vue).nom}`}</span>
        </div>
        {connecte ? (
          <>
            {modelesVue.length > 6 && (
              <div className="px-3 pb-2">
                <input type="search" value={recherche} onChange={(e) => onRecherche(e.target.value)} placeholder="Rechercher des modèles" aria-label="Rechercher des modèles"
                  className={cn("h-8 w-full rounded-xs border border-bordure-subtile bg-fond-surface-grise px-2.5 text-ui-s text-texte-principal placeholder:text-texte-tertiaire focus:border-bordure-forte focus:outline-none", tactile && "h-11")} />
              </div>
            )}
            <div role="radiogroup" aria-label="Modèle" className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5">
              {filtres.map((m) => {
                const choisi = vue === moteur && m.id === modele;
                return (
                  <button key={m.id} type="button" role="radio" aria-checked={choisi} onClick={() => onModele(m)}
                    className={cn("flex h-9 shrink-0 cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left hover:bg-fond-survol", tactile && "min-h-11")}>
                    <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", choisi ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte")}>
                      {choisi && <Icon name="check-01" size={12} />}
                    </span>
                    <span className="flex-1 truncate text-ui-s text-texte-principal">{m.nom}</span>
                    {(vue === PAR_DEFAUT ? m.id === modeleFiche : m.parDefaut) && (
                      <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px text-ui-3xs font-medium text-texte-secondaire">{vue === PAR_DEFAUT ? "fiche" : "par défaut"}</span>
                    )}
                  </button>
                );
              })}
              {!filtres.length && <p className="m-0 px-2 py-2 text-ui-xs text-texte-tertiaire">{modelesVue.length ? "Aucun modèle ne correspond." : "Lecture des modèles…"}</p>}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-2 px-3 pb-3">
            <p className="m-0 text-ui-xs text-texte-secondaire">{fournisseur(vue).nom} n’est pas connecté sur {lieu ? "ce serveur" : "ce poste"}.</p>
            <button type="button" onClick={onConnecter} disabled={connexion?.etat === "en-cours"}
              className={cn("h-8 cursor-pointer rounded-xs border border-bordure-subtile bg-fond-surface px-3 text-ui-s font-medium text-texte-principal hover:border-bordure-forte disabled:cursor-wait disabled:opacity-60", tactile && "min-h-11")}>
              {connexion?.etat === "en-cours" ? "Connexion dans le navigateur…" : lieu ? "Se connecter sur le serveur" : "Se connecter"}
            </button>
          </div>
        )}
        {connexion?.etat === "erreur" && <p role="alert" className="m-0 px-3 pb-3 text-ui-xs text-texte-erreur">{connexion.message}</p>}
        {vue === moteur && efforts.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-bordure-subtile p-3">
            <span className="text-ui-xs font-medium text-texte-tertiaire">Effort de réflexion</span>
            <div role="radiogroup" aria-label="Effort" className="grid gap-0.5 rounded-sm bg-fond-surface-grise p-0.5" style={{ gridTemplateColumns: `repeat(${tactile ? Math.min(3, efforts.length) : efforts.length}, minmax(0, 1fr))` }}>
              {efforts.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={id === effort} title={nomEffort(id)} onClick={() => onEffort(id)}
                  className={cn("h-7 cursor-pointer truncate rounded-2xs border-0 px-1 text-ui-2xs font-medium transition-colors duration-[220ms] ease-sortie", tactile && "min-h-11", id === effort ? "bg-fond-surface text-texte-principal shadow-ombre-xs" : "bg-transparent text-texte-secondaire hover:text-texte-principal")}>
                  {nomEffort(id)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
