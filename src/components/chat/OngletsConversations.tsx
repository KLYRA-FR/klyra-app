"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { useRecentChats, useTravail } from "@/lib/workspace";
import type { Chat, Project } from "@/types/domain";

/** Les onglets ouverts de chaque projet : une préférence de cet écran. */
const CLE = "klyra-onglets-conversations";

function lire(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(CLE) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function ecrire(valeur: Record<string, string[]>) {
  try {
    localStorage.setItem(CLE, JSON.stringify(valeur));
  } catch {
    /* stockage indisponible : les onglets ne survivent pas à la fermeture */
  }
}

function Onglet({ chat, actif, onOuvrir, onFermer }: { chat: Chat; actif: boolean; onOuvrir: () => void; onFermer: () => void }) {
  const travail = useTravail(chat.id);
  return (
    <div
      className={cn(
        "group/onglet flex h-7 max-w-[220px] min-w-0 shrink-0 items-center gap-1.5 rounded-sm pr-1 pl-2 text-ui-xs font-medium transition-colors duration-[120ms]",
        actif ? "bg-fond-surface-grise text-texte-principal" : "text-texte-secondaire hover:bg-fond-survol",
      )}
    >
      {/* Un agent y travaille : le point respire, comme dans la barre latérale. */}
      {travail && <span aria-label="Un agent travaille" className="klyra-respire size-1.5 shrink-0 rounded-full bg-bleu-k1-500" />}
      <button
        type="button"
        role="tab"
        aria-selected={actif}
        title={chat.title}
        onClick={onOuvrir}
        onAuxClick={(e) => e.button === 1 && onFermer()}
        className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-inherit"
      >
        {chat.title}
      </button>
      <button
        type="button"
        onClick={onFermer}
        aria-label={`Fermer l’onglet ${chat.title}`}
        className={cn(
          "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-2xs border-0 bg-transparent p-0 text-icone-secondaire hover:bg-fond-survol hover:text-texte-principal",
          !actif && "invisible group-hover/onglet:visible",
        )}
      >
        <Icon name="x-01" size={12} />
      </button>
    </div>
  );
}

/**
 * Les conversations ouvertes d'un projet, en onglets au-dessus du fil, comme
 * dans VS Code : un clic passe de l'une à l'autre, la croix (ou le clic
 * molette) ferme l'onglet, le « + » lance une nouvelle conversation.
 * L'aperçu, à droite, ne bouge pas.
 */
export function OngletsConversations({ project, chatId }: { project: Project; chatId: string }) {
  const router = useRouter();
  const chats = useRecentChats().filter((c) => c.projectId === project.id);
  const [ouverts, setOuverts] = useState<string[]>(() => lire()[project.id] ?? []);

  /* L'onglet qu'on vient de fermer, le temps de quitter sa conversation. */
  const [ferme, setFerme] = useState<string | null>(null);
  /* La conversation affichée a toujours son onglet. */
  if (chatId !== ferme && !ouverts.includes(chatId)) setOuverts([...ouverts, chatId]);
  useEffect(() => {
    ecrire({ ...lire(), [project.id]: ouverts });
  }, [project.id, ouverts]);

  const onglets = ouverts.map((id) => chats.find((c) => c.id === id)).filter((c): c is Chat => !!c);

  const fermer = (id: string) => {
    const reste = ouverts.filter((o) => o !== id);
    setOuverts(reste);
    if (id !== chatId) return;
    setFerme(id);
    // L'onglet affiché se ferme : on passe à son voisin, sinon à la page du projet.
    const rang = ouverts.indexOf(id);
    const voisin = reste[Math.min(rang, reste.length - 1)];
    router.push(voisin ? `/chat?id=${encodeURIComponent(voisin)}` : `/projet?id=${encodeURIComponent(project.id)}`);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-bordure-subtile px-2">
      <div role="tablist" aria-label="Conversations ouvertes" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {onglets.map((c) => (
          <Onglet
            key={c.id}
            chat={c}
            actif={c.id === chatId}
            onOuvrir={() => router.push(`/chat?id=${encodeURIComponent(c.id)}`)}
            onFermer={() => fermer(c.id)}
          />
        ))}
      </div>
      <BoutonIcone
        taille="mini"
        icone={<Icon name="plus-01" size={16} />}
        libelle="Nouvelle conversation"
        onClick={() => router.push(`/projet?id=${encodeURIComponent(project.id)}`)}
        className="text-icone-secondaire"
      />
    </div>
  );
}
