"use client";

import { useEffect, useState } from "react";
import { MODELES } from "@/components/chat/ChoixModele";
import { formatDaySeparator, formatTime, isSameDay } from "@/lib/format";
import { actionsReponse, texteParle, type ActionReponse } from "@/lib/telephone/chats";
import type { MessageLu } from "@/lib/telephone/export";
import { MenuFeuille } from "./Feuille";
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

/**
 * Les actions d'une réponse (T-02), ouvertes par appui long sur la bulle ou « ⋯ » dessous : copier et
 * écouter sur le téléphone (Compte) ; brancher, refaire, changer de modèle partent par la file (File).
 */
export function ActionsMessage({ message, contexte, onFermer }: { message: MessageLu; contexte: ContexteFil; onFermer: () => void }) {
  const [vue, setVue] = useState<"actions" | "modeles" | null>("actions");
  const parle = enTrainDeLire(message.origine);
  const occupe = !!contexte.activite && contexte.activite.etat !== "question";
  const quand = `${isSameDay(message.creeLe, new Date().toISOString()) ? "Aujourd’hui" : formatDaySeparator(message.creeLe).split(" · ")[0]}, ${formatTime(message.creeLe)}`;

  /* Une feuille en remplace une autre (« Changer de modèle ») : on ne ferme qu'en sortant de la dernière. */
  useEffect(() => {
    if (vue === null) onFermer();
  }, [vue, onFermer]);

  const ecouter = () => {
    if (!basculerLecture(message.origine, message.texte)) contexte.onBandeau("La lecture à voix haute n’est pas disponible sur ce téléphone.");
  };

  const refaire = (action: Extract<ActionReponse, { id: "reessayer" | "details" | "concis" | "web" }>) =>
    contexte.envoyer(action.libelle, { reessayer: { messageId: message.origine, facon: action.id } });

  const choisir = (action: ActionReponse) => {
    switch (action.id) {
      case "copier":
        void navigator.clipboard
          ?.writeText(message.texte)
          .then(() => contexte.onBandeau("Réponse copiée."))
          .catch(() => contexte.onBandeau("La copie n’a pas marché sur ce téléphone."));
        return;
      case "ecouter":
        return ecouter();
      case "brancher":
        contexte.envoyer(action.libelle, { brancher: { messageId: message.origine } });
        return contexte.onBandeau("Branche demandée : elle arrivera dans tes chats.");
      case "modele":
        return setVue("modeles");
      default:
        return refaire(action);
    }
  };

  if (vue === "modeles") {
    return (
      <MenuFeuille
        titre="Changer de modèle"
        onFermer={() => setVue(null)}
        actions={MODELES.filter((m) => m.id !== contexte.modele).map((m) => ({
          libelle: m.nom,
          onChoisir: () => contexte.envoyer(`Réessayer avec ${m.nom.replace("Claude ", "")}`, { reessayer: { messageId: message.origine, facon: "reessayer", modele: m.id } }),
        }))}
      />
    );
  }

  return (
    <MenuFeuille
      titre={quand}
      onFermer={() => setVue((v) => (v === "actions" ? null : v))}
      actions={actionsReponse({ texte: message.texte, enCours: false, parle }).map((action) => ({
        libelle: action.libelle,
        onChoisir: () => choisir(action),
        note:
          action.voie === "file" && occupe && action.id !== "brancher" ? (
            <p className="text-ui-xs text-texte-secondaire">L’agent travaille : ce sera fait juste après.</p>
          ) : undefined,
      }))}
    />
  );
}
