"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EFFORTS, MODELES } from "@/components/chat/ChoixModele";
import { lireClePoste } from "./SignalPoste";
import { carteAgent, carteProjet, changements, conversationCompte, decoupages, messageCompte } from "@/lib/copie-compte";
import { teinteNouvelAgent, useAgents } from "@/lib/agents";
import { plierAteliers } from "@/lib/atelier-agent";
import type { ContexteAtelier } from "@/lib/copie-compte";
import { getBridge } from "@/lib/bridge";
import { FORMATS_IMAGE } from "@/lib/collage";
import { findMention } from "@/lib/mentions";
import { lireOptions, pourCePoste } from "@/lib/telephone/options";
import { FIL, useWorkspace } from "@/lib/workspace";
import type { Message } from "@/types/domain";

/** Pendant qu'un agent écrit, la copie part plus souvent : le téléphone voit la réponse s'écrire. */
const DELAI_ECRITURE_MS = 800;
const DELAI_REPOS_MS = 1500;
const ID_FIL = new RegExp(`^${FIL}[0-9a-f]{8}$`);
const ID_CONVERSATION = /^[0-9a-f-]{36}$/;

type Copie = ReturnType<typeof messageCompte>;
type PieceRecue = { nom: string; type: string; taille: number; url: string };

/** Écrit sur le disque les pièces venues du téléphone ; celles qui n'ont pas pu l'être sont nommées. */
async function ecrirePieces(pieces: PieceRecue[]): Promise<{ chemins: string[]; manquees: string[] }> {
  const bridge = getBridge();
  const chemins: string[] = [];
  const manquees: string[] = [];
  for (const piece of pieces) {
    try {
      const reponse = await fetch(piece.url);
      if (!reponse.ok) throw new Error("telechargement");
      const octets = new Uint8Array(await reponse.arrayBuffer());
      const ecrit = bridge?.fichiers.recevoirPiece
        ? await bridge.fichiers.recevoirPiece(octets, piece.nom)
        : bridge?.fichiers.enregistrerCollage && FORMATS_IMAGE.includes(piece.type)
          ? await bridge.fichiers.enregistrerCollage(octets, piece.type)
          : null;
      if (ecrit?.ok) chemins.push(ecrit.data);
      else manquees.push(piece.nom);
    } catch {
      manquees.push(piece.nom);
    }
  }
  return { chemins, manquees };
}

/**
 * L'ordinateur envoie ses conversations au compte, et reprend ce que le téléphone y a laissé :
 * les messages (`messagesFile`, avec leurs options et leurs pièces) et les gestes sur les
 * conversations (`operationsFile`), mêlés dans l'ordre où ils ont été faits. La file est vidée
 * avant la première copie, pour qu'un geste du téléphone ne soit pas écrasé par l'état d'avant.
 * La copie n'envoie que ce qui a changé ; plus souvent pendant qu'un agent écrit.
 * Rien d'absolu ni de secret ne part (`src/lib/copie-compte.ts`). Le téléphone ne monte pas ce composant.
 */
export function SyncCompte({ actif }: { actif: boolean }) {
  const workspace = useWorkspace();
  const { state } = workspace;
  const agents = useAgents();
  const importerConversations = useMutation(api.conversationsCompte.importerConversations);
  const alignerConversations = useMutation(api.conversationsCompte.alignerConversations);
  const importerMessages = useMutation(api.conversationsCompte.importerMessages);
  const importerAgents = useMutation(api.conversationsCompte.importerAgents);
  const importerProjets = useMutation(api.conversationsCompte.importerProjets);
  const prendreMessage = useMutation(api.conversationsCompte.prendre);
  const terminerMessage = useMutation(api.conversationsCompte.terminer);
  const prendreOperation = useMutation(api.operationsFile.prendre);
  const enAttente = useQuery(api.conversationsCompte.enAttente, actif ? {} : "skip");
  const operations = useQuery(api.operationsFile.aRejouer, actif ? {} : "skip");

  /* Les derniers état et gestes, pour les boucles asynchrones. */
  const courant = useRef({ workspace, agents });
  useEffect(() => {
    courant.current = { workspace, agents };
  });

  /* ─── Reprendre la file du téléphone ─────────────────────────── */

  const vus = useRef(new Set<string>());
  const suite = useRef<Promise<void>>(Promise.resolve());
  const fileVidee = useRef(false);
  /* Les conversations créées par la file avant le prochain rendu (l'état lu ici ne les a pas encore). */
  const crees = useRef(new Set<string>());

  const reprendreMessage = useCallback(
    async (id: Id<"messagesFile">) => {
      const recu = await prendreMessage({ id });
      if (!recu) return;
      try {
        const { workspace: w, agents: a } = courant.current;
        const options = lireOptions(recu.options);
        const chatId = recu.conversationOrigine;
        const { chemins, manquees } = await ecrirePieces(recu.pieces ?? []);
        const texte = manquees.length ? `${recu.texte}\n\n(Pièce jointe non reçue : ${manquees.join(", ")})` : recu.texte;
        const existe = crees.current.has(chatId) || w.state.chats.some((c) => c.id === chatId);
        const actifs = a.roles;
        const direct = chatId.startsWith("dm-") || chatId.startsWith(FIL);
        const destinataire = direct ? null : actifs.some((r) => r.id === options.a) ? options.a! : findMention(texte, actifs);
        const modele = options.modele === null ? null : MODELES.find((m) => m.id === options.modele)?.id;
        const effort = options.effort === null ? null : EFFORTS.find((e) => e.id === options.effort)?.id;

        if (options.nouveau && !existe) {
          const projet = w.state.projects.find((p) => p.id === options.nouveau!.projetId);
          if (projet && ID_CONVERSATION.test(chatId)) {
            w.startChat(projet.id, texte, destinataire, chemins, chatId);
            crees.current.add(chatId);
          }
          return;
        }
        if (options.reessayer) {
          const modeleReessai = MODELES.find((m) => m.id === options.reessayer!.modele)?.id;
          w.reessayer(chatId, options.reessayer.messageId, options.reessayer.facon, modeleReessai);
          return;
        }
        if (options.brancher) {
          w.brancher(chatId, options.brancher.messageId);
          return;
        }
        if (modele !== undefined && "modele" in options) w.choisirModele(chatId, modele, modele === "haiku" ? null : (effort ?? null));
        w.sendMessage(chatId, texte, destinataire, chemins, options.citation);
      } finally {
        /* Écrit sur ce disque ou abandonné : les pièces quittent le compte. */
        await terminerMessage({ id }).catch(() => undefined);
      }
    },
    [prendreMessage, terminerMessage],
  );

  const rejouerOperation = useCallback(
    async (id: Id<"operationsFile">) => {
      const operation = await prendreOperation({ id });
      if (!operation?.conversationOrigine) return;
      const { workspace: w, agents: a } = courant.current;
      const chatId = operation.conversationOrigine;
      let valeur: Record<string, unknown> = {};
      try {
        valeur = JSON.parse(operation.valeur) as Record<string, unknown>;
      } catch {
        return;
      }
      const chat = w.state.chats.find((c) => c.id === chatId) ?? (crees.current.has(chatId) ? { fil: true } : undefined);
      switch (operation.type) {
        case "renommer":
          if (chat && typeof valeur.titre === "string") w.renommerChat(chatId, valeur.titre);
          return;
        case "epingler":
          if (chat) w.epinglerChat(chatId, valeur.epingle === true);
          return;
        case "creerFil":
          if (!chat && ID_FIL.test(chatId) && a.roles.some((r) => r.id === valeur.roleId)) {
            // Le téléphone ne voit que les conversations de ce PC (`dm-<agent>`) : le fil y reste.
            w.creerFil(valeur.roleId as string, typeof valeur.titre === "string" ? valeur.titre : undefined, null, undefined, { id: chatId, lieu: null });
            crees.current.add(chatId);
          }
          return;
        case "archiverFil":
          if (chat?.fil) w.archiverFil(chatId, valeur.supprime === true);
          return;
        case "rouvrirFil":
          if (chat?.fil) w.rouvrirFil(chatId);
          return;
        case "lu":
          if (chat) w.marquerLu(chatId);
          return;
        case "reagir": {
          /* L'état voulu, pas une bascule : un geste rejoué ne retire pas ce qu'il a mis. */
          const message = w.state.messages.find((m) => m.id === valeur.messageId && m.chatId === chatId);
          if (message && typeof valeur.emoji === "string" && (message.reactions?.includes(valeur.emoji) ?? false) !== (valeur.mise === true)) w.reagir(message.id, valeur.emoji);
          return;
        }
      }
    },
    [prendreOperation],
  );

  /* ─── Copier l'ordinateur dans le compte ─────────────────────── */

  const envoyes = useRef({ conversations: new Map<string, string>(), messages: new Map<string, string>(), agents: new Map<string, string>(), projets: new Map<string, string>(), origines: "" });
  const copies = useRef(new WeakMap<Message, { dossier: string | null; copie: Copie }>());
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enCours = useRef(false);
  const relancer = useRef(false);
  const copierRef = useRef<() => Promise<void>>(async () => undefined);

  /* Au plus une copie par délai : pendant qu'un agent écrit, l'état change sans cesse, la copie part quand même. */
  const programmer = useCallback((delai: number) => {
    if (minuteur.current) return;
    minuteur.current = setTimeout(() => {
      minuteur.current = null;
      void copierRef.current();
    }, delai);
  }, []);

  const copier = useCallback(async () => {
    if (enCours.current) {
      relancer.current = true;
      return;
    }
    enCours.current = true;
    relancer.current = false;
    const { workspace: w, agents: a } = courant.current;
    const { chats, messages, projects, travail } = w.state;
    const memo = envoyes.current;
    try {
      const parChat = new Map<string, Message[]>();
      for (const m of messages) {
        const liste = parChat.get(m.chatId);
        if (liste) liste.push(m);
        else parChat.set(m.chatId, [m]);
      }
      const dossiers = new Map(chats.map((c) => [c.id, projects.find((p) => p.id === c.projectId)?.folder || null]));

      const conversations = chats.flatMap((chat) => conversationCompte(chat, parChat.get(chat.id) ?? [], projects, travail[chat.id] ?? null) ?? []);
      const c = changements(conversations, (x) => x.origine, memo.conversations);
      for (const lot of decoupages(c.lot, 40)) await importerConversations({ lot });
      for (const [k, v] of c.empreintes) memo.conversations.set(k, v);
      const origines = conversations.map((x) => x.origine).slice(0, 2000);
      if (origines.join("\n") !== memo.origines) {
        await alignerConversations({ origines });
        memo.origines = origines.join("\n");
      }

      /* L'atelier d'un agent : la carte de chaque appel dépend de toute la conversation (et des agents
         actifs) ; ces messages-là sont recalculés à chaque copie, seuls les changés repartent. */
      const ateliers = new Map<string, ContexteAtelier>();
      const atelierDe = (chatId: string): ContexteAtelier => {
        let contexte = ateliers.get(chatId);
        if (!contexte) {
          contexte = {
            etats: plierAteliers(parChat.get(chatId) ?? []),
            roles: a.roles,
            teinteDe: teinteNouvelAgent,
            vps: !!chats.find((c) => c.id === chatId)?.lieu,
          };
          ateliers.set(chatId, contexte);
        }
        return contexte;
      };
      const copiesMessages = messages.map((m) => {
        const dossier = dossiers.get(m.chatId) ?? null;
        if (m.parts.some((p) => p.type === "atelier-agent")) return messageCompte(m, dossier, atelierDe(m.chatId));
        const deja = copies.current.get(m);
        if (deja && deja.dossier === dossier) return deja.copie;
        const copie = messageCompte(m, dossier);
        copies.current.set(m, { dossier, copie });
        return copie;
      });
      const m = changements(copiesMessages, (x) => x.origine, memo.messages);
      for (const [i, lot] of decoupages(m.lot, 25).entries()) {
        await importerMessages({ lot });
        for (const [k, v] of m.empreintes.slice(i * 25, i * 25 + lot.length)) memo.messages.set(k, v);
      }

      /* L'assistant n'a pas de fiche : sa carte vient de `roles[0]` (nom et couleur choisis). */
      const assistant = a.roles[0];
      const cartes = [carteAgent(assistant, true), ...a.tous.filter((agent) => agent.role.id !== assistant.id).map((agent) => carteAgent(agent.role, agent.statut === "actif"))];
      const ag = changements(cartes, (x) => x.origine, memo.agents);
      for (const lot of decoupages(ag.lot, 50)) await importerAgents({ lot });
      for (const [k, v] of ag.empreintes) memo.agents.set(k, v);

      const p = changements(projects.map(carteProjet), (x) => x.origine, memo.projets);
      for (const lot of decoupages(p.lot, 50)) await importerProjets({ lot });
      for (const [k, v] of p.empreintes) memo.projets.set(k, v);
    } catch {
      /* Le compte n'a pas répondu : ce qui n'est pas marqué envoyé repartira à la prochaine copie. */
      relancer.current = true;
    } finally {
      enCours.current = false;
      if (relancer.current) programmer(DELAI_REPOS_MS);
    }
  }, [alignerConversations, importerAgents, importerConversations, importerMessages, importerProjets, programmer]);
  useEffect(() => {
    copierRef.current = copier;
  }, [copier]);

  useEffect(() => {
    if (!actif || !enAttente || !operations || !state.charge || agents.status === "chargement") return;
    const cle = lireClePoste();
    const file = [
      ...enAttente.filter((m) => pourCePoste(lireOptions(m.options), cle)).map((m) => ({ genre: "message" as const, id: m._id as string, creeLe: m.creeLe })),
      ...operations.map((o) => ({ genre: "operation" as const, id: o._id as string, creeLe: o.creeLe })),
    ]
      .filter((e) => !vus.current.has(e.id))
      .sort((a, b) => a.creeLe - b.creeLe);
    for (const e of file) vus.current.add(e.id);
    /* Un seul passage à la fois, dans l'ordre : un nouveau fil est créé avant le message qui y part. */
    suite.current = suite.current.then(async () => {
      for (const e of file) {
        try {
          if (e.genre === "message") await reprendreMessage(e.id as Id<"messagesFile">);
          else await rejouerOperation(e.id as Id<"operationsFile">);
        } catch {
          /* Un élément illisible ne bloque pas les suivants. */
        }
      }
      if (!fileVidee.current) {
        fileVidee.current = true;
        programmer(0);
      }
    });
  }, [actif, enAttente, operations, state.charge, agents.status, reprendreMessage, rejouerOperation, programmer]);

  useEffect(() => {
    if (!actif || !state.charge || !fileVidee.current) return;
    programmer(Object.keys(state.travail).length ? DELAI_ECRITURE_MS : DELAI_REPOS_MS);
  }, [actif, state, agents.tous, agents.roles, programmer]);

  /* Un autre compte, ou plus de compte : tout repart de zéro. */
  useEffect(() => {
    if (actif) return;
    envoyes.current = { conversations: new Map(), messages: new Map(), agents: new Map(), projets: new Map(), origines: "" };
    vus.current.clear();
    crees.current.clear();
    fileVidee.current = false;
  }, [actif]);

  useEffect(
    () => () => {
      if (minuteur.current) clearTimeout(minuteur.current);
    },
    [],
  );

  return null;
}
