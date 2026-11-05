"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { useCompte } from "@/lib/compte";
import type { LecturePoste } from "@/lib/poste/client";
import { majuscule, texteErreurPoste } from "@/lib/poste-texte";
import { libelleVue, type VueGardee } from "@/lib/telephone/vue-gardee";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { PrevenirOuverture } from "./PastillePoste";
import { usePostes, useSupport } from "./poste";
import { usePushTelephone } from "./push";

/**
 * Les états d'un écran (socle mobile § 5) : `EtatEcran` et ses variantes (vide, sans réponse,
 * erreur, ordinateur fermé, aucun ordinateur, ce qui reste sur l'ordinateur), le squelette, la vue
 * gardée, et P-7 sous un bouton désactivé. Règle D-8 : un écran ne dit « rien » que s'il a tout lu.
 * Les mots du poste viennent de `useSupport` (« ton Mac », « ton PC »…), jamais écrits en dur.
 */

/**
 * `encadre` : sous un grand titre, des onglets ou d'autres blocs (le `EmptyState` du bureau) ;
 * `plein` : l'état est toute une page poussée.
 */
export type FormeEtat = "encadre" | "plein";

export function EtatEcran({
  forme = "plein",
  icone,
  bleue = false,
  titre,
  texte,
  erreur = false,
  action,
  children,
  className,
}: {
  forme?: FormeEtat;
  icone?: IconName;
  /** Rond bleu : seulement « Aucun ordinateur relié ». */
  bleue?: boolean;
  titre?: string;
  texte?: ReactNode;
  erreur?: boolean;
  /** Une action au plus (`Bouton md`), et une secondaire `discret` au plus. */
  action?: ReactNode;
  /** Ce qui suit l'état (une carte, ce qui se lit quand même). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(forme === "plein" ? "px-4 pt-14 pb-6" : "px-4 pb-6", className)}>
      <div
        role={erreur ? "alert" : "status"}
        className={cn(
          "flex flex-col items-center text-center",
          forme === "encadre" && "rounded-[20px] border border-dashed border-gray-k1 bg-paper px-6 py-8",
        )}
      >
        {icone ? (
          <span
            aria-hidden="true"
            className={cn(
              "mb-4 flex size-12 items-center justify-center rounded-full",
              bleue ? "bg-fond-teinte-bleue text-icone-accent" : "border border-bordure-defaut bg-fond-surface text-icone-secondaire",
            )}
          >
            <Icon name={icone} size={24} />
          </span>
        ) : null}
        {titre ? <h2 className="text-body-s font-semibold text-texte-principal">{titre}</h2> : null}
        {texte ? <div className="mt-1.5 max-w-[290px] text-ui text-texte-secondaire">{texte}</div> : null}
        {action ? <div className="mt-5 flex flex-col items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** La première phrase d'un texte P-6 (« Les fichiers de ce projet sont sur ton ordinateur. »). */
function premierePhrase(texte: string): string {
  const fin = texte.indexOf(". ");
  return fin === -1 ? texte : texte.slice(0, fin + 1);
}

/**
 * P-6, sans vue gardée (S-19) : ce qui manque et où c'est, « Me prévenir à l'ouverture », puis ce
 * qui marche quand même. `phrase` reçoit « ton Mac » : « les fichiers de ce projet sont sur ton Mac.
 * Ils s'affichent quand KLYRA y est ouverte. »
 */
export function PosteFerme({ phrase, forme = "plein", sansRecours = false, className }: { phrase: (sur: string) => string; forme?: FormeEtat; sansRecours?: boolean; className?: string }) {
  const sur = useSupport();
  const { principal } = usePostes();
  const enLigne = !useHorsLigne();
  if (!enLigne) {
    return <EtatEcran className={className} forme={forme} icone="globe-01" titre="Ce téléphone est hors ligne" texte={`${majuscule(phrase(sur))} Reviens quand ce téléphone est en ligne.`} />;
  }
  return (
    <EtatEcran
      className={className}
      forme={forme}
      icone="computer"
      titre={`${majuscule(sur)} est fermé`}
      texte={majuscule(phrase(sur))}
      action={principal ? <PrevenirOuverture cle={principal.cle} /> : null}
    >
      {sansRecours ? null : (
        <div className="mt-6 flex gap-3 rounded-xl border border-bordure-subtile bg-fond-surface p-4 shadow-ombre-ambiante">
          <Icon name="message-square" size={20} className="mt-0.5 shrink-0 text-icone-secondaire" />
          <div className="min-w-0 flex-1">
            <p className="text-ui text-texte-principal">Tu peux quand même écrire à un agent : ton message partira à l’ouverture.</p>
            <Link href="/chats?ecrire=1" className="mt-1 inline-flex min-h-11 items-center gap-1 text-ui font-medium text-texte-principal">
              Écrire à un agent
              <Icon name="chevron-right" size={16} />
            </Link>
          </div>
        </div>
      )}
    </EtatEcran>
  );
}

/**
 * P-13 (S-21) : le compte n'a aucun ordinateur relié. Ne dit jamais « ton ordinateur est fermé ».
 * `phrase` est celle de P-6 : sa première phrase dit ce qui vit sur l'ordinateur.
 */
export function AucunPoste({ phrase, forme = "plein", className }: { phrase: (sur: string) => string; forme?: FormeEtat; className?: string }) {
  const { moi } = useCompte();
  const etapes = ["Ouvre KLYRA sur ton ordinateur.", "Va dans Réglages › Équipe.", moi ? `Connecte-toi avec ${moi.email}.` : "Connecte-toi à ton compte."];
  return (
    <EtatEcran
      className={className}
      forme={forme}
      icone="computer"
      bleue
      titre="Aucun ordinateur relié"
      texte={
        <>
          <p>{majuscule(premierePhrase(phrase("ton ordinateur")))} Relie-le une fois à ton compte :</p>
          <ol className="mt-4 flex flex-col gap-3 text-left">
            {etapes.map((etape, i) => (
              <li key={etape} className="flex items-start gap-3 text-body-s text-texte-principal">
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fond-surface-grise text-ui-xs font-semibold">
                  {i + 1}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{etape}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4">Ce téléphone se met à jour tout seul.</p>
        </>
      }
    />
  );
}

/**
 * Ce geste peut-il partir vers l'ordinateur maintenant ? Sinon, sa raison en une phrase (P-7, § 5.5) :
 * hors ligne, aucun ordinateur relié, ou ordinateur fermé.
 */
export function useGestePossible(): { possible: boolean; raison: string | undefined } {
  const sur = useSupport();
  const { ouvert, postes } = usePostes();
  const enLigne = !useHorsLigne();
  if (!enLigne) return { possible: false, raison: "Possible quand ce téléphone est en ligne" };
  if (postes?.length === 0) return { possible: false, raison: "Possible quand un ordinateur est relié" };
  if (!ouvert) return { possible: false, raison: `Possible quand ${sur} est ouvert` };
  return { possible: true, raison: undefined };
}

/** Un bandeau dans la page (§ 6.2) : `attente` (gris), `erreur` (filet rouge), `info` (bleu pâle). */
export function Bandeau({ ton = "attente", icone, children, className, role }: { ton?: "info" | "attente" | "erreur"; icone: IconName; children: ReactNode; className?: string; role?: "alert" | "status" }) {
  return (
    <div
      role={role ?? (ton === "erreur" ? "alert" : undefined)}
      className={cn(
        "flex items-start gap-2.5 rounded-md py-3 pr-3 pl-3.5 text-ui leading-[1.4]",
        ton === "erreur" ? "border border-bordure-erreur bg-fond-surface text-texte-erreur" : ton === "info" ? "border border-bordure-accent-legere bg-fond-teinte-bleue text-texte-principal" : "bg-fond-surface-grise text-texte-principal",
        className,
      )}
    >
      <Icon name={icone} size={20} className={cn("shrink-0", ton === "info" && "text-icone-accent")} />
      <div className="min-w-0 flex-1 pt-px">{children}</div>
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

/**
 * P-9 (S-16) : rien pendant 300 ms (déjà compté par `useLecturePoste`), puis « Demande à ton Mac… »
 * et un squelette aux formes des lignes.
 */
export function DemandeEnCours({ lent, lignes = 4 }: { lent: boolean; lignes?: number }) {
  const sur = useSupport();
  if (!lent) return <div aria-busy="true" />;
  return (
    <div className="px-4 pt-4" aria-busy="true">
      <p className="flex items-center gap-2 pb-3 text-ui text-texte-secondaire">
        <Icon name="loader-01" size={16} className="shrink-0" />
        Demande à {sur}…
      </p>
      <Squelette lignes={lignes} />
    </div>
  );
}

/** Le squelette d'une liste : des lignes de 72 px dans leur groupe blanc. */
export function Squelette({ lignes = 4 }: { lignes?: number }) {
  return (
    <ul aria-hidden="true" className="overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-xs">
      {Array.from({ length: lignes }, (_, i) => (
        <li key={i} className="flex h-[72px] items-center gap-3 px-4">
          <span className="size-10 shrink-0 rounded-[10px] bg-fond-surface-grise motion-safe:animate-pulse" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3 w-3/5 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse" />
            <span className="h-2.5 w-4/5 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** P-10 (S-18). */
export function PasDeReponse({ relancer, forme = "plein" }: { relancer: () => void; forme?: FormeEtat }) {
  const sur = useSupport();
  return (
    <EtatEcran
      forme={forme}
      erreur
      icone="clock-01"
      titre={`${majuscule(sur)} ne répond pas`}
      texte="KLYRA y est ouverte, mais la réponse n’est pas venue. L’ordinateur est peut-être en veille."
      action={
        <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="refresh-01" size={20} />} onClick={relancer}>
          Réessayer
        </Bouton>
      }
    />
  );
}

/** Une erreur de lecture : la phrase de l'ordinateur ou du compte (C-1f), « Réessayer » si utile. */
export function ErreurPoste({ code = "erreur", message, relancer, forme = "plein" }: { code?: string; message: string; relancer?: () => void; forme?: FormeEtat }) {
  const sur = useSupport();
  return (
    <EtatEcran
      forme={forme}
      erreur
      icone="help-circle-contained"
      titre={texteErreurPoste({ code, message }, sur)}
      action={
        relancer ? (
          <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="refresh-01" size={20} />} onClick={relancer}>
            Réessayer
          </Bouton>
        ) : null
      }
    />
  );
}

/* ─── Vue gardée (socle § 5.4) ───────────────────────────────────── */

/** L'heure d'une vue gardée, relue chaque minute (« Vue à 18:42 » devient « Vue hier… » à minuit). */
export function useMaintenant(): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const minuteur = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(minuteur);
  }, []);
  return maintenant;
}

/** « Prévenir » du bandeau : la même demande que « Me prévenir à l'ouverture », en bouton compact. */
function PrevenirCompact({ cle }: { cle: string }) {
  const push = usePushTelephone();
  const { etat } = push;
  if (etat.etat === "active" && etat.ouverturesAttendues.includes(cle)) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-ui font-medium text-texte-accent">
        <Icon name="check-01" size={16} />
        <span>On te prévient</span>
      </span>
    );
  }
  const possible = etat.etat === "a-demander" || etat.etat === "a-activer" || etat.etat === "active";
  if (!possible) return null;
  return (
    <Bouton
      variant="discret"
      taille="compact"
      disabled={push.occupe}
      iconeGauche={<Icon name="bell-01" size={16} />}
      onClick={() => void push.attendreOuverture(cle)}
      aria-label="Me prévenir à l’ouverture"
      className="relative after:absolute after:-inset-y-1.5 after:inset-x-0"
    >
      Prévenir
    </Bouton>
  );
}

/** Le bandeau d'une vue gardée : « Vue à 18:42 · ton Mac est fermé », et « Prévenir ». */
export function BandeauVueGardee({ lu, mot, className }: { lu: number; mot?: string; className?: string }) {
  const sur = useSupport();
  const { principal } = usePostes();
  const maintenant = useMaintenant();
  const enLigne = !useHorsLigne();
  return (
    <div role="status" className={cn("flex min-h-10 items-center gap-2 rounded-md bg-fond-surface-grise py-1.5 pr-1.5 pl-3", className)}>
      <Icon name="clock-backward" size={20} className="shrink-0 text-icone-defaut" />
      <p className="min-w-0 flex-1 text-ui text-texte-principal">
        {libelleVue(lu, maintenant, mot)}
        <span className="text-texte-secondaire"> · {enLigne ? `${sur} est fermé` : "hors ligne"}</span>
      </p>
      {principal && enLigne ? <PrevenirCompact cle={principal.cle} /> : null}
    </div>
  );
}

/** Une liste montrée depuis sa vue gardée : en lecture seule, les gestes disent pourquoi ils attendent. */
const ContexteVueGardee = createContext<VueGardee<unknown> | null>(null);

/** La vue gardée qui est montrée ici, ou null : l'écran lit l'ordinateur en direct. */
export function useVueGardeeAffichee(): VueGardee<unknown> | null {
  return useContext(ContexteVueGardee);
}

/**
 * Ordinateur fermé, la dernière vue lue sur ce téléphone (S-20) : le bandeau, la liste telle qu'elle
 * était, les contrôles désactivés (un `fieldset` désactivé : boutons, champs, interrupteurs), et la
 * raison commune dessous. Les liens restent actifs : ils ne demandent rien à l'ordinateur.
 * `verrou` à faux : l'écran désactive lui-même ses gestes sur l'ordinateur (P-7) et garde actif ce
 * qui n'en a pas besoin (ouvrir un lien d'artefact, chercher dans la liste).
 */
export function LectureGardee({
  vue,
  gestes = "Modifier",
  verrou = true,
  children,
}: {
  vue: VueGardee<unknown>;
  gestes?: string;
  verrou?: boolean;
  children: ReactNode;
}) {
  const sur = useSupport();
  return (
    <ContexteVueGardee.Provider value={vue}>
      <div className="px-4 pt-2 pb-3">
        <BandeauVueGardee lu={vue.lu} />
      </div>
      {verrou ? (
        <fieldset disabled className="m-0 min-w-0 border-0 p-0" aria-label={`Lecture seule : ${sur} est fermé`}>
          {children}
        </fieldset>
      ) : (
        children
      )}
      <p className="px-5 pt-2 pb-6 text-ui-xs text-texte-secondaire">
        {gestes} : possible quand {sur} est ouvert.
      </p>
    </ContexteVueGardee.Provider>
  );
}

/**
 * Les états d'une lecture sur l'ordinateur, en un composant : aucun ordinateur, fermé (avec la vue
 * gardée s'il y en a une), en cours, sans réponse, erreur, et le contenu.
 */
export function VueLecture<T>({
  lecture,
  ferme,
  lignes,
  forme = "plein",
  gestes,
  verrou,
  sansRecours,
  children,
}: {
  lecture: LecturePoste<T> & { relancer: () => void };
  ferme: (sur: string) => string;
  lignes?: number;
  forme?: FormeEtat;
  /** Ce qui attend l'ordinateur dans la vue gardée (« Lancer et modifier »). */
  gestes?: string;
  /** Vue gardée : désactiver tous les contrôles (par défaut), ou laisser l'écran le faire. */
  verrou?: boolean;
  /** Fermé sans vue gardée : sans la carte « Écrire à un agent » (l'écran a déjà ce recours). */
  sansRecours?: boolean;
  children: (data: T) => ReactNode;
}) {
  if (lecture.etat === "aucun") return <AucunPoste phrase={ferme} forme={forme} />;
  if (lecture.etat === "ferme") {
    if (lecture.gardee) {
      return (
        <LectureGardee vue={lecture.gardee} gestes={gestes} verrou={verrou}>
          {children(lecture.gardee.data)}
        </LectureGardee>
      );
    }
    return <PosteFerme phrase={ferme} forme={forme} sansRecours={sansRecours} />;
  }
  if (lecture.etat === "attente") return <DemandeEnCours lent={lecture.lent} lignes={lignes} />;
  if (lecture.etat === "delai") return <PasDeReponse relancer={lecture.relancer} forme={forme} />;
  if (lecture.etat === "erreur") return <ErreurPoste code={lecture.code} message={lecture.message} relancer={lecture.relancer} forme={forme} />;
  return <>{children(lecture.data)}</>;
}

/**
 * Une annonce éphémère (« Enregistré », « Workflow lancé ») : l'`Annonce` de la coque (§ 6.1), une seule
 * à la fois. Le premier élément reste pour les écrans qui le posaient : il ne rend plus rien.
 */
export function useBandeau(): [ReactNode, (texte: string) => void] {
  const annoncer = useAnnonce();
  const montrer = useCallback((texte: string) => annoncer(texte), [annoncer]);
  return [null, montrer];
}
