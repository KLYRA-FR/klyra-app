"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";
import { formatDaySeparator, formatTime, isSameDay } from "@/lib/format";
import { texteDe, useTravail, useWorkspace, type FaconReessai } from "@/lib/workspace";
import type { Chat, Message } from "@/types/domain";
import { MODELES, nomModele, useModeleEffectif } from "./ChoixModele";

const BOUTON =
  "flex size-7 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-icone-secondaire transition-colors duration-[120ms] ease-sortie hover:bg-fond-survol hover:text-texte-principal disabled:cursor-not-allowed disabled:opacity-50";
const MENU =
  "absolute z-50 flex w-max min-w-[220px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante";
const ENTETE = "px-2 pt-1 pb-1 text-ui-2xs font-medium text-texte-tertiaire";

function Ligne({
  icone,
  children,
  onClick,
  sousMenu,
  ouvert,
  onSurvol,
}: {
  icone: IconName;
  children: ReactNode;
  onClick: () => void;
  sousMenu?: boolean;
  ouvert?: boolean;
  onSurvol?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup={sousMenu ? "menu" : undefined}
      aria-expanded={sousMenu ? !!ouvert : undefined}
      onClick={onClick}
      onMouseEnter={onSurvol}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left text-ui-s whitespace-nowrap text-texte-principal hover:bg-fond-survol",
        ouvert && "bg-fond-survol",
      )}
    >
      <Icon name={icone} size={16} className="shrink-0 text-icone-secondaire" />
      <span className="flex-1">{children}</span>
      {sousMenu && <Icon name="chevron-right" size={14} className="shrink-0 text-icone-secondaire" />}
    </button>
  );
}

/** Le texte d'une réponse, sans la mise en forme Markdown, pour la lecture à voix haute. */
function texteParle(message: Message): string {
  return texteDe(message)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sous une réponse d'agent : copier, écouter, et le menu « … » (créer une
 * branche, réessayer, plus détaillé, plus concis, chercher sur le web,
 * changer de modèle). Toujours visible sous la dernière réponse, au survol sinon.
 */
export function ActionsReponse({ chat, message, derniere }: { chat: Chat; message: Message; derniere: boolean }) {
  const router = useRouter();
  const { reessayer, brancher } = useWorkspace();
  const travail = useTravail(chat.id);
  const { modele } = useModeleEffectif(chat);
  const [copie, setCopie] = useState(false);
  const [parle, setParle] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const [sous, setSous] = useState<"reessayer" | "modele" | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const texte = texteDe(message);
  const occupe = !!travail;

  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  /* On coupe la lecture en quittant la conversation. */
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const ecouter = () => {
    const synthese = window.speechSynthesis;
    if (!synthese) return;
    synthese.cancel();
    if (parle) return setParle(false);
    const phrase = new SpeechSynthesisUtterance(texteParle(message));
    phrase.lang = "fr-FR";
    phrase.voice = synthese.getVoices().find((v) => v.lang.startsWith("fr")) ?? null;
    phrase.onend = phrase.onerror = () => setParle(false);
    synthese.speak(phrase);
    setParle(true);
  };

  const refaire = (facon: FaconReessai, autreModele?: string) => {
    setOuvert(false);
    reessayer(chat.id, message.id, facon, autreModele);
  };

  if (!texte) return null;

  return (
    <div
      ref={zone}
      className={cn(
        "relative -ml-1 flex items-center gap-0.5 transition-opacity duration-[120ms]",
        !derniere && !ouvert && "opacity-0 group-hover/message:opacity-100 focus-within:opacity-100",
      )}
    >
      <button
        type="button"
        title={copie ? "Copié" : "Copier"}
        aria-label="Copier la réponse"
        onClick={() => {
          void navigator.clipboard?.writeText(texte).then(() => {
            setCopie(true);
            setTimeout(() => setCopie(false), 1200);
          });
        }}
        className={BOUTON}
      >
        <Icon name={copie ? "check-01" : "copy-left"} size={16} />
      </button>
      <button
        type="button"
        title={parle ? "Arrêter la lecture" : "Lire à voix haute"}
        aria-label={parle ? "Arrêter la lecture" : "Lire à voix haute"}
        aria-pressed={parle}
        onClick={ecouter}
        className={cn(BOUTON, parle && "bg-fond-survol text-texte-principal")}
      >
        <Icon name={parle ? "stop-01" : "volume-01"} size={16} />
      </button>
      <button
        type="button"
        title="Plus d’actions"
        aria-label="Plus d’actions"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onClick={() => {
          setSous(null);
          setOuvert((v) => !v);
        }}
        className={cn(BOUTON, ouvert && "bg-fond-survol text-texte-principal")}
      >
        <Icon name="dot-horizontal" size={16} />
      </button>

      {ouvert && (
        <div ref={apparition} role="menu" aria-label="Actions sur la réponse" className={cn(MENU, "bottom-full left-0 mb-1.5")}>
          <span className={ENTETE}>
            {isSameDay(message.createdAt, new Date().toISOString()) ? "Aujourd’hui" : formatDaySeparator(message.createdAt)},{" "}
            {formatTime(message.createdAt)}
          </span>
          <Ligne
            icone="git-branch-01"
            onSurvol={() => setSous(null)}
            onClick={() => {
              setOuvert(false);
              const id = brancher(chat.id, message.id);
              if (id) router.push(`/chat?id=${id}`);
            }}
          >
            Créer une branche dans une nouvelle conversation
          </Ligne>
          <div className="relative">
            <Ligne
              icone="refresh-01"
              sousMenu
              ouvert={sous !== null}
              onSurvol={() => setSous((s) => s ?? "reessayer")}
              onClick={() => setSous((s) => (s ? null : "reessayer"))}
            >
              Réessayer
            </Ligne>
            {sous && (
              <div ref={apparition} role="menu" aria-label="Réessayer" className={cn(MENU, "bottom-0 left-full ml-2")}>
                <span className={ENTETE}>{nomModele(modele)} utilisé</span>
                {occupe && <span className="px-2 pb-1 text-ui-2xs text-texte-tertiaire">L’agent travaille : ce sera fait juste après.</span>}
                <Ligne icone="refresh-01" onSurvol={() => setSous("reessayer")} onClick={() => refaire("reessayer")}>
                  Réessayer
                </Ligne>
                <Ligne icone="align-left" onSurvol={() => setSous("reessayer")} onClick={() => refaire("details")}>
                  Ajouter des détails
                </Ligne>
                <Ligne icone="minimise-01" onSurvol={() => setSous("reessayer")} onClick={() => refaire("concis")}>
                  Plus concis
                </Ligne>
                <span aria-hidden="true" className="mx-2 my-1 h-px bg-bordure-subtile" />
                <Ligne icone="globe-01" onSurvol={() => setSous("reessayer")} onClick={() => refaire("web")}>
                  Rechercher sur le web
                </Ligne>
                <div className="relative">
                  <Ligne
                    icone="shuffle"
                    sousMenu
                    ouvert={sous === "modele"}
                    onSurvol={() => setSous("modele")}
                    onClick={() => setSous((s) => (s === "modele" ? "reessayer" : "modele"))}
                  >
                    Changer de modèle
                  </Ligne>
                  {sous === "modele" && (
                    <div ref={apparition} role="menu" aria-label="Changer de modèle" className={cn(MENU, "bottom-0 left-full ml-2")}>
                      {MODELES.filter((m) => m.id !== modele).map((m) => (
                        <Ligne key={m.id} icone="refresh-01" onClick={() => refaire("reessayer", m.id)}>
                          {m.nom}
                        </Ligne>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
