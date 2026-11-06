"use client";

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { IconName } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { messageErreur, useCompte } from "@/lib/compte";
import { useGestePoste } from "@/lib/poste/client";
import { majuscule } from "@/lib/poste-texte";
import { actionsConversation, activiteDe, agentDe, LIBELLES_CONVERSATION, type ActionConversation, type ConversationLue } from "@/lib/telephone/chats";
import { exporterDepuisLeCompte, partagerDocument } from "@/lib/telephone/export";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { Feuille, MenuFeuille, useAppuiLong, type ActionMenu } from "./Feuille";
import { GrappeChat, RondAgent, useCartes } from "./AgentsChat";
import { CHAMP_TELEPHONE, MessageErreur } from "./Controles";
import { TuileIcone } from "./Liste";
import { usePostes, useSupport } from "./poste";
import { activiteOccupe } from "@/lib/copie-compte";

/**
 * L'appui long d'une ligne ou d'une puce qui est aussi un lien : il ouvre le menu (M-9), et le
 * toucher qui suit n'ouvre pas en plus la conversation. Ni loupe ni menu du système sur le lien.
 */
export function useAppuiMenu(onMenu: () => void) {
  const long = useRef(false);
  const appui = useAppuiLong(() => {
    long.current = true;
    onMenu();
  });
  return {
    ...appui,
    onPointerDown: (e: React.PointerEvent) => {
      long.current = false;
      appui.onPointerDown(e);
    },
    onClick: (e: MouseEvent) => {
      if (!long.current) return;
      long.current = false;
      e.preventDefault();
    },
    className: "select-none [-webkit-touch-callout:none]",
  };
}

export const CHAMP = CHAMP_TELEPHONE;

const ICONES: Record<ActionConversation, IconName> = {
  details: "layout-right",
  renommer: "pencil-01",
  epingler: "pin-01",
  desepingler: "pin-off-01",
  exporter: "download-02",
  projet: "projets-dossier",
  rechercher: "search-01",
  lu: "check-01",
  arreter: "square",
  reglages: "user-profile-01",
};

/**
 * « Renommer » en feuille (E2-09) : le nom actuel, prêt à être changé (texte 16 px), 80 caractères au plus.
 * La feuille ne se ferme qu'une fois le compte d'accord ; une erreur y reste, le nom saisi aussi.
 */
export function FeuilleRenommer({ titre, valeur, onValider, onFermer }: { titre: string; valeur: string; onValider: (titre: string) => Promise<unknown>; onFermer: () => void }) {
  const sur = useSupport();
  const [texte, setTexte] = useState(valeur);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const propre = texte.replace(/\s+/g, " ").trim();
  const valable = !!propre && propre !== valeur && !occupe;
  const valider = () => {
    if (!valable) return;
    setOccupe(true);
    setErreur(null);
    onValider(propre).then(onFermer, (err: unknown) => {
      setOccupe(false);
      setErreur(messageErreur(err));
    });
  };
  return (
    <Feuille
      titre={titre}
      onFermer={onFermer}
      pied={
        <Bouton variant="sombre" className="h-11 w-full text-body-s" disabled={!valable} onClick={valider}>
          Renommer
        </Bouton>
      }
    >
      <input
        data-autofocus
        aria-label="Nom"
        aria-invalid={!!erreur}
        value={texte}
        maxLength={80}
        onChange={(e) => setTexte(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) valider();
        }}
        className={CHAMP}
      />
      {erreur ? <MessageErreur className="mt-2">{erreur}</MessageErreur> : <p className="mt-2 text-ui-xs text-texte-secondaire">Le nom change aussi sur {sur}.</p>}
    </Feuille>
  );
}

/**
 * Le menu d'une conversation (spec T-01 appui long ou « ⋯ » sur une ligne, T-02 « ⋯ » de l'en-tête) :
 * « Détails », « Renommer », « Épingler » / « Retirer l'épingle » (Compte : tout de suite dans le compte,
 * puis sur l'ordinateur à son ouverture), « Exporter en Markdown… » (préparé sur le téléphone), « Ouvrir le projet ».
 */
export function useMenuChat({ onDetails, onBandeau }: { onDetails?: () => void; onBandeau: (texte: string) => void }) {
  const router = useRouter();
  const convex = useConvex();
  const { moi } = useCompte();
  const { cartes, nom } = useCartes();
  const annoncer = useAnnonce();
  const horsLigne = useHorsLigne();
  const { ouvert } = usePostes();
  const sur = useSupport();
  const arret = useGestePoste();
  const renommer = useMutation(api.operationsFile.renommer);
  const epingler = useMutation(api.operationsFile.epingler);
  const marquerLu = useMutation(api.operationsFile.marquerLu);
  const [menu, setMenu] = useState<{ origine: string; conversation: ConversationLue | undefined; dansLeFil: boolean } | null>(null);
  const [renommage, setRenommage] = useState<ConversationLue | null>(null);

  const exporter = async (origine: string, conversation: ConversationLue | undefined) => {
    try {
      const { messages } = await convex.query(api.conversationsCompte.messages, { origine });
      const document = exporterDepuisLeCompte({ conversation, origine, messages, cartes: cartes ?? [], moi: moi?.nom ?? "Moi", maintenant: new Date() });
      if (!document) return onBandeau("Pas encore de message à exporter.");
      const fait = await partagerDocument(document);
      if (fait === "copie") onBandeau("Conversation copiée en Markdown.");
      if (fait === "impossible") onBandeau("Export impossible sur ce téléphone.");
    } catch (err) {
      onBandeau(messageErreur(err));
    }
  };

  const agir = (geste: Promise<unknown>, succes?: string) =>
    void geste.then(
      () => {
        if (succes) annoncer(succes);
      },
      (err: unknown) => annoncer({ texte: messageErreur(err), erreur: true }),
    );

  /* Arrêter (E2-08, E2-44) : l'ordinateur reçoit la demande ; l'état affiché suit ce qu'il copie ensuite, pas ce bouton. */
  const arreter = async (origine: string) => {
    const r = await arret.faire("fil.arreter", { conversation: origine });
    if (r.ok) annoncer("Arrêt demandé");
    else annoncer({ texte: r.code === "delai" ? `${majuscule(sur)} ne répond pas.` : r.message || "L’agent n’a pas pu être arrêté.", erreur: true });
  };

  const actions = (origine: string, conversation: ConversationLue | undefined, dansLeFil: boolean): ActionMenu[] => {
    const activite = activiteDe(conversation);
    const actif = activiteOccupe(activite);
    const agent = agentDe(origine, conversation);
    return actionsConversation(conversation, { dansLeFil, actif }).map((action): ActionMenu => {
      const libelle = LIBELLES_CONVERSATION[action];
      const icone = ICONES[action];
      const reseau = horsLigne ? { desactivee: true, note: "Possible quand ce téléphone est en ligne" } : {};
      switch (action) {
        case "details":
          return { libelle, icone, onChoisir: () => onDetails?.() };
        case "lu":
          return { libelle, icone, ...reseau, onChoisir: () => agir(marquerLu({ conversationOrigine: origine })) };
        case "renommer":
          return { libelle: conversation?.parent ? "Renommer le fil…" : libelle, icone, ...reseau, onChoisir: () => setRenommage(conversation ?? null) };
        case "epingler":
        case "desepingler":
          return { libelle, icone, ...reseau, onChoisir: () => agir(epingler({ conversationOrigine: origine, epingle: action === "epingler" })) };
        case "exporter": {
          const vide = !conversation?.extraitLe && !conversation?.extrait;
          return { libelle, icone, desactivee: vide, note: vide ? "Pas encore de message" : undefined, onChoisir: () => void exporter(origine, conversation) };
        }
        case "projet":
          return { libelle, icone, onChoisir: () => router.push(`/projet?id=${encodeURIComponent(conversation?.projetId ?? "")}`) };
        case "rechercher":
          return { libelle: conversation?.parent ? "Rechercher dans ce fil" : libelle, icone, onChoisir: () => router.push(`/chats?vue=recherche&id=${encodeURIComponent(origine)}`) };
        case "arreter":
          return {
            libelle: activite ? `Arrêter ${nom(activite.roleId)}` : libelle,
            icone,
            desactivee: !ouvert || horsLigne,
            note: horsLigne ? "Possible quand ce téléphone est en ligne" : !ouvert ? `Possible quand ${sur} est ouvert` : undefined,
            onChoisir: () => void arreter(origine),
          };
        case "reglages":
          return { libelle: agent ? `${nom(agent)} : épingler, sourdine, masquer…` : libelle, icone, sousPage: true, separateurAvant: true, onChoisir: () => router.push(`/equipe?agent=${encodeURIComponent(agent ?? "")}`) };
      }
    });
  };

  /* C-2h : le titre de la conversation ou le nom de l'agent, jamais son identifiant (« c-relances »). */
  const titreDe = (origine: string, conversation: ConversationLue | undefined) =>
    conversation && (conversation.kind === "equipe" || conversation.parent)
      ? conversation.titre
      : origine.startsWith("dm-")
        ? nom(origine.slice(3))
        : conversation?.titre || "Cette conversation";

  /* L'en-tête du menu : qui, et le projet ou le fil ; jamais un identifiant. */
  const objetDe = (origine: string, conversation: ConversationLue | undefined) => {
    const agent = agentDe(origine, conversation);
    const equipe = conversation?.kind === "equipe";
    return {
      visuel: equipe ? <GrappeChat roleIds={conversation.roleIds} /> : conversation?.parent ? <TuileIcone icone="git-branch-02" /> : <RondAgent id={agent ?? conversation?.roleIds[0] ?? "principal"} taille={36} />,
      sous: equipe
        ? [conversation.projetNom, conversation.roleIds.length > 1 ? `${conversation.roleIds.length} agents` : null].filter(Boolean).join(" · ")
        : conversation?.parent && agent
          ? `Fil de ${nom(agent)}${activiteDe(conversation) ? " · en cours" : ""}`
          : undefined,
    };
  };

  const rendu: ReactNode = (
    <>
      {menu ? (
        <MenuFeuille
          titre={titreDe(menu.origine, menu.conversation)}
          objet={objetDe(menu.origine, menu.conversation)}
          onFermer={() => setMenu(null)}
          actions={actions(menu.origine, menu.conversation, menu.dansLeFil)}
        />
      ) : null}
      {renommage ? (
        <FeuilleRenommer
          titre={renommage.parent ? "Renommer le fil" : "Renommer la conversation"}
          valeur={renommage.titre}
          onFermer={() => setRenommage(null)}
          onValider={(titre) => renommer({ conversationOrigine: renommage.origine, titre }).then(() => annoncer(`Renommée : ${titre}`))}
        />
      ) : null}
    </>
  );

  return {
    ouvrir: (origine: string, conversation: ConversationLue | undefined, dansLeFil = false) => setMenu({ origine, conversation, dansLeFil }),
    exporter,
    rendu,
  };
}
