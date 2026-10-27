"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "klyra-ui";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { formatTime } from "@/lib/format";
import { texteDe, useChat, useChatMessages, useProjects, useRoles, useWorkspace } from "@/lib/workspace";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { MessageThread } from "./MessageThread";
import { PanneauLateral, usePanneauLateral } from "./PanneauLateral";
import type { DemandeApercu } from "@/components/ui/Lien";

/** « Modifié par Dev · 09:52 » : dernier journal de travail du chat. */
function useModifiedLabel(chatId: string): string | null {
  const messages = useChatMessages(chatId);
  const roles = useRoles();
  return useMemo(() => {
    const last = messages.findLast((m) => m.parts.some((p) => p.type === "worklog"));
    if (!last || last.author.kind !== "role") return null;
    const { roleId } = last.author;
    const name = roles.find((r) => r.id === roleId)?.name;
    return `Modifié par ${name} · ${formatTime(last.createdAt)}`;
  }, [messages, roles]);
}

/** Une adresse de serveur local dans un texte : « localhost:3000 », « http://127.0.0.1:5173/page ». */
const ADRESSE_LOCALE = /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s)`'"*<>]*)?/;

/** La dernière adresse locale donnée par un agent (ex. après « j'ai lancé le site »), avec son message. */
function useAdresseAnnoncee(chatId: string): { id: string; url: string } | null {
  const messages = useChatMessages(chatId);
  return useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.author.kind !== "role" || m.statut !== "fait") continue;
      const trouve = texteDe(m).match(ADRESSE_LOCALE);
      if (trouve) return { id: m.id, url: trouve[0].replace(/^https?:\/\//, "").replace(/[.,;:]+$/, "") };
    }
    return null;
  }, [messages]);
}

/** Largeur de fenêtre sous laquelle le panneau de l'agent part fermé. */
const PANNEAU_MIN_FENETRE = 1280;

export function ChatScreen() {
  const chatId = useSearchParams().get("id");
  const chat = useChat(chatId);
  const project = useProjects().find((p) => p.id === chat?.projectId);
  const [previewOpen, setPreviewOpen] = useState(true);
  const modifiedLabel = useModifiedLabel(chat?.id ?? "");
  /* Conversation directe : le panneau de l'agent (réglages, fichiers, tâches) à droite. */
  // Sous 1280 px, conversation + panneaux ne tiennent pas : le panneau part fermé.
  const [panneauOuvert, setPanneauOuvert] = useState(() => window.innerWidth >= PANNEAU_MIN_FENETRE);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < PANNEAU_MIN_FENETRE) setPanneauOuvert(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [maximise, setMaximise] = useState(false);
  const [etatPanneau, setEtatPanneau] = usePanneauLateral();
  /* Un lien local cliqué dans une conversation de projet : il s'ouvre dans l'aperçu. */
  const [adresseApercu, setAdresseApercu] = useState<{ url: string; n: number } | null>(null);
  const equipe = chat?.kind === "equipe";

  /* Un agent annonce l'adresse du site qu'il vient de lancer : l'aperçu l'ouvre tout seul,
     et le projet la garde pour la prochaine fois. */
  const { enregistrerProjet } = useWorkspace();
  const annonce = useAdresseAnnoncee(chat?.id ?? "");
  const [annonceVue, setAnnonceVue] = useState<string | null>(null);
  if (equipe && project && annonce && annonce.id !== annonceVue) {
    setAnnonceVue(annonce.id);
    setPreviewOpen(true);
    setAdresseApercu((a) => ({ url: annonce.url, n: (a?.n ?? 0) + 1 }));
  }
  useEffect(() => {
    if (!annonce || !project || !equipe) return;
    const racine = annonce.url.replace(/\/.*$/, "");
    if (project.previewUrl !== racine) enregistrerProjet({ ...project, previewUrl: racine });
  }, [annonce, project, equipe, enregistrerProjet]);

  useEffect(() => {
    if (!equipe) return;
    const prendre = (e: Event) => {
      const demande = (e as CustomEvent<DemandeApercu>).detail;
      demande.pris = true;
      setPreviewOpen(true);
      setAdresseApercu((a) => ({ url: demande.url, n: (a?.n ?? 0) + 1 }));
    };
    window.addEventListener("klyra:apercu", prendre);
    return () => window.removeEventListener("klyra:apercu", prendre);
  }, [equipe]);

  const fermerPanneau = useCallback(() => {
    setPanneauOuvert(false);
    setMaximise(false);
  }, []);

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <EmptyState
          title="Ce chat n’existe pas"
          description="Il a peut-être été supprimé. Choisis un chat récent dans la barre latérale."
          action={<BoutonPrincipal href="/">Retour à l’accueil</BoutonPrincipal>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Panneau agrandi : il prend toute la place, la conversation se cache. */}
      <section aria-label={chat.title} className={maximise ? "hidden" : "relative flex min-w-0 flex-1 flex-col"}>
        <ChatHeader
          chat={chat}
          project={project}
          previewOpen={chat.kind === "direct" ? panneauOuvert : previewOpen}
          onTogglePreview={() =>
            chat.kind === "direct" ? setPanneauOuvert((v) => !v) : setPreviewOpen((v) => !v)
          }
        />
        <MessageThread key={chat.id} chatId={chat.id} />
        <Composer key={`composer-${chat.id}`} chat={chat} project={project} />
      </section>
      {/* Conversation directe : pas de projet, donc pas d'aperçu. */}
      {previewOpen && chat.kind === "equipe" && <PreviewPanel key={project?.id} project={project} chat={chat} modifiedLabel={modifiedLabel} adresseDemandee={adresseApercu} />}
      {panneauOuvert && chat.kind === "direct" && (
        <PanneauLateral
          chat={chat}
          maximise={maximise}
          onMaximiser={() => setMaximise((v) => !v)}
          onFermer={fermerPanneau}
          etat={etatPanneau}
          setEtat={setEtatPanneau}
        />
      )}
    </div>
  );
}
