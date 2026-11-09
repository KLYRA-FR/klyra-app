import type { Chat, Fil, Project } from "@/types/domain";

/*
 * Où une conversation fait travailler son agent. Une conversation de projet : le dossier du projet. Un fil
 * que la puce « Dépôt » a posé dans un projet avant son premier message : le dossier retenu alors (`fil.dossier`),
 * figé ensuite, car Claude Code retrouve une session par son dossier. Le reste : l'atelier de l'agent (null).
 * Sur un VPS (`lieu`), seulement un dossier de ce VPS, envoyé en `dossierVps` ; le dossier du PC n'y existe pas.
 */
export function dossierDeConversation(
  chat: Chat,
  projet: Project | undefined,
): { dossier: string | null; dossierVps: string | null } {
  const lieu = chat.lieu ?? null;
  if (chat.kind === "equipe") {
    if (!lieu) return { dossier: projet?.folder ?? null, dossierVps: null };
    return {
      dossier: null,
      dossierVps: projet && projet.lieu === lieu ? projet.folder : null,
    };
  }
  const fil =
    chat.fil?.dossier && (chat.fil.dossier.lieu ?? null) === lieu
      ? chat.fil.dossier.chemin
      : null;
  return lieu
    ? { dossier: null, dossierVps: fil }
    : { dossier: fil, dossierVps: null };
}

/** Un fil neuf (aucun message, aucune session) peut encore choisir le dossier où il travaillera. */
export function filPeutChoisirDossier(chat: Chat, nbMessages: number): boolean {
  return (
    !!chat.fil &&
    !chat.fil.dossier &&
    nbMessages === 0 &&
    Object.keys(chat.sessions).length === 0
  );
}

/** Les champs du fil qui le font travailler dans un projet : le projet du ticket et son dossier, sur la machine du fil. */
export function filDansProjet(fil: Fil, projet: Project): Fil {
  return {
    ...fil,
    projetId: projet.id,
    dossier: { chemin: projet.folder, lieu: projet.lieu ?? null },
  };
}
