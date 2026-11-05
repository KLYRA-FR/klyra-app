"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { REACTIONS } from "../../../convex/model/reactions";
import { MODELES } from "@/components/chat/ChoixModele";
import type { IconName } from "@/components/icons/Icon";
import { ajouterAuBrouillon } from "@/lib/brouillons";
import { cn } from "@/lib/cn";
import { messageErreur } from "@/lib/compte";
import { formatDaySeparator, formatTime, isSameDay } from "@/lib/format";
import { citer, repondreA, titreDuPassage } from "@/lib/repondre";
import { actionsReponse, agentsPourFil, ASSISTANT, FACONS_REESSAI, nouvelIdFil, NOMS_REACTIONS, texteParle, type ActionReponse, type ConversationLue } from "@/lib/telephone/chats";
import { citationDuMessage, garderCitation } from "@/lib/telephone/citation";
import type { MessageLu } from "@/lib/telephone/export";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { MenuFeuille, useFermerFeuille } from "./Feuille";
import { RondAgent, useCartes } from "./AgentsChat";
import type { ContexteFil } from "./MessagesFil";

/** La réponse lue à voix haute en ce moment (une seule à la fois, comme au bureau). */
let enLecture: string | null = null;

/** En quittant la conversation, la lecture s'arrête (comme au bureau). */
export function arreterLecture() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  enLecture = null;
}

/** Lit la réponse avec la synthèse du téléphone, ou l'arrête si c'est elle qu'on entend. Faux si le téléphone ne sait pas lire. */
function basculerLecture(id: string, texte: string): boolean {
  const synthese = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synthese) return false;
  const encore = enLecture === id;
  arreterLecture();
  if (encore) return true;
  const phrase = new SpeechSynthesisUtterance(texteParle(texte));
  phrase.lang = "fr-FR";
  phrase.voice = synthese.getVoices().find((v) => v.lang.startsWith("fr")) ?? null;
  phrase.onend = phrase.onerror = () => {
    if (enLecture === id) enLecture = null;
  };
  enLecture = id;
  synthese.speak(phrase);
  return true;
}

const enTrainDeLire = (id: string) => enLecture === id;

const ICONES: Record<ActionReponse["id"], IconName> = {
  repondre: "reply-01",
  citer: "align-left",
  fil: "git-branch-02",
  copier: "copy-left",
  ecouter: "volume-01",
  reessayer: "refresh-01",
  brancher: "git-branch-01",
};

/** Les six réactions (E2-37) : une marque sur le message, qui ne déclenche aucune réponse de l'agent. */
function Reactions({ message, contexte }: { message: MessageLu; contexte: ContexteFil }) {
  const fermer = useFermerFeuille();
  return (
    <div role="group" aria-label="Réactions" className="grid grid-cols-6 gap-1.5 pt-1 pb-3">
      {REACTIONS.map((emoji) => {
        const mise = message.reactions.includes(emoji);
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={mise}
            aria-label={NOMS_REACTIONS[emoji]}
            onClick={() => {
              fermer();
              contexte.reagir(message.origine, emoji, !mise);
            }}
            className={cn(
              "flex h-12 items-center justify-center rounded-md text-[20px] leading-none transition-colors duration-[120ms] ease-sortie",
              mise ? "bg-fond-teinte-bleue ring-1 ring-bordure-forte" : "bg-fond-survol active:bg-fond-surface-grise",
            )}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Les actions d'un message (E2-37 à E2-39, E2-41), ouvertes par appui long ou « ⋯ » : préparer un
 * brouillon (répondre, citer, en faire un fil), copier, écouter, et ce qui part par la file (réessayer,
 * brancher). Une seule feuille, avec ses sous-pages ; rien n'est annoncé réussi avant son résultat.
 */
export function ActionsMessage({ message, contexte, conversation, onFermer }: { message: MessageLu; contexte: ContexteFil; conversation: ConversationLue | undefined; onFermer: () => void }) {
  const router = useRouter();
  const annoncer = useAnnonce();
  const horsLigne = useHorsLigne();
  const { cartes, nom } = useCartes();
  const creerFil = useMutation(api.operationsFile.creerFil);
  const [vue, setVue] = useState<"actions" | "reessayer" | "modeles" | "agents" | null>("actions");
  const parle = enTrainDeLire(message.origine);
  const occupe = !!contexte.activite && contexte.activite.etat !== "question";
  const agent = message.auteurKind === "role";
  const auteur = message.auteurId ?? ASSISTANT;
  const quand = `${isSameDay(message.creeLe, new Date().toISOString()) ? "Aujourd’hui" : formatDaySeparator(message.creeLe).split(" · ")[0]}, ${formatTime(message.creeLe)}`;
  const actifs = (cartes ?? []).filter((c) => c.actif || c.origine === ASSISTANT).map((c) => c.origine);
  const pourFil = agentsPourFil({ auteurId: message.auteurId, conversation, actifs });

  /* Une feuille en remplace une autre (« Changer de modèle ») : on ne ferme qu'en sortant de la dernière. */
  useEffect(() => {
    if (vue === null) onFermer();
  }, [vue, onFermer]);
  const fermer = () => setVue(null);

  const copier = () => {
    const presse = navigator.clipboard;
    if (!presse) return annoncer({ texte: "La copie n’est pas possible ici : sélectionne le texte du message.", erreur: true });
    void presse.writeText(message.texte).then(
      () => annoncer(agent ? "Réponse copiée" : "Message copié"),
      () => annoncer({ texte: "La copie n’est pas possible ici : sélectionne le texte du message.", erreur: true }),
    );
  };

  /* E2-41 : le fil naît dans le compte, sans message envoyé ; le passage attend dans son composeur. Un échec garde le geste possible. */
  const enFaireUnFil = (roleId: string) => {
    const id = nouvelIdFil();
    void creerFil({ origine: id, roleId, titre: titreDuPassage(message.texte) || undefined }).then(
      () => {
        const citation = citationDuMessage(message);
        if (citation) garderCitation(id, citation);
        else ajouterAuBrouillon(id, citer(message.texte));
        annoncer(`Fil créé pour ${nom(roleId)}`);
        router.push(`/chat?id=${encodeURIComponent(id)}`);
      },
      (err: unknown) => annoncer({ texte: messageErreur(err), erreur: true }),
    );
  };

  const choisir = (action: ActionReponse) => {
    switch (action.id) {
      case "repondre": {
        const citation = citationDuMessage(message);
        if (citation) repondreA(contexte.origine, citation);
        return;
      }
      case "citer":
        return ajouterAuBrouillon(contexte.origine, citer(message.texte));
      case "fil":
        if (pourFil.length > 1) return setVue("agents");
        if (pourFil.length === 1) enFaireUnFil(pourFil[0]);
        return;
      case "copier":
        return copier();
      case "ecouter":
        if (!basculerLecture(message.origine, message.texte)) annoncer({ texte: "La lecture à voix haute n’est pas disponible sur ce téléphone.", erreur: true });
        return;
      case "reessayer":
        return setVue("reessayer");
      case "brancher":
        contexte.envoyer(action.libelle, { brancher: { messageId: message.origine } });
        return annoncer("Branche demandée : elle arrivera dans tes chats");
    }
  };

  const noteOccupe: ReactNode = occupe ? "Ce sera fait juste après" : undefined;

  if (vue === "agents") {
    return (
      <MenuFeuille
        titre="En faire un fil pour"
        retour={() => setVue("actions")}
        onFermer={fermer}
        actions={pourFil.map((id) => ({ libelle: nom(id), icone: "user-profile-01" as const, onChoisir: () => enFaireUnFil(id) }))}
      />
    );
  }

  if (vue === "modeles") {
    return (
      <MenuFeuille
        titre="Changer de modèle"
        retour={() => setVue("reessayer")}
        onFermer={fermer}
        actions={MODELES.filter((m) => m.id !== contexte.modele).map((m) => ({
          libelle: m.nom,
          note: noteOccupe,
          onChoisir: () => {
            contexte.envoyer(`Réessayer avec ${m.nom.replace("Claude ", "")}`, { reessayer: { messageId: message.origine, facon: "reessayer", modele: m.id } });
            annoncer("Réessai demandé");
          },
        }))}
      />
    );
  }

  if (vue === "reessayer") {
    const modele = MODELES.find((m) => m.id === contexte.modele)?.nom.replace("Claude ", "");
    return (
      <MenuFeuille
        titre="Réessayer"
        sousTitre={modele ? `${modele} utilisé` : undefined}
        retour={() => setVue("actions")}
        onFermer={fermer}
        actions={[
          ...FACONS_REESSAI.map((f) => ({
            libelle: f.libelle,
            icone: f.icone,
            note: noteOccupe,
            onChoisir: () => {
              contexte.envoyer(f.libelle, { reessayer: { messageId: message.origine, facon: f.id } });
              annoncer("Réessai demandé");
            },
          })),
          { libelle: "Changer de modèle", icone: "shuffle" as const, sousPage: true, onChoisir: () => setVue("modeles") },
        ]}
      />
    );
  }

  const actions = actionsReponse({ texte: message.texte, enCours: message.statut === "en-cours", parle, agent });
  const filImpossible = pourFil.length === 0;
  return (
    <MenuFeuille
      titre={agent ? nom(auteur) : "Toi"}
      objet={agent ? { visuel: <RondAgent id={auteur} taille={36} />, sous: quand } : undefined}
      sousTitre={agent ? undefined : quand}
      entete={agent && message.statut !== "en-cours" ? <Reactions message={message} contexte={contexte} /> : undefined}
      onFermer={fermer}
      actions={actions.map((action) => ({
        libelle: action.libelle,
        icone: ICONES[action.id],
        separateurAvant: action.id === "reessayer",
        sousPage: action.id === "reessayer" || (action.id === "fil" && pourFil.length > 1),
        desactivee: (action.id === "fil" && (filImpossible || horsLigne)) || (action.voie === "file" && horsLigne),
        note:
          action.id === "fil" ? (
            horsLigne ? "Possible quand ce téléphone est en ligne" : filImpossible ? "Aucun agent actif pour ce fil" : pourFil.length === 1 ? `Un fil pour ${nom(pourFil[0])}, le passage prêt à envoyer` : undefined
          ) : action.id === "brancher" ? (
            horsLigne ? "Possible quand ce téléphone est en ligne" : "Dans une nouvelle conversation"
          ) : action.id === "reessayer" && horsLigne ? (
            "Possible quand ce téléphone est en ligne"
          ) : undefined,
        onChoisir: () => choisir(action),
      }))}
    />
  );
}
