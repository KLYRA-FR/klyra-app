"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { useConfirmation } from "@/components/ui/Modale";
import { cn } from "@/lib/cn";
import { modifierCarnet, nomLieu, useLieuActif, useServeursRelies } from "@/lib/lieux";
import { EVENEMENT_AJOUTER, interroger, libelleServeur, retirer, retirerServeur, sondeDe, type ServeurConnu, type Sonde } from "@/lib/serveur-vps";
import { useWorkspace } from "@/lib/workspace";

/** Un serveur relié est réinterrogé à cet intervalle, et à chaque ouverture du menu. */
const SONDE_MS = 60_000;

interface Etat {
  sonde: Sonde;
  agents?: string;
}

function useEtatsServeurs(serveurs: ServeurConnu[], ouvert: boolean): Record<string, Etat> {
  const [etats, setEtats] = useState<Record<string, Etat>>({});
  useEffect(() => {
    const controle = new AbortController();
    const sonder = () => {
      for (const serveur of serveurs) {
        void interroger(serveur.adresse, controle.signal).then((lecture) => {
          if (controle.signal.aborted) return;
          setEtats((avant) => ({ ...avant, [serveur.adresse]: { sonde: sondeDe(lecture), agents: lecture.ok ? lecture.agents : undefined } }));
        });
      }
    };
    sonder();
    const minuteur = setInterval(sonder, SONDE_MS);
    return () => {
      controle.abort();
      clearInterval(minuteur);
    };
  }, [serveurs, ouvert]);
  return etats;
}

/** Point d'état : K1 répond, rouge ne répond pas (ou plus relié), gris en vérification. */
function Point({ sonde, className }: { sonde: Sonde | undefined; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        sonde === "repond" ? "bg-bleu-k1-500" : sonde && sonde !== "attente" ? "bg-bordure-erreur" : "bg-gris-k1-100",
        className,
      )}
    />
  );
}

const LIGNE = "flex w-full gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left text-ui-s focus-visible:bg-fond-survol focus-visible:-outline-offset-2";

function Action({ icone, children, onClick, danger = false }: { icone: IconName; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      className={cn(LIGNE, "h-8 cursor-pointer items-center whitespace-nowrap hover:bg-fond-survol", danger ? "text-texte-erreur" : "text-texte-principal")}
    >
      <Icon name={icone} size={16} className={cn("shrink-0", danger ? "text-texte-erreur" : "text-icone-secondaire")} />
      {children}
    </button>
  );
}

function Choix({
  choisi,
  icone,
  nom,
  detail,
  sonde,
  desactive,
  onClick,
}: {
  choisi: boolean;
  icone: IconName;
  nom: string;
  detail: string;
  sonde?: Sonde;
  desactive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={choisi}
      aria-disabled={desactive || undefined}
      tabIndex={-1}
      onClick={() => !desactive && onClick()}
      className={cn(LIGNE, "min-h-11 items-center py-1.5", desactive ? "cursor-not-allowed" : "cursor-pointer hover:bg-fond-survol")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full",
          choisi ? "bg-fond-inverse-fort text-texte-inverse" : "border border-bordure-forte",
        )}
      >
        {choisi && <Icon name="check-01" size={14} />}
      </span>
      <Icon name={icone} size={16} className={cn("shrink-0 text-icone-secondaire", desactive && "opacity-60")} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate", desactive ? "text-texte-tertiaire" : "text-texte-principal")}>{nom}</span>
        <span className="truncate text-ui-xs leading-[1.35] text-texte-tertiaire">{detail}</span>
      </span>
      {sonde && <Point sonde={sonde} />}
    </button>
  );
}

/** Les flèches passent d'une ligne à l'autre d'un menu (en boucle), Début et Fin vont aux bouts. */
export function parcourirMenu(e: KeyboardEvent<HTMLElement>, menu: HTMLElement | null): boolean {
  const liste = [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  const rang = liste.indexOf(document.activeElement as HTMLElement);
  const cible = { ArrowDown: (rang + 1) % liste.length, ArrowUp: (rang - 1 + liste.length) % liste.length, Home: 0, End: liste.length - 1 }[e.key];
  if (cible === undefined) return false;
  e.preventDefault();
  liste[cible]?.focus();
  return true;
}

/**
 * La machine où tournent les agents, comme le sélecteur de serveur d'OpenBot : ce PC ou un VPS relié.
 * La machine choisie reçoit les conversations directes avec les agents (`basculerMachine`) et les nouveaux
 * projets et routines. Chaque conversation garde la mémoire de ses agents sur chaque machine.
 * `ouvert` relance la sonde ; `fermer` referme le menu qui montre les serveurs.
 */
export function useServeurs(ouvert: boolean, fermer: (rendreFocus: boolean) => void) {
  const { state, basculerMachine } = useWorkspace();
  const serveurs = useServeursRelies();
  const lieu = useLieuActif();
  const etats = useEtatsServeurs(serveurs, ouvert);
  const [demander, fenetre] = useConfirmation();

  // Une conversation directe au travail ne peut pas changer de machine en cours de route.
  const auTravail = state.chats.find((c) => c.kind === "direct" && !c.fil && state.travail[c.id]);
  const actif = serveurs.find((s) => s.adresse === lieu) ?? null;
  const nom = nomLieu(lieu, serveurs);
  const sonde = actif ? etats[actif.adresse]?.sonde : undefined;
  const etatActif = actif ? libelleServeur("joint", sonde, etats[actif.adresse]?.agents) : "Les agents tournent ici";
  const occupe = auTravail ? "Attends la fin du travail en cours" : null;

  const choisir = (suivant: string | null) => {
    fermer(true);
    if (suivant !== lieu) basculerMachine(suivant);
  };

  const retirerActif = async () => {
    if (!actif) return;
    fermer(false);
    const ok = await demander({
      titre: `Retirer ${actif.nom} ?`,
      texte: "L’app oublie ce serveur et son accès, et les conversations directes repassent sur ce PC. Pour le relier à nouveau, il faudra relancer la commande sur le VPS.",
      confirmer: "Retirer",
    });
    if (!ok) return;
    void retirer(actif.adresse);
    modifierCarnet((carnet) => retirerServeur(carnet, actif.id));
    basculerMachine(null);
  };

  return { serveurs, actif, nom, sonde, etatActif, etats, occupe, choisir, retirerActif, fenetre };
}

export type Serveurs = ReturnType<typeof useServeurs>;

/** Le point d'état du serveur actif, pour l'afficher hors du menu. */
export { Point as PointServeur };

/** Le contenu du menu Serveurs : Ce PC et les VPS reliés à cocher, puis les actions sur la machine active. */
export function ListeServeurs({ s, aller }: { s: Serveurs; aller: (chemin: string) => void }) {
  const { serveurs, actif, etats, occupe, choisir, retirerActif } = s;
  return (
    <>
      <p className="m-0 px-2 pt-1 pb-1 text-ui-xs text-texte-tertiaire">Serveurs</p>
      <Choix
        choisi={!actif}
        icone="computer"
        nom="Ce PC"
        detail={actif && occupe ? occupe : "Les agents tournent ici"}
        desactive={!!actif && !!occupe}
        onClick={() => choisir(null)}
      />
      {serveurs.map((serveur) => {
        const choisi = serveur.adresse === actif?.adresse;
        const etat = etats[serveur.adresse];
        return (
          <Choix
            key={serveur.id}
            choisi={choisi}
            icone="globe-01"
            nom={serveur.nom}
            detail={!choisi && occupe ? occupe : libelleServeur("joint", etat?.sonde, etat?.agents)}
            sonde={etat?.sonde ?? "attente"}
            desactive={!choisi && !!occupe}
            onClick={() => choisir(serveur.adresse)}
          />
        );
      })}
      <Action
        icone="plus-01"
        onClick={() => {
          aller("/serveurs?ajouter=1");
          window.dispatchEvent(new Event(EVENEMENT_AJOUTER));
        }}
      >
        Ajouter un serveur
      </Action>
      <span aria-hidden="true" className="mx-2 my-1 h-px bg-bordure-subtile" />
      {/* Ceux de la machine active : fournisseurs, agents… (comme le menu du serveur d'OpenBot). */}
      <Action icone="settings" onClick={() => aller("/serveur/reglages")}>
        Réglages du serveur
      </Action>
      <Action icone="list" onClick={() => aller("/serveurs")}>
        Tous les serveurs
      </Action>
      {actif && (
        <>
          <span aria-hidden="true" className="mx-2 my-1 h-px bg-bordure-subtile" />
          <Action icone="trash-01" danger onClick={() => void retirerActif()}>
            Retirer {actif.nom}
          </Action>
        </>
      )}
    </>
  );
}
