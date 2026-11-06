/**
 * « 1 commande », « 2 commandes et 1 agent » : ce qu'un agent a en fond, compté par genre (cf.
 * electron/taches-fond.ts). Pur : sert au bureau (`EnFond`) et à la copie pour le téléphone.
 */
export type GenreFond = "commande" | "agent" | "autre";

export function resumeFond<T extends { genre: GenreFond }>(taches: readonly T[]): string {
  const n = { commande: 0, agent: 0, autre: 0 };
  for (const t of taches) n[t.genre] += 1;
  const morceaux = [
    n.commande ? `${n.commande} commande${n.commande > 1 ? "s" : ""}` : "",
    n.agent ? `${n.agent} agent${n.agent > 1 ? "s" : ""}` : "",
    n.autre ? `${n.autre} tâche${n.autre > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  return morceaux.length > 1 ? `${morceaux.slice(0, -1).join(", ")} et ${morceaux.at(-1)}` : (morceaux[0] ?? "");
}
