"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { carteAgent, carteProjet, conversationCompte, decoupages, messageCompte } from "@/lib/copie-compte";
import { useAgents } from "@/lib/agents";
import { useWorkspace } from "@/lib/workspace";

/**
 * L'ordinateur envoie ses conversations au compte, par lots, et reprend les
 * messages écrits sur le téléphone. La copie locale n'est pas effacée.
 * Le téléphone ne monte pas ce composant.
 */
export function SyncCompte({ actif }: { actif: boolean }) {
  const { state, sendMessage } = useWorkspace();
  const { tous } = useAgents();
  const importerConversations = useMutation(api.conversationsCompte.importerConversations);
  const alignerConversations = useMutation(api.conversationsCompte.alignerConversations);
  const importerMessages = useMutation(api.conversationsCompte.importerMessages);
  const importerAgents = useMutation(api.conversationsCompte.importerAgents);
  const importerProjets = useMutation(api.conversationsCompte.importerProjets);
  const prendre = useMutation(api.conversationsCompte.prendre);
  const enAttente = useQuery(api.conversationsCompte.enAttente, actif ? {} : "skip");
  const pris = useRef(new Set<string>());
  const signature = useRef("");

  useEffect(() => {
    if (!actif || !enAttente) return;
    let arrete = false;
    void (async () => {
      for (const message of enAttente) {
        if (arrete || pris.current.has(message._id)) continue;
        pris.current.add(message._id);
        const recu = await prendre({ id: message._id });
        if (!recu || arrete) continue;
        const to = recu.conversationOrigine.startsWith("dm-") ? recu.conversationOrigine.slice(3) : null;
        sendMessage(recu.conversationOrigine, recu.texte, to);
      }
    })();
    return () => {
      arrete = true;
    };
  }, [actif, enAttente, prendre, sendMessage]);

  useEffect(() => {
    if (!actif || !state.charge) return;
    const empreinte = `${state.chats.length}:${state.messages.length}:${state.projects.length}:${tous.length}:${state.chats[0]?.updatedAt ?? ""}`;
    if (empreinte === signature.current) return;
    signature.current = empreinte;
    const minuteur = setTimeout(() => {
      void (async () => {
        try {
          const conversations = state.chats.map((chat) => conversationCompte(chat, state.messages, state.projects));
          for (const lot of decoupages(conversations, 40)) await importerConversations({ lot });
          await alignerConversations({ origines: state.chats.map((chat) => chat.id).slice(0, 2000) });
          const messages = state.messages.map(messageCompte);
          for (const lot of decoupages(messages, 25)) await importerMessages({ lot });
          const agents = tous.map((agent) => carteAgent(agent.role, agent.statut === "actif" || agent.role.id === "principal"));
          for (const lot of decoupages(agents, 50)) await importerAgents({ lot });
          const projets = state.projects.map(carteProjet);
          for (const lot of decoupages(projets, 50)) await importerProjets({ lot });
        } catch {
          signature.current = "";
        }
      })();
    }, 1500);
    return () => clearTimeout(minuteur);
  }, [actif, alignerConversations, importerAgents, importerConversations, importerMessages, importerProjets, state, tous]);

  return null;
}
