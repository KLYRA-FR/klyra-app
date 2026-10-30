"use client";

import { useCallback, useMemo, useState } from "react";
import { useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { getBridge } from "@/lib/bridge";
import { preparerExport } from "@/lib/export-conversation";
import { useWorkspace } from "@/lib/workspace";
import type { Chat, Project } from "@/types/domain";

export type RetourExport =
  | { type: "succes"; chemin: string; nom: string }
  | { type: "erreur"; raison: string };
export interface ActionExport {
  vide: boolean;
  lancer: (bouton: HTMLButtonElement | null) => void;
}

/** Un seul dialogue, même si une autre conversation est ouverte entre-temps. */
let enCours = false;

function raisonExport(code: string): string {
  if (["EACCES", "EPERM", "EROFS"].includes(code)) return "pas le droit d’écrire à cet endroit. Choisis un autre dossier.";
  if (code === "ENOSPC") return "plus de place sur le disque.";
  if (code === "EBUSY") return "le fichier est ouvert dans une autre application. Ferme-le ou choisis un autre nom.";
  if (code === "EXPORT_TROP_LONG") return "la conversation est trop longue pour un seul fichier.";
  return "le fichier n’a pas pu être enregistré.";
}

export function useExporterConversation(chat: Chat | undefined, project: Project | undefined) {
  const { state, moi } = useWorkspace();
  const { roles, tous } = useAgents();
  const disponibles = useMemo(() => [...roles, ...tous.map((a) => a.role)], [roles, tous]);
  const bridge = getBridge();
  const [retour, setRetour] = useState<{ chatId?: string; message: RetourExport | null; numero: number }>({ message: null, numero: 0 });
  // Une navigation enlève le message, y compris si on revient ensuite au même chat.
  if (retour.chatId !== chat?.id) setRetour({ chatId: chat?.id, message: null, numero: retour.numero });
  const fermer = useCallback(() => setRetour((r) => ({ ...r, message: null })), []);

  const vide = useMemo(() => {
    if (!chat || !bridge?.conversations.exporter) return true;
    try { return preparerExport({ chat, messages: state.messages, moi, roles: disponibles, project, maintenant: new Date() }) === null; }
    // Une erreur de préparation doit rester explicite au clic, pas cacher l'action.
    catch { return false; }
  }, [chat, bridge, state.messages, moi, disponibles, project]);

  const lancer = async (bouton: HTMLButtonElement | null) => {
    if (enCours || !chat || !bridge?.conversations.exporter) return;
    enCours = true;
    setRetour((r) => ({ ...r, message: null }));
    const afficher = (message: RetourExport) => {
      // Le bouton appartient à un en-tête monté avec key=chat.id : jamais le résultat d'un autre chat.
      if (!bouton?.isConnected) return;
      setRetour((r) => ({ chatId: chat.id, message, numero: r.numero + 1 }));
      annoncer(message.type === "succes" ? `Conversation exportée : ${message.nom}.` : `Export impossible : ${message.raison}`);
    };
    try {
      // Sérialisation synchrone avant tout await : rien ne peut s'ajouter pendant le sélecteur.
      const document = preparerExport({ chat, messages: state.messages, moi, roles: disponibles, project, maintenant: new Date() });
      if (!document) return;
      const reponse = await bridge.conversations.exporter(document);
      if (!reponse.ok) afficher({ type: "erreur", raison: raisonExport(reponse.code) });
      else if (reponse.data.statut === "enregistre") afficher({ type: "succes", chemin: reponse.data.chemin, nom: reponse.data.nom });
    } catch { afficher({ type: "erreur", raison: raisonExport("") }); }
    finally {
      enCours = false;
      if (bouton?.isConnected && document.activeElement !== bouton) bouton.focus({ preventScroll: true });
    }
  };

  return {
    action: bridge?.conversations.exporter ? { vide, lancer } satisfies ActionExport : undefined,
    message: retour.chatId === chat?.id ? retour.message : null,
    numero: retour.numero,
    fermer,
  };
}
