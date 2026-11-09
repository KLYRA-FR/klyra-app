"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, unwrap, type SessionTerminal } from "@/lib/bridge";
import { formatJourHeure } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";
import type { Project } from "@/types/domain";

/**
 * Les sessions de Claude Code lancées dans ce projet hors de l'app (terminal, éditeur) : « Reprendre ici » en
 * fait une conversation de l'assistant qui garde la même session (la suite s'écrit des deux côtés). Les
 * sessions déjà ouvertes par l'app n'y sont pas. Absent sans session.
 */
export function SessionsTerminal({ project }: { project: Project }) {
  const pont = getBridge()?.projets;
  const router = useRouter();
  const { reprendreSessionTerminal } = useWorkspace();
  const [sessions, setSessions] = useState<SessionTerminal[]>([]);
  const [tout, setTout] = useState(false);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const lieu = project.lieu ?? null;

  useEffect(() => {
    if (!pont?.sessionsTerminal) return;
    let actif = true;
    pont
      .sessionsTerminal(project.folder, lieu)
      .then((r) => actif && setSessions(unwrap(r).filter((s) => !s.deLApp)))
      .catch(() => actif && setSessions([]));
    return () => {
      actif = false;
    };
  }, [pont, project.folder, lieu]);

  if (!sessions.length) return null;
  const visibles = tout ? sessions : sessions.slice(0, 4);

  const reprendre = async (s: SessionTerminal) => {
    if (!pont?.sessionTerminal) return;
    setOccupe(s.id);
    setErreur(null);
    try {
      const messages = unwrap(await pont.sessionTerminal(project.folder, s.id, lieu));
      const id = reprendreSessionTerminal(project.id, s, messages);
      router.push(`/chat?id=${encodeURIComponent(id)}`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      setOccupe(null);
    }
  };

  return (
    <section aria-label="Sessions du terminal" data-sessions-terminal className="flex flex-col gap-2 rounded-lg border border-bordure-subtile bg-fond-surface p-4">
      <div className="flex items-center gap-2">
        <Icon name="code-01" size={16} className="text-icone-secondaire" />
        <span className="text-ui-s font-semibold text-texte-principal">Sessions du terminal</span>
      </div>
      <p className="m-0 text-ui-xs text-texte-secondaire">Claude Code lancé dans ce projet hors de l’app : reprends une session ici, elle continue avec sa mémoire.</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
        {visibles.map((s) => (
          <li key={s.id} className="flex min-h-10 items-center gap-3 py-1.5">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-ui-s text-texte-principal">{s.titre}</span>
              <span className="text-ui-2xs text-texte-tertiaire">{formatJourHeure(new Date(s.modifieLe).toISOString())}</span>
            </span>
            <Bouton variant="blanc" taille="mini" disabled={occupe !== null} onClick={() => void reprendre(s)}>
              {occupe === s.id ? "Ouverture…" : "Reprendre ici"}
            </Bouton>
          </li>
        ))}
      </ul>
      {sessions.length > 4 && (
        <button type="button" onClick={() => setTout((v) => !v)} className="w-fit cursor-pointer rounded-2xs border-0 bg-transparent px-1 py-0 text-ui-xs text-texte-secondaire hover:text-texte-principal">
          {tout ? "Moins" : `Les ${sessions.length} sessions`}
        </button>
      )}
      {erreur && (
        <p role="alert" className="m-0 text-ui-xs text-texte-erreur">
          {erreur}
        </p>
      )}
    </section>
  );
}
