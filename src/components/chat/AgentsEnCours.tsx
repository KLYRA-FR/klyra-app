"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AgentRond } from "@/components/roles/AgentRond";
import { cn } from "@/lib/cn";
import { useRoles, useWorkspace } from "@/lib/workspace";
import type { Etape, Message, RoleId } from "@/types/domain";

/** Un agent qui travaille en arrière-plan pour cette conversation. */
interface EnCours {
  cle: string;
  roleId: RoleId;
  /** Ce qu'il fait en ce moment : « Lit src/app/page.tsx ». */
  etape: string | null;
  /** Sa liste de tâches, s'il en tient une : 2 sur 5. */
  progres: { fait: number; total: number } | null;
  /** Le fil où il travaille, à ouvrir d'un clic. */
  filId?: string;
}

/** Les étapes d'un message, à plat. */
const etapesDe = (m: Message | undefined): Etape[] => m?.parts.flatMap((p) => (p.type === "etapes" ? p.etapes : [])) ?? [];

/** L'étape en cours la plus récente, sinon la dernière faite. */
function etapeActuelle(etapes: Etape[]): string | null {
  return (etapes.findLast((e) => e.statut === "en-cours") ?? etapes.at(-1))?.libelle ?? null;
}

/**
 * Les agents qui travaillent derrière la conversation : les collègues à qui l'agent
 * a confié une partie (passations en cours) et les fils qu'il a ouverts. Une ligne
 * discrète au-dessus du composeur, absente quand personne ne travaille.
 */
export function AgentsEnCours({ chatId }: { chatId: string }) {
  const { state } = useWorkspace();
  const roles = useRoles();
  const router = useRouter();

  const enCours = useMemo<EnCours[]>(() => {
    const liste: EnCours[] = [];

    // Collègues sollicités dans la réponse en cours (outil Agent de Claude Code).
    const reponse = state.messages.findLast((m) => m.chatId === chatId && m.statut === "en-cours");
    const etapes = etapesDe(reponse);
    for (const p of reponse?.parts ?? []) {
      if (p.type !== "passation" || p.statut !== "en-cours") continue;
      liste.push({ cle: p.etapeId, roleId: p.roleId, etape: etapeActuelle(etapes.filter((e) => e.parent === p.etapeId)) ?? p.consigne, progres: null });
    }

    // Fils ouverts depuis cette conversation, où un agent travaille.
    for (const fil of state.chats) {
      if (fil.fil?.lancePar?.chatId !== chatId || !state.travail[fil.id]) continue;
      const taches = fil.taches ?? [];
      const dernier = state.messages.findLast((m) => m.chatId === fil.id && m.author.kind === "role");
      liste.push({
        cle: fil.id,
        roleId: fil.fil.roleId,
        etape: etapeActuelle(etapesDe(dernier)) ?? fil.title,
        progres: taches.length ? { fait: taches.filter((t) => t.statut === "fait").length, total: taches.length } : null,
        filId: fil.id,
      });
    }
    return liste;
  }, [state.messages, state.chats, state.travail, chatId]);

  if (!enCours.length) return null;

  return (
    <div className="mx-auto w-full max-w-[880px] px-5">
      <ul aria-label="Agents au travail" className="m-0 flex list-none gap-1.5 overflow-x-auto p-0 pb-1.5 [scrollbar-width:none]">
        {enCours.map((a) => {
          const nom = roles.find((r) => r.id === a.roleId)?.name ?? a.roleId;
          const contenu = (
            <>
              <AgentRond roleId={a.roleId} taille={20} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 text-ui-xs font-medium text-texte-principal">{nom}</span>
                  <span className="truncate text-ui-2xs text-texte-tertiaire">{a.etape}</span>
                  {a.progres && (
                    <span className="ml-auto shrink-0 text-ui-2xs text-texte-tertiaire tabular-nums">
                      {a.progres.fait}/{a.progres.total}
                    </span>
                  )}
                </span>
                {/* Avancement : la part de ses tâches faites ; sans liste, une barre qui respire. */}
                <span aria-hidden="true" className="h-0.5 overflow-hidden rounded-full bg-fond-surface-grise">
                  <span
                    className={cn("block h-full rounded-full bg-bleu-k1-500 transition-[width] duration-[480ms]", !a.progres && "klyra-respire w-1/3")}
                    style={a.progres ? { width: `${Math.max(6, (a.progres.fait / a.progres.total) * 100)}%` } : undefined}
                  />
                </span>
              </span>
            </>
          );
          const classe = "flex h-10 w-[240px] shrink-0 items-center gap-2 rounded-md border border-bordure-subtile bg-fond-surface px-2.5 text-left";
          return (
            <li key={a.cle} title={`${nom} : ${a.etape ?? "au travail"}`}>
              {a.filId ? (
                <button
                  type="button"
                  onClick={() => router.push(`/chat?id=${encodeURIComponent(a.filId!)}`)}
                  className={cn(classe, "cursor-pointer hover:bg-fond-survol")}
                >
                  {contenu}
                </button>
              ) : (
                <div className={classe}>{contenu}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
