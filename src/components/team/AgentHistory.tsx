"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { DiffView } from "@/components/ui/DiffView";
import { useAgents } from "@/lib/agents";
import type { HistoryEntry } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import type { Role } from "@/types/domain";
import { Bloc } from "./AgentDetail";

const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

/**
 * Historique d'une fiche : chaque version remplacée par l'app est gardée.
 * On compare une version à la fiche actuelle, et on peut la restaurer
 * (la version actuelle passe à son tour dans l'historique).
 */
export function AgentHistory({ role }: { role: Role }) {
  const router = useRouter();
  const { history, readVersion, save } = useAgents();
  const [versions, setVersions] = useState<HistoryEntry[] | null>(null);
  const [choisie, setChoisie] = useState<{ id: string; content: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    history(role.id)
      .then((v) => actif && setVersions(v))
      .catch((e: unknown) => actif && setMessage(e instanceof Error ? e.message : String(e)));
    return () => {
      actif = false;
    };
  }, [history, role.id]);

  const ouvrir = async (id: string) => {
    try {
      setChoisie({ id, content: await readVersion(role.id, id) });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const restaurer = async () => {
    if (!choisie || !role.file) return;
    try {
      await save(role.id, choisie.content, { tag: role.tag, teinte: role.teinte }, role.file.modifiedAt);
      router.push(`/equipe?agent=${role.id}`);
    } catch (e) {
      setMessage(`La restauration a échoué : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-8 pt-8 pb-12">
        <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
          <span className="font-semibold">Historique</span> <span className="font-normal">de {role.name}</span>
        </h1>

        {message && (
          <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-4 text-ui text-texte-erreur">
            {message}
          </p>
        )}

        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
          <Bloc titre="Versions">
            {versions === null ? (
              <p className="m-0 text-ui-s text-texte-tertiaire">Chargement…</p>
            ) : versions.length === 0 ? (
              <p className="m-0 text-ui-s leading-[1.5] text-texte-tertiaire">
                Pas encore de version précédente. Chaque modification faite dans l’app gardera ici la version remplacée.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => void ouvrir(v.id)}
                      className={cn(
                        "w-full cursor-pointer rounded-sm border-0 px-2.5 py-2 text-left text-ui-s",
                        choisie?.id === v.id ? "bg-fond-teinte-bleue text-texte-accent" : "bg-transparent text-texte-principal hover:bg-fond-survol",
                      )}
                    >
                      {date.format(v.savedAt)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Bloc>

          <Bloc titre={choisie ? "Cette version → la fiche actuelle" : "Choisis une version"}>
            {choisie ? (
              <>
                <DiffView before={choisie.content} after={role.file?.content ?? ""} />
                <div className="flex items-center justify-end gap-2">
                  <Bouton variant="blanc" taille="md" onClick={() => setChoisie(null)}>
                    Fermer
                  </Bouton>
                  <BoutonPrincipal onClick={() => void restaurer()}>Restaurer cette version</BoutonPrincipal>
                </div>
              </>
            ) : (
              <p className="m-0 text-ui-s text-texte-tertiaire">Le détail des changements s’affiche ici.</p>
            )}
          </Bloc>
        </div>
      </div>
    </div>
  );
}
