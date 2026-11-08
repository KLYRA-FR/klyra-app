"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Icon } from "@/components/icons/Icon";
import { Onglets } from "@/components/ui/Onglets";
import { hoteDe, useLieuActif } from "@/lib/lieux";
import { texteDe, useProjects, useWorkspace } from "@/lib/workspace";
import { CerveauGestion } from "./CerveauGestion";
import { GrapheCommun } from "./GrapheCommun";

type VueMemoire = "graphe" | "liste" | "notes";

export function MemoireScreen() {
  const lieu = useLieuActif(), projets = useProjects(), router = useRouter(), params = useSearchParams();
  const { state } = useWorkspace();
  const chatId = params.get("chat"), messageId = params.get("message");
  const vueDemandee = params.get("vue");
  const vue: VueMemoire = vueDemandee === "liste" || vueDemandee === "notes" ? vueDemandee : "graphe";
  const capture = useMemo(() => {
    const chat = state.chats.find((c) => c.id === chatId && (c.lieu ?? null) === lieu);
    const message = state.messages.find((m) => m.id === messageId && m.chatId === chatId);
    if (!chat || !message || !texteDe(message).trim()) return null;
    const contenu = texteDe(message);
    return { contenu, projetId: chat.projectId ?? chat.fil?.projetId ?? null, source: { chatId: chat.id, messageId: message.id, titre: chat.title, extrait: contenu } };
  }, [state.chats, state.messages, chatId, messageId, lieu]);
  const notes = <CerveauGestion key={`${lieu}:${capture?.source.messageId ?? "libre"}`} lieu={lieu} projets={projets} capture={capture} ouvrirSource={(source) => {
    const chat = state.chats.find((c) => c.id === source.chatId && (c.lieu ?? null) === lieu);
    if (!chat || !state.messages.some((m) => m.id === source.messageId && m.chatId === chat.id)) throw new Error("Le message source n’est plus disponible. L’extrait d’origine reste conservé dans cette note.");
    router.push(`/chat?id=${encodeURIComponent(source.chatId)}&message=${encodeURIComponent(source.messageId)}`);
  }} captureTerminee={() => { if (capture) router.replace("/memoire?vue=notes"); }} />;
  // « Garder en mémoire » depuis une conversation ouvre directement le formulaire de l'écran des notes.
  if (capture) return notes;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="@container flex min-h-0 flex-1 flex-col gap-4 px-5 pt-5 pb-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
              <span className="font-semibold">Mémoire</span> <span className="font-normal">de l’équipe</span>
            </h1>
            <p className="m-0 text-ui-s text-texte-secondaire">Ce que tes agents savent, ce qu’ils ont produit et d’où ça vient, au même endroit. Les fichiers restent à leur place.</p>
            <p className="m-0 text-ui-2xs text-texte-tertiaire">{lieu ? hoteDe(lieu) : "Ce PC"}</p>
          </div>
          <Onglets<VueMemoire>
            libelle="Vues de la mémoire"
            valeur={vue}
            onChange={(v) => router.replace(v === "graphe" ? "/memoire" : `/memoire?vue=${v}`)}
            onglets={[
              { id: "graphe", label: "Graphe", icone: <Icon name="shuffle" size={16} /> },
              { id: "liste", label: "Liste", icone: <Icon name="list" size={16} /> },
              { id: "notes", label: "Notes et sources", icone: <Icon name="note-01" size={16} /> },
            ]}
          />
        </header>
        {vue === "notes" ? <div className="min-h-0 flex-1 overflow-hidden rounded-2xl">{notes}</div> : <GrapheCommun key={lieu ?? "pc"} lieu={lieu} vue={vue} />}
      </div>
    </div>
  );
}
