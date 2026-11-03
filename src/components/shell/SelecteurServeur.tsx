"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { useConfirmation } from "@/components/ui/Modale";
import { cn } from "@/lib/cn";
import { modifierCarnet, nomLieu, useLieuActif, useServeursRelies } from "@/lib/lieux";
import { apparition } from "@/lib/mouvement";
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

/**
 * En haut du rail, comme le sélecteur de serveur d'OpenBot : ce PC ou un VPS relié. La machine choisie
 * reçoit les conversations directes avec les agents (`basculerMachine`) et les nouveaux projets et routines.
 * Chaque conversation garde la mémoire de ses agents sur chaque machine.
 */
export function SelecteurServeur() {
  const router = useRouter();
  const { state, basculerMachine } = useWorkspace();
  const serveurs = useServeursRelies();
  const lieu = useLieuActif();
  const [ouvert, setOuvert] = useState(false);
  const etats = useEtatsServeurs(serveurs, ouvert);
  const [demander, fenetre] = useConfirmation();
  const zone = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const idMenu = useId();

  // Une conversation directe au travail ne peut pas changer de machine en cours de route.
  const auTravail = state.chats.find((c) => c.kind === "direct" && !c.fil && state.travail[c.id]);
  const actif = serveurs.find((s) => s.adresse === lieu) ?? null;
  const nom = nomLieu(lieu, serveurs);
  const etatActif = actif ? libelleServeur("joint", etats[actif.adresse]?.sonde, etats[actif.adresse]?.agents) : "Les agents tournent ici";

  const fermer = (rendreFocus: boolean) => {
    setOuvert(false);
    if (rendreFocus) bouton.current?.focus();
  };

  useEffect(() => {
    if (!ouvert) return;
    zone.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const dehors = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOuvert(false);
      bouton.current?.focus();
    };
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  /* Les flèches passent d'une ligne à l'autre (en boucle), Début et Fin vont aux bouts. */
  const parcourir = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      fermer(true);
      return;
    }
    const liste = [...(zone.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const rang = liste.indexOf(document.activeElement as HTMLElement);
    const cible = { ArrowDown: (rang + 1) % liste.length, ArrowUp: (rang - 1 + liste.length) % liste.length, Home: 0, End: liste.length - 1 }[e.key];
    if (cible === undefined) return;
    e.preventDefault();
    liste[cible]?.focus();
  };

  const choisir = (suivant: string | null) => {
    fermer(true);
    if (suivant !== lieu) basculerMachine(suivant);
  };

  const aller = (chemin: string) => {
    fermer(false);
    router.push(chemin);
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

  const occupe = auTravail ? "Attends la fin du travail en cours" : null;

  return (
    <div ref={zone} className="relative mb-2 shrink-0">
      <button
        ref={bouton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idMenu : undefined}
        aria-label={`Serveur : ${nom} · ${etatActif}`}
        title={`${nom} · ${etatActif}`}
        onClick={() => setOuvert((v) => !v)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" || ouvert) return;
          e.preventDefault();
          setOuvert(true);
        }}
        className={cn(
          "flex w-14 cursor-pointer flex-col items-center gap-1 rounded-md border-0 py-1.5 transition-colors duration-[120ms] ease-sortie",
          ouvert ? "bg-white/14 text-texte-inverse" : "bg-transparent text-texte-inverse-secondaire hover:bg-white/8 hover:text-texte-inverse",
        )}
      >
        <span className="relative flex">
          <Icon name={actif ? "globe-01" : "computer"} size={24} />
          {actif && <Point sonde={etats[actif.adresse]?.sonde} className="absolute -right-0.5 -bottom-0.5 size-2.5 border-2 border-fond-inverse-fort" />}
        </span>
        <span className="flex w-full items-center justify-center gap-0.5 px-1 text-ui-3xs">
          <span className="truncate">{nom}</span>
          <Icon name="chevron-down" size={10} className="shrink-0" />
        </span>
      </button>

      {ouvert && (
        <div
          ref={apparition}
          id={idMenu}
          role="menu"
          aria-label="Serveurs"
          onKeyDown={parcourir}
          className="absolute top-0 left-full z-50 ml-3 flex w-[280px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante"
        >
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
        </div>
      )}
      {fenetre}
    </div>
  );
}
