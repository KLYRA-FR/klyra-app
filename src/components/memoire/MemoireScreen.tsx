"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useLieuActif } from "@/lib/lieux";
import { texteDe, useProjects, useWorkspace } from "@/lib/workspace";
import { CerveauGestion } from "./CerveauGestion";

export function MemoireScreen() {
  const lieu = useLieuActif(), projets = useProjects(), router = useRouter(), params = useSearchParams();
  const { state } = useWorkspace();
  const chatId = params.get("chat"), messageId = params.get("message");
  const capture = useMemo(() => {
    const chat = state.chats.find((c) => c.id === chatId && (c.lieu ?? null) === lieu);
    const message = state.messages.find((m) => m.id === messageId && m.chatId === chatId);
    if (!chat || !message || !texteDe(message).trim()) return null;
    const contenu = texteDe(message);
    return { contenu, projetId: chat.projectId ?? chat.fil?.projetId ?? null, source: { chatId: chat.id, messageId: message.id, titre: chat.title, extrait: contenu } };
  }, [state.chats, state.messages, chatId, messageId, lieu]);
  return <CerveauGestion key={`${lieu}:${capture?.source.messageId ?? "libre"}`} lieu={lieu} projets={projets} capture={capture} ouvrirSource={(source) => {
    const chat = state.chats.find((c) => c.id === source.chatId && (c.lieu ?? null) === lieu);
    if (!chat || !state.messages.some((m) => m.id === source.messageId && m.chatId === chat.id)) throw new Error("Le message source n’est plus disponible. L’extrait d’origine reste conservé dans cette note.");
    router.push(`/chat?id=${encodeURIComponent(source.chatId)}&message=${encodeURIComponent(source.messageId)}`);
  }} captureTerminee={() => { if (capture) router.replace("/memoire"); }} />;
}
