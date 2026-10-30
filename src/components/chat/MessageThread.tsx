"use client";

import { Fragment, useEffect, useRef, useState, type RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { plagesDans, SURLIGNAGE } from "@/components/recherche/surligner";
import { AgentRond } from "@/components/roles/AgentRond";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { formatDaySeparator, formatJourHeure, formatTime, isSameDay } from "@/lib/format";
import { requeteRetenue } from "@/lib/recherche-session";
import { texteDe, useChat, useChatMessages, useRole, useRoles, useTravail, useWorkspace, type Travail } from "@/lib/workspace";
import type { Chat, Message, RoleId } from "@/types/domain";
import { ActionsReponse } from "./ActionsReponse";
import { MessagePartView } from "./MessageParts";
import { RailMessages } from "./RailMessages";

/** Deux messages du même auteur à moins de 5 min d'écart forment un groupe : un seul nom, un seul rond. */
const GROUPE_MS = 5 * 60 * 1000;

function memeAuteur(a: Message, b: Message): boolean {
  if (a.author.kind !== b.author.kind) return false;
  return a.author.kind === "user" || (b.author.kind === "role" && a.author.roleId === b.author.roleId);
}

function DaySeparator({ iso }: { iso: string }) {
  return <div className="py-2 text-center text-ui-2xs font-medium text-texte-tertiaire">{formatDaySeparator(iso)}</div>;
}

/** L'heure, et copier le texte : visibles au survol du message. */
function ActionsSurvol({ message, align }: { message: Message; align: "start" | "end" }) {
  const [copie, setCopie] = useState(false);
  const texte = texteDe(message);
  return (
    <div
      className={cn(
        "flex h-5 items-center gap-2 text-ui-3xs text-texte-tertiaire opacity-0 transition-opacity duration-[120ms] group-hover/message:opacity-100 focus-within:opacity-100",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      <span>{formatTime(message.createdAt)}</span>
      {texte && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(texte).then(() => {
              setCopie(true);
              setTimeout(() => setCopie(false), 1200);
            });
          }}
          className="cursor-pointer rounded-2xs border-0 bg-transparent px-1 py-0 text-ui-3xs text-texte-tertiaire hover:text-texte-principal"
        >
          {copie ? "Copié" : "Copier"}
        </button>
      )}
    </div>
  );
}

/** Le début d'un message envoyé par une routine (« Tâche planifiée » : l'ancien nom). */
const DEPART_ROUTINE = /^(?:Routine|Tâche planifiée) « (.+?) »\n\n/;

function UserMessage({ message, suite }: { message: Message; suite: boolean }) {
  /* Une routine : son nom et son heure au-dessus, la consigne seule dans la bulle. */
  const premier = message.parts[0];
  const routine = premier?.type === "text" ? DEPART_ROUTINE.exec(premier.text) : null;
  const parts =
    routine && premier?.type === "text"
      ? [{ ...premier, text: premier.text.slice(routine[0].length) }, ...message.parts.slice(1)]
      : message.parts;
  return (
    <div className={cn("group/message flex flex-col items-end gap-1", !suite && "mt-3")}>
      {routine && (
        <span className="flex items-center gap-1.5 text-ui-xs text-texte-tertiaire">
          Routine
          <Icon name="clock-01" size={14} className="text-icone-secondaire" />
          <span className="font-medium text-texte-secondaire">{routine[1]}</span>
          {formatTime(message.createdAt)}
        </span>
      )}
      {parts.map((part, i) => (
        <MessagePartView key={i} part={part} tone="user" onAction={() => {}} />
      ))}
      <ActionsSurvol message={message} align="end" />
    </div>
  );
}

/** Le temps passé, affiché après 5 s : « 12 s », « 1 min 04 ». */
function useChrono(debut: number | null): string | null {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (debut === null) return;
    const id = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(id);
  }, [debut]);
  if (debut === null) return null;
  const s = Math.max(0, Math.floor((maintenant - debut) / 1000));
  if (s < 5) return null;
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

/** « Hugo réfléchit… 12 s » : l'agent a commencé mais n'a encore rien montré. */
function EnTravail({
  roleId,
  travail,
  vide,
  attente,
}: {
  roleId: RoleId;
  travail: Travail;
  vide: boolean;
  attente: boolean;
}) {
  const role = useRole(roleId);
  const chrono = useChrono(travail.debut);
  return (
    <div aria-live="polite" className="flex h-6 items-center gap-1.5 text-ui-xs text-texte-tertiaire">
      <span className="klyra-respire font-medium text-texte-secondaire">
        {attente ? `${role.name} attend ton accord` : vide ? `${role.name} réfléchit…` : `${role.name} travaille…`}
      </span>
      {chrono && <span>{chrono}</span>}
      {!!travail.jetons && <span>· {travail.jetons.toLocaleString("fr-FR")} tokens</span>}
    </div>
  );
}

function RoleMessage({
  chat,
  message,
  roleId,
  suite,
  derniere,
  travail,
  onAction,
}: {
  chat: Chat;
  derniere: boolean;
  message: Message;
  roleId: RoleId;
  suite: boolean;
  travail: Travail | null;
  onAction: (label: string, roleId: RoleId) => void;
}) {
  const role = useRole(roleId);
  const { repondreAutorisation } = useWorkspace();
  const enCours = message.statut === "en-cours";
  const visibles = message.parts.filter((p) => p.type !== "text" || p.text.trim());
  // Étapes de chaque collègue à qui l'agent a confié une partie.
  const etapes = message.parts.find((p) => p.type === "etapes");
  const etapesDe = (id: string) => (etapes?.type === "etapes" ? etapes.etapes.filter((e) => e.parent === id).length : 0);

  return (
    <div className={cn("group/message grid grid-cols-[32px_minmax(0,1fr)] gap-x-2.5", !suite && "mt-3")}>
      <div className="pt-0.5">{!suite && <AgentRond roleId={roleId} taille={32} />}</div>
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        {!suite && (
          <div className="flex items-baseline gap-2">
            {/* Le prénom dans la couleur foncée de l'agent : on voit qui parle d'un coup d'œil. */}
            <span className="text-ui-s font-semibold" style={{ color: AGENT_PASTELS[role.teinte].encre }}>
              {role.name}
            </span>
            <span className="text-ui-2xs text-texte-tertiaire">{role.tag}</span>
          </div>
        )}
        {visibles.map((part, i) => (
          <MessagePartView
            key={i}
            part={part}
            tone="role"
            enCours={enCours}
            etapesDe={etapesDe}
            nomAgent={role.name}
            onAutorisation={(demandeId, decision) => repondreAutorisation(message.id, demandeId, decision)}
            onAction={(label) => onAction(label, roleId)}
          />
        ))}
        {enCours && travail && <EnTravail
            roleId={roleId}
            travail={travail}
            vide={visibles.length === 0}
            attente={message.parts.some((p) => p.type === "autorisation" && p.statut === "attente")}
          />}
        {message.statut === "erreur" && (
          <p role="alert" className="m-0 max-w-[680px] rounded-md border border-bordure-erreur bg-fond-surface px-3 py-2 text-ui-s text-texte-erreur">
            {message.erreur ?? "L’agent s’est arrêté sur une erreur."}
          </p>
        )}
        {!enCours && <ActionsReponse chat={chat} message={message} derniere={derniere} />}
      </div>
    </div>
  );
}

/** Conversation vide : qui est l'agent et quand lui écrire. */
function Accueil({ chat }: { chat: Chat }) {
  const role = useRole(chat.roleIds[0] ?? "principal");
  if (chat.kind !== "direct") return null;
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <AgentRond roleId={role.id} taille={56} />
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-h4 leading-[1.1] tracking-[-0.03em] text-texte-principal">
          <span className="font-semibold">{role.name}</span> <span className="font-normal">{role.title}</span>
        </h2>
        <p className="m-0 max-w-[440px] text-ui-s leading-[1.5] text-texte-secondaire">{role.whenToCall}</p>
      </div>
    </div>
  );
}

/** Le temps où un message ouvert depuis la recherche reste éclairé (animation `klyra-eclaire`). */
const ECLAIRAGE_MS = 1800;

/**
 * Arriver sur un message ouvert depuis la recherche (`&message=<id>`) : après le
 * collage en bas du montage, la première occurrence est centrée (sinon le lien
 * dont l'adresse correspond, sinon le haut du message), le message s'éclaire,
 * les mots trouvés sont surlignés, il prend le focus et un lecteur d'écran
 * l'annonce. Le collage en bas est coupé jusqu'au prochain geste dans le fil,
 * puis le paramètre est retiré de l'adresse. Un id disparu : la conversation
 * s'ouvre en bas, comme d'habitude.
 */
function useArriveeRecherche(
  chatId: string,
  refs: {
    zoneRef: RefObject<HTMLDivElement | null>;
    enBasRef: RefObject<boolean>;
    ancreRef: RefObject<boolean>;
    annonceRef: RefObject<HTMLParagraphElement | null>;
  },
) {
  const cible = useSearchParams().get("message");
  const router = useRouter();
  const roles = useRoles();
  const messages = useChatMessages(chatId);
  const { zoneRef, enBasRef, ancreRef, annonceRef } = refs;

  useEffect(() => {
    if (!cible) return;
    const el = zoneRef.current;
    const bloc = el?.querySelector<HTMLElement>(`[data-message="${CSS.escape(cible)}"]`);
    const message = messages.find((m) => m.id === cible);
    const retirer = () => router.replace(`/chat?id=${encodeURIComponent(chatId)}`, { scroll: false });
    if (!el || !bloc || !message) {
      retirer();
      return;
    }

    const requete = requeteRetenue();
    const { textes, liens, lien } = requete ? plagesDans(bloc, requete) : { textes: [], liens: [], lien: null };
    if (typeof Highlight !== "undefined" && CSS.highlights) {
      if (textes.length || liens.length) CSS.highlights.set(SURLIGNAGE, new Highlight(...textes, ...liens));
      else CSS.highlights.delete(SURLIGNAGE);
    }

    const haut = el.getBoundingClientRect().top - el.scrollTop;
    const viser = textes[0] ?? (lien ? lien : null);
    let position: number;
    if (viser) {
      const r = viser.getBoundingClientRect();
      position = r.top - haut + r.height / 2 - el.clientHeight / 2;
    } else {
      position = bloc.getBoundingClientRect().top - haut - 16;
    }
    const doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ancreRef.current = true;
    enBasRef.current = false;
    el.scrollTo({ top: Math.max(0, position), behavior: doux ? "smooth" : "instant" });

    bloc.removeAttribute("data-eclaire");
    void bloc.offsetWidth; // relance l'animation si on y revient
    bloc.setAttribute("data-eclaire", "");
    const eteindre = setTimeout(() => bloc.removeAttribute("data-eclaire"), ECLAIRAGE_MS);
    bloc.tabIndex = -1;
    bloc.focus({ preventScroll: true });
    const { author } = message;
    const auteur = author.kind === "user" ? "toi" : (roles.find((r) => r.id === author.roleId)?.name ?? "l’agent");
    if (annonceRef.current) annonceRef.current.textContent = `Message de ${auteur}, ${formatJourHeure(message.createdAt)}`;
    retirer();
    return () => clearTimeout(eteindre);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois par message visé, pas à chaque nouvelle réponse
  }, [cible, chatId]);

  /* Le surlignage s'efface quand on quitte la conversation. */
  useEffect(() => () => void CSS.highlights?.delete(SURLIGNAGE), []);
}

/** Fil de la conversation, collé en bas comme dans une messagerie. */
export function MessageThread({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  const messages = useChatMessages(chatId);
  const travail = useTravail(chatId);
  const { sendMessage, marquerLu } = useWorkspace();
  const zone = useRef<HTMLDivElement>(null);
  const enBas = useRef(true);
  /* Arrivé sur un message par la recherche : on y reste, même si un agent écrit, jusqu'au prochain geste dans le fil. */
  const ancre = useRef(false);

  /* On reste collé en bas tant que l'on n'est pas remonté lire plus haut. */
  const dernier = messages[messages.length - 1];
  const taille = dernier ? JSON.stringify(dernier.parts).length : 0;
  useEffect(() => {
    const el = zone.current;
    if (el && enBas.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, taille, travail]);

  const annonce = useRef<HTMLParagraphElement>(null);
  useArriveeRecherche(chatId, { zoneRef: zone, enBasRef: enBas, ancreRef: ancre, annonceRef: annonce });
  const lacher = () => {
    ancre.current = false;
  };

  useEffect(() => {
    marquerLu(chatId);
  }, [chatId, messages.length, dernier?.statut, marquerLu]);

  if (!chat) return null;
  const derniereReponse = messages.findLast((m) => m.author.kind === "role")?.id;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={zone}
        onScroll={(e) => {
          const el = e.currentTarget;
          enBas.current = !ancre.current && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        onWheel={lacher}
        onPointerDown={lacher}
        onKeyDown={lacher}
        className="flex-1 overflow-y-auto [scrollbar-width:none]"
      >
        <div className="mx-auto flex min-h-full max-w-[880px] flex-col justify-end px-7 pt-6 pb-4">
          {messages.length === 0 && <Accueil chat={chat} />}
          {messages.map((message, i) => {
            const previous = messages[i - 1];
            const showDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
            const suite =
              !!previous &&
              !showDay &&
              memeAuteur(previous, message) &&
              new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUPE_MS;
            return (
              <Fragment key={message.id}>
                {showDay && <DaySeparator iso={message.createdAt} />}
                <div data-message={message.id} data-auteur={message.author.kind} className={cn("klyra-arrivee", suite ? "mt-1.5" : "")}>
                  {message.author.kind === "user" ? (
                    <UserMessage message={message} suite={suite} />
                  ) : (
                    <RoleMessage
                      chat={chat}
                      derniere={message.id === derniereReponse}
                      message={message}
                      roleId={message.author.roleId}
                      suite={suite}
                      travail={travail?.messageId === message.id ? travail : null}
                      onAction={(label, roleId) => sendMessage(chatId, label, roleId)}
                    />
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
      <RailMessages zone={zone} messages={messages} />
      <p ref={annonce} aria-live="polite" className="sr-only" />
    </div>
  );
}
