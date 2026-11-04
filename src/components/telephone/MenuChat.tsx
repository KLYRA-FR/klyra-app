"use client";

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Bouton } from "@/components/ui/Bouton";
import { messageErreur, useCompte } from "@/lib/compte";
import { actionsConversation, LIBELLES_CONVERSATION, type ConversationLue } from "@/lib/telephone/chats";
import { exporterDepuisLeCompte, partagerDocument } from "@/lib/telephone/export";
import { Feuille, MenuFeuille, useAppuiLong, type ActionMenu } from "./Feuille";
import { useCartes } from "./AgentsChat";
import { CHAMP_TELEPHONE } from "./Controles";

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

/** « Renommer » en feuille : le nom actuel, prêt à être changé (texte 16 px). */
export function FeuilleRenommer({ titre, valeur, onValider, onFermer }: { titre: string; valeur: string; onValider: (titre: string) => void; onFermer: () => void }) {
  const [texte, setTexte] = useState(valeur);
  const propre = texte.replace(/\s+/g, " ").trim();
  return (
    <Feuille
      titre={titre}
      onFermer={onFermer}
      pied={
        <Bouton
          variant="sombre"
          className="h-11 w-full text-body-s"
          disabled={!propre || propre === valeur}
          onClick={() => {
            onFermer();
            onValider(propre);
          }}
        >
          Renommer
        </Bouton>
      }
    >
      <input
        data-autofocus
        aria-label="Nom"
        value={texte}
        maxLength={80}
        onChange={(e) => setTexte(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && propre && propre !== valeur) {
            onFermer();
            onValider(propre);
          }
        }}
        className={CHAMP}
      />
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
  const renommer = useMutation(api.operationsFile.renommer);
  const epingler = useMutation(api.operationsFile.epingler);
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

  const agir = (geste: Promise<unknown>) => void geste.catch((err: unknown) => onBandeau(messageErreur(err)));

  const actions = (origine: string, conversation: ConversationLue | undefined, dansLeFil: boolean): ActionMenu[] =>
    actionsConversation(conversation, { dansLeFil }).map((action) => {
      const libelle = LIBELLES_CONVERSATION[action];
      switch (action) {
        case "details":
          return { libelle, onChoisir: () => onDetails?.() };
        case "renommer":
          return { libelle, onChoisir: () => setRenommage(conversation ?? null) };
        case "epingler":
        case "desepingler":
          return { libelle, onChoisir: () => agir(epingler({ conversationOrigine: origine, epingle: action === "epingler" })) };
        case "exporter":
          return {
            libelle,
            desactivee: !conversation?.extraitLe && !conversation?.extrait,
            note: !conversation?.extraitLe && !conversation?.extrait ? <p className="text-ui-xs text-texte-secondaire">Pas encore de message</p> : undefined,
            onChoisir: () => void exporter(origine, conversation),
          };
        case "projet":
          return { libelle, onChoisir: () => router.push(`/projet?id=${encodeURIComponent(conversation?.projetId ?? "")}`) };
        case "rechercher":
          return { libelle, onChoisir: () => router.push(`/chats?vue=recherche&id=${encodeURIComponent(origine)}`) };
      }
    });

  /* C-2h : le titre de la conversation ou le nom de l'agent, jamais son identifiant (« c-relances »). */
  const titreDe = (origine: string, conversation: ConversationLue | undefined) =>
    conversation && (conversation.kind === "equipe" || conversation.parent)
      ? conversation.titre
      : origine.startsWith("dm-")
        ? nom(origine.slice(3))
        : conversation?.titre || "Cette conversation";

  const rendu: ReactNode = (
    <>
      {menu ? (
        <MenuFeuille titre={titreDe(menu.origine, menu.conversation)} onFermer={() => setMenu(null)} actions={actions(menu.origine, menu.conversation, menu.dansLeFil)} />
      ) : null}
      {renommage ? (
        <FeuilleRenommer
          titre="Renommer"
          valeur={renommage.titre}
          onFermer={() => setRenommage(null)}
          onValider={(titre) => agir(renommer({ conversationOrigine: renommage.origine, titre }))}
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
