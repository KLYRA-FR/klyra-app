"use client";

import { EmptyState } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { useModifiedFiles } from "@/lib/workspace";
import type { Project } from "@/types/domain";

/**
 * Ce que les agents ont modifié dans le projet, et « Publier » (commit et push de la branche en cours,
 * `Publier`, ouvert par-dessus le panneau). En attendant l'onglet Git, c'est là que vit ce qui touche au dépôt.
 */
export function VueModifies({ project, onPublier }: { project: Project; onPublier?: () => void }) {
  const modified = [...useModifiedFiles(project.id)].sort();
  return (
    <div className="flex flex-col gap-2 p-2">
      {onPublier && (
        <div className="flex items-center gap-2 px-2 pt-1">
          <span className="flex-1 text-ui-xs text-texte-tertiaire">
            {modified.length ? `${modified.length} fichier${modified.length > 1 ? "s" : ""} modifié${modified.length > 1 ? "s" : ""} par les agents` : "Les fichiers modifiés par les agents"}
          </span>
          <Bouton variant="sombre" taille="compact" iconeGauche={<Icon name="upload-01" size={16} />} title="Publier : commit et push sur git" onClick={onPublier}>
            Publier
          </Bouton>
        </div>
      )}
      {modified.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {modified.map((f) => (
            <li key={f} className="klyra-mono flex items-center gap-2 rounded-sm px-2 py-1.5 text-ui-xs text-texte-principal">
              <Icon name="file-code" size={14} className="shrink-0 text-icone-secondaire" />
              <span className="truncate">{f}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Rien de modifié" description="Les fichiers que les agents modifient dans ce projet s’affichent ici." />
      )}
    </div>
  );
}
