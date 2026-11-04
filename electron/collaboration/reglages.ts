/** Le circuit par poste : qui on est sur GitHub, ce poste, et les projets où les agents prennent les Issues. Module pur. */
export interface ReglagesCollaboration {
  compteGithub: string;
  poste: string;
  projets: string[];
}

export const COLLABORATION_PAR_DEFAUT: ReglagesCollaboration = { compteGithub: "", poste: "", projets: [] };

const COMPTE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export function compteGithubValable(compte: string): boolean {
  return COMPTE.test(compte);
}

export function validerCollaboration(brut: unknown): ReglagesCollaboration {
  const b = (brut ?? {}) as { compteGithub?: unknown; poste?: unknown; projets?: unknown };
  return {
    compteGithub: typeof b.compteGithub === "string" && compteGithubValable(b.compteGithub) ? b.compteGithub : "",
    poste: typeof b.poste === "string" && /^[A-Za-z0-9-]{1,64}$/.test(b.poste) ? b.poste : "",
    projets: Array.isArray(b.projets) ? b.projets.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 200) : [],
  };
}
