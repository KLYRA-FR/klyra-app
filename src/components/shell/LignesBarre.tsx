"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { AgentRond, type StatutAgent } from "@/components/roles/AgentRond";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { formatListDate } from "@/lib/format";
import {
  idDirect,
  useAgentOccupe,
  useChatMessages,
  useChatPreview,
  useNonLus,
  useRoles,
  useTravail,
} from "@/lib/workspace";
import type { Chat, Message, Role } from "@/types/domain";

/**
 * Lignes du panneau des conversations, à la façon d'une messagerie : un rond, le nom
 * et son rôle, l'heure, et dessous le dernier message (ou ce que l'agent est
 * en train de faire).
 */

const LIGNE =
  "group/ligne flex h-[54px] items-center gap-2.5 rounded-md px-2 no-underline transition-[background-color,scale] duration-[120ms] ease-sortie active:scale-[0.99]";
const LIGNE_ACTIVE = "bg-fond-surface-grise";
const LIGNE_REPOS = "hover:bg-fond-survol";

/** Ce que l'agent fait en ce moment, tiré de la dernière étape de sa réponse. */
function etapeEnCours(messages: Message[], messageId: string): string | null {
  const message = messages.find((m) => m.id === messageId);
  if (!message) return null;
  // Une demande d'autorisation passe avant tout : l'agent est bloqué tant que tu ne réponds pas.
  if (message.parts.some((p) => p.type === "autorisation" && p.statut === "attente")) return "Attend ton accord";
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i];
    if (part.type === "text" && part.text.trim()) return "Écrit sa réponse";
    if (part.type === "passation" && part.statut === "en-cours") return "Attend un collègue";
    if (part.type === "etapes") {
      const etape = part.etapes.findLast((e) => e.statut === "en-cours" && e.parent === null);
      if (etape) return etape.libelle;
    }
  }
  return null;
}

function Corps({
  titre,
  etiquette,
  heure,
  apercu,
  enCours,
}: {
  titre: string;
  etiquette?: string;
  heure: string | null;
  apercu: string;
  enCours: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <strong className="truncate text-ui-s font-semibold text-texte-principal">{titre}</strong>
        {etiquette && (
          <span className="shrink-0 rounded-2xs bg-fond-surface-grise px-1.5 py-px text-ui-3xs font-medium text-texte-secondaire">
            {etiquette}
          </span>
        )}
        {heure && <span className="ml-auto shrink-0 pl-1 text-ui-3xs text-texte-tertiaire">{heure}</span>}
      </span>
      <span
        className={cn(
          "truncate text-ui-xs",
          enCours ? "klyra-respire font-medium text-texte-principal" : "text-texte-tertiaire",
        )}
      >
        {apercu}
      </span>
    </span>
  );
}

/** Un agent : un clic ouvre sa conversation directe. */
export function LigneAgent({ role, active }: { role: Role; active: boolean }) {
  const chatId = idDirect(role.id);
  const apercu = useChatPreview(chatId);
  const travail = useTravail(chatId);
  const messages = useChatMessages(chatId);
  const occupeAilleurs = useAgentOccupe(role.id) && !travail;
  const nonLus = useNonLus(chatId);

  const enCours = !!travail || occupeAilleurs;
  const statut: StatutAgent = enCours ? { type: "travaille" } : nonLus && !active ? { type: "non-lu", nombre: nonLus } : null;
  const texte = travail
    ? `${etapeEnCours(messages, travail.messageId) ?? "Réfléchit"}…`
    : occupeAilleurs
      ? "Travaille dans une conversation d’équipe…"
      : apercu.text || role.title;

  return (
    <Link
      href={`/chat?id=${chatId}`}
      aria-current={active ? "page" : undefined}
      className={cn(LIGNE, active ? LIGNE_ACTIVE : LIGNE_REPOS)}
    >
      <AgentRond roleId={role.id} taille={36} statut={statut} fondPastille="surface" />
      <Corps
        titre={role.name}
        etiquette={role.tag}
        heure={apercu.at ? formatListDate(apercu.at) : null}
        apercu={texte}
        enCours={enCours}
      />
    </Link>
  );
}

/** Les visages d'une conversation d'équipe, quatre au plus, dans un carré (36 px, ou 24 px en `petite`). */
export function Grappe({ chat, roles, petite = false }: { chat: Chat; roles: Role[]; petite?: boolean }) {
  const membres = chat.roleIds.map((id) => roles.find((r) => r.id === id)).filter((r): r is Role => !!r);
  const visibles = membres.length > 4 ? membres.slice(0, 3) : membres.slice(0, 4);
  const reste = membres.length - visibles.length;
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 grid-cols-2 gap-[2px] rounded-sm bg-fond-surface-grise p-[2px]", petite ? "size-6" : "size-9")}
    >
      {visibles.map((r) => {
        const { haut, encre } = AGENT_PASTELS[r.teinte];
        /* En petit, les initiales ne tiennent que dans un carré seul : sinon, les couleurs suffisent. */
        const initiale = !petite || visibles.length === 1;
        return (
          <span
            key={r.id}
            className={cn(
              "flex items-center justify-center text-ui-3xs leading-none font-semibold",
              petite ? "rounded-[3px]" : "rounded-[5px]",
              r.id === "principal" && "bg-bleu-k1-500 text-texte-inverse",
              visibles.length === 1 && cn("col-span-2 row-span-2", !petite && "text-ui-xs"),
            )}
            style={r.id === "principal" ? undefined : { background: haut, color: encre }}
          >
            {initiale && (r.id === "principal" ? "K" : r.initial)}
          </span>
        );
      })}
      {reste > 0 && (
        <span
          className={cn(
            "flex items-center justify-center bg-fond-surface text-ui-3xs leading-none font-semibold text-texte-secondaire",
            petite ? "rounded-[3px]" : "rounded-[5px]",
          )}
        >
          {!petite && `+${reste}`}
        </span>
      )}
    </span>
  );
}

/** Une conversation d'équipe d'un projet. */
export function LigneConversation({ chat, active, projet }: { chat: Chat; active: boolean; projet?: string }) {
  const roles = useRoles();
  const apercu = useChatPreview(chat.id);
  const travail = useTravail(chat.id);
  const nonLus = useNonLus(chat.id);
  const qui = travail ? roles.find((r) => r.id === travail.roleId)?.name : null;

  return (
    <Link
      href={`/chat?id=${chat.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(LIGNE, active ? LIGNE_ACTIVE : LIGNE_REPOS)}
    >
      <span className="relative">
        <Grappe chat={chat} roles={roles} />
        {!active && nonLus > 0 && (
          <span
            aria-label={`${nonLus} non lu${nonLus > 1 ? "s" : ""}`}
            className="absolute -right-[5px] -bottom-[3px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-fond-surface bg-bleu-k1-500 px-1 text-ui-3xs leading-none font-semibold text-texte-inverse"
          >
            {nonLus > 9 ? "9+" : nonLus}
          </span>
        )}
      </span>
      <Corps
        titre={chat.title}
        etiquette={projet}
        heure={apercu.at ? formatListDate(apercu.at) : null}
        apercu={qui ? `${qui} travaille…` : apercu.text || "Nouvelle conversation"}
        enCours={!!travail}
      />
    </Link>
  );
}

/** Une section repliable de la barre : son titre (lien vers sa page), un nombre, une action. */
export function SectionBarre({
  titre,
  href,
  nombre,
  action,
  children,
}: {
  titre: string;
  href?: string;
  nombre?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [ouverte, setOuverte] = useState(true);
  return (
    <section className="flex flex-col">
      <div className="group/titre flex h-8 items-center gap-1 pr-1 pl-2">
        <button
          type="button"
          onClick={() => setOuverte((v) => !v)}
          aria-expanded={ouverte}
          aria-label={ouverte ? `Replier ${titre}` : `Déplier ${titre}`}
          className="flex size-5 cursor-pointer items-center justify-center rounded-2xs border-0 bg-transparent p-0 text-icone-secondaire transition-colors duration-[120ms] hover:bg-fond-survol hover:text-texte-principal"
        >
          <Icon
            name="chevron-right"
            size={14}
            className={cn("transition-transform duration-[220ms] ease-sortie", ouverte && "rotate-90")}
          />
        </button>
        {href ? (
          <Link
            href={href}
            className="text-ui-xs font-medium text-texte-tertiaire no-underline transition-colors duration-[120ms] hover:text-texte-principal"
          >
            {titre}
          </Link>
        ) : (
          <span className="text-ui-xs font-medium text-texte-tertiaire">{titre}</span>
        )}
        {nombre !== undefined && <span className="text-ui-3xs text-texte-tertiaire">{nombre}</span>}
        {action && <span className="ml-auto flex">{action}</span>}
      </div>
      {ouverte && <div className="flex flex-col gap-1">{children}</div>}
    </section>
  );
}
