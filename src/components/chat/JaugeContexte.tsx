"use client";

/**
 * La jauge du contexte, dans la barre du composeur : la part de la fenêtre du modèle que la conversation remplit
 * déjà (ce que relit chaque appel de l'agent). Un clic la détaille (ce qui la remplit, lu dans la session ouverte
 * de Claude Code) et propose de résumer ou de repartir à zéro. Rien d'estimé : sans mesure, pas de jauge.
 */
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, type UsageContexte } from "@/lib/bridge";
import { COMMANDE_COMPACTER, formaterJetons, peutRepartir } from "@/lib/contexte";
import { useChatMessages, useRole, useWorkspace } from "@/lib/workspace";
import type { Chat, RoleId } from "@/types/domain";

/** Ce que Claude Code nomme dans sa répartition, en mots de l'app. */
const NOMS: Record<string, string> = {
  system_prompt: "Consignes du système",
  system_tools: "Outils",
  system_tools_deferred: "Outils chargés à la demande",
  mcp_tools: "Outils des connexions (MCP)",
  mcp_tools_deferred: "Outils des connexions, à la demande",
  custom_agents: "Agents",
  memory_files: "Consignes des projets (CLAUDE.md)",
  skills: "Compétences",
  messages: "Échanges",
  autocompact_buffer: "Réserve du résumé automatique",
  free_space: "Libre",
};

/** La fenêtre quand le modèle ne l'a pas encore dite : celle de Claude Code par défaut. */
const FENETRE_PAR_DEFAUT = 200_000;

export function JaugeContexte({ chat, roleId }: { chat: Chat; roleId: RoleId }) {
  const mesure = chat.contexte?.[roleId];
  const fenetre = chat.fenetres?.[roleId] ?? FENETRE_PAR_DEFAUT;
  const role = useRole(roleId);
  const messages = useChatMessages(chat.id);
  const { sendMessage, repartir, state } = useWorkspace();
  const [ouvert, setOuvert] = useState(false);
  const [detail, setDetail] = useState<UsageContexte | null | "lecture">(null);
  const zone = useRef<HTMLDivElement>(null);
  const id = useId();
  const session = chat.sessions[roleId] ?? null;

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

  /* Le détail se lit à l'ouverture, dans la session de Claude Code encore ouverte (sinon : la mesure seule). */
  useEffect(() => {
    if (!ouvert || !session) return;
    const lire = getBridge()?.claude.contexte;
    if (!lire) return;
    let actif = true;
    void lire(session, chat.lieu ?? null).then((r) => actif && setDetail(r.ok ? r.data : null));
    return () => {
      actif = false;
    };
  }, [ouvert, session, chat.lieu]);

  if (!mesure || !session) return null;
  const usage = detail && detail !== "lecture" ? detail : null;
  const total = usage?.total ?? mesure.jetons;
  const max = usage?.max ?? fenetre;
  const part = Math.min(1, total / max);
  const pourcent = Math.round(part * 100);
  const niveau = part >= 0.8 ? "haut" : part >= 0.5 ? "moyen" : "bas";
  const occupe = !!state.travail[chat.id];
  // L'anneau : 14 px, un trait de 2.
  const r = 6;
  const tour = 2 * Math.PI * r;

  return (
    <div ref={zone} className="relative" data-jauge-contexte={pourcent}>
      <button
        type="button"
        aria-expanded={ouvert}
        aria-controls={ouvert ? id : undefined}
        title={`Contexte : ${formaterJetons(total)} jetons sur ${formaterJetons(max)} (${pourcent} %)`}
        onClick={() => {
          if (!ouvert) setDetail("lecture");
          setOuvert((v) => !v);
        }}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xs border-0 bg-transparent px-2 text-ui-xs text-texte-tertiaire tabular-nums transition-colors duration-[120ms] hover:bg-fond-survol hover:text-texte-principal"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="-rotate-90">
          <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-gris-k2-500" />
          <circle
            cx="8"
            cy="8"
            r={r}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${tour * part} ${tour}`}
            className={cn(niveau === "haut" ? "stroke-rouge-600" : niveau === "moyen" ? "stroke-orange-k1-500" : "stroke-bleu-k1-500")}
          />
        </svg>
        <span>{pourcent} %</span>
      </button>
      {ouvert && (
        <div
          id={id}
          role="dialog"
          aria-label="Contexte de la conversation"
          data-flottant
          className="absolute bottom-full left-0 z-30 mb-2 flex w-[300px] flex-col gap-3 rounded-lg border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-flottante"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-ui-s font-semibold text-texte-principal">
              {formaterJetons(total)} jetons sur {formaterJetons(max)}
            </span>
            <span className="text-ui-xs text-texte-secondaire">Ce que {role.name} relit à chaque appel dans cette conversation.</span>
          </div>
          {detail === "lecture" && <span className="text-ui-xs text-texte-tertiaire">Lecture du détail…</span>}
          {usage && usage.categories.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {usage.categories
                .filter((c) => c.genre !== "free")
                .map((c) => (
                  <li key={c.id || c.nom} className="flex items-center justify-between gap-3 text-ui-xs">
                    <span className="truncate text-texte-secondaire">{NOMS[c.id] ?? c.nom}</span>
                    <span className="shrink-0 text-texte-principal tabular-nums">{formaterJetons(c.jetons)}</span>
                  </li>
                ))}
            </ul>
          )}
          {detail === null && <span className="text-ui-2xs text-texte-tertiaire">Le détail se lit pendant que la session de {role.name} est ouverte.</span>}
          <div className="flex flex-wrap gap-1.5">
            <Bouton
              variant="blanc"
              taille="mini"
              disabled={occupe}
              onClick={() => {
                setOuvert(false);
                sendMessage(chat.id, COMMANDE_COMPACTER, roleId);
              }}
            >
              Résumer la conversation
            </Bouton>
            {peutRepartir(chat, messages) && (
              <Bouton
                variant="discret"
                taille="mini"
                disabled={occupe}
                onClick={() => {
                  setOuvert(false);
                  repartir(chat.id);
                }}
              >
                Repartir à zéro
              </Bouton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
