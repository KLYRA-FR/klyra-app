"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { useConfirmation } from "@/components/ui/Modale";
import { cn } from "@/lib/cn";
import { idDirect, lireIdDirect, modifierCarnet, nomLieu, useLieuActif, useServeursRelies } from "@/lib/lieux";
import { EVENEMENT_AJOUTER, interroger, libelleServeur, retardDe, retirer, retirerServeur, sondeDe, type ServeurConnu, type Sonde } from "@/lib/serveur-vps";
import { useWorkspace } from "@/lib/workspace";
import type { Chat, Message } from "@/types/domain";

/** Un serveur relié est réinterrogé à cet intervalle, et à chaque ouverture du menu. */
const SONDE_MS = 60_000;

interface Etat {
  sonde: Sonde;
  agents?: string;
  retard: boolean;
}

function useEtatsServeurs(serveurs: ServeurConnu[], ouvert: boolean): Record<string, Etat> {
  const [etats, setEtats] = useState<Record<string, Etat>>({});
  useEffect(() => {
    const controle = new AbortController();
    const sonder = () => {
      for (const serveur of serveurs) {
        void interroger(serveur.adresse, controle.signal).then((lecture) => {
          if (controle.signal.aborted) return;
          setEtats((avant) => ({ ...avant, [serveur.adresse]: { sonde: sondeDe(lecture), agents: lecture.ok ? lecture.agents : undefined, retard: retardDe(lecture) } }));
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
  nonLus = 0,
  onClick,
}: {
  choisi: boolean;
  icone: IconName;
  nom: string;
  detail: string;
  sonde?: Sonde;
  /** Réponses pas encore lues dans l'espace de ce serveur (montrées quand il n'est pas affiché). */
  nonLus?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={choisi}
      tabIndex={-1}
      onClick={onClick}
      className={cn(LIGNE, "min-h-11 cursor-pointer items-center py-1.5 hover:bg-fond-survol")}
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
      <Icon name={icone} size={16} className="shrink-0 text-icone-secondaire" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-texte-principal">{nom}</span>
        <span className="truncate text-ui-xs leading-[1.35] text-texte-tertiaire">{detail}</span>
      </span>
      {!choisi && nonLus > 0 && (
        <span
          aria-label={`${nonLus} non lu${nonLus > 1 ? "s" : ""}`}
          className="klyra-mono min-w-5 shrink-0 rounded-full bg-fond-accent px-1.5 text-center text-ui-2xs leading-5 text-texte-inverse"
        >
          {nonLus > 99 ? "99+" : nonLus}
        </span>
      )}
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

/** Les réponses d'agents pas encore lues, par serveur (`""` : ce PC). */
function nonLusParServeur({ chats, messages }: { chats: Chat[]; messages: Message[] }): Record<string, number> {
  const parId = new Map(chats.map((c) => [c.id, c]));
  const compte: Record<string, number> = {};
  for (const m of messages) {
    const chat = parId.get(m.chatId);
    if (!chat || m.author.kind !== "role" || m.statut === "en-cours" || m.createdAt <= (chat.luJusqua ?? "")) continue;
    const cle = chat.lieu ?? "";
    compte[cle] = (compte[cle] ?? 0) + 1;
  }
  return compte;
}

/** Ce qui s'ouvre sur l'autre serveur à la place de la page affichée : la conversation du même agent, sinon l'accueil. */
function pageSurServeur(chats: Chat[], suivant: string | null): string | null {
  const ici = new URL(window.location.href);
  const page = ici.pathname.replace(/\/$/, "");
  const id = ici.searchParams.get("id");
  if (page === "/projet") return "/projets";
  if (page !== "/chat" || !id) return null;
  const chat = chats.find((c) => c.id === id);
  if (chat && (chat.lieu ?? null) === suivant) return null;
  const agent = chat?.fil?.roleId ?? (chat ? (chat.kind === "direct" ? chat.roleIds[0] : undefined) : lireIdDirect(id)?.roleId);
  return agent ? `/chat?id=${encodeURIComponent(idDirect(agent, suivant, chats))}` : "/";
}

/**
 * Le serveur affiché, comme le sélecteur de serveur d'OpenBot : ce PC ou un VPS relié. Chaque serveur est un
 * espace : ses conversations (une par agent), ses projets, ses routines. On change d'espace, jamais une
 * conversation de machine ; un travail en cours continue sur la sienne.
 * `ouvert` relance la sonde ; `fermer` referme le menu qui montre les serveurs.
 */
export function useServeurs(ouvert: boolean, fermer: (rendreFocus: boolean) => void) {
  const { state, basculerMachine } = useWorkspace();
  const router = useRouter();
  const serveurs = useServeursRelies();
  const lieu = useLieuActif();
  const etats = useEtatsServeurs(serveurs, ouvert);
  const [demander, fenetre] = useConfirmation();

  const actif = serveurs.find((s) => s.adresse === lieu) ?? null;
  const nom = nomLieu(lieu, serveurs);
  const sonde = actif ? etats[actif.adresse]?.sonde : undefined;
  const etatActif = actif ? libelleServeur("joint", sonde, etats[actif.adresse]?.agents, etats[actif.adresse]?.retard) : "Les agents tournent ici";
  const { chats, messages } = state;
  const nonLus = useMemo(() => nonLusParServeur({ chats, messages }), [chats, messages]);

  const choisir = (suivant: string | null) => {
    fermer(true);
    if (suivant === lieu) return;
    const page = pageSurServeur(state.chats, suivant);
    basculerMachine(suivant);
    if (page) router.push(page);
  };

  const retirerActif = async () => {
    if (!actif) return;
    fermer(false);
    const ok = await demander({
      titre: `Retirer ${actif.nom} ?`,
      texte: "L’app oublie ce serveur et son accès, et revient sur ce PC. Ses conversations restent dans l’app, sans agent pour y répondre. Pour le relier à nouveau, il faudra relancer la commande sur le VPS.",
      confirmer: "Retirer",
    });
    if (!ok) return;
    void retirer(actif.adresse);
    modifierCarnet((carnet) => retirerServeur(carnet, actif.id));
    const page = pageSurServeur(state.chats, null);
    basculerMachine(null);
    if (page) router.push(page);
  };

  return { serveurs, actif, nom, sonde, etatActif, etats, nonLus, choisir, retirerActif, fenetre };
}

export type Serveurs = ReturnType<typeof useServeurs>;

/** Le point d'état du serveur actif, pour l'afficher hors du menu. */
export { Point as PointServeur };

/** Le contenu du menu Serveurs : Ce PC et les VPS reliés à cocher, puis les actions sur la machine active. */
export function ListeServeurs({ s, aller }: { s: Serveurs; aller: (chemin: string) => void }) {
  const { serveurs, actif, etats, nonLus, choisir, retirerActif } = s;
  return (
    <>
      <p className="m-0 px-2 pt-1 pb-1 text-ui-xs text-texte-tertiaire">Serveurs</p>
      <Choix
        choisi={!actif}
        icone="computer"
        nom="Ce PC"
        detail="Les agents tournent ici"
        nonLus={nonLus[""]}
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
            detail={libelleServeur("joint", etat?.sonde, etat?.agents, etat?.retard)}
            sonde={etat?.sonde ?? "attente"}
            nonLus={nonLus[serveur.adresse]}
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
