import { LABEL_EN_COURS, LABEL_PRET } from "./automate.ts";
import { nouvelleCarte, prolongerBail, type Carte } from "./carte.ts";
import type { ClientGithub } from "./github.ts";

/**
 * Prendre une Issue, sans service à ajouter : la création d'une branche sur GitHub est atomique. Le
 * premier poste qui crée `agent/issue-<n>` a la tâche. Pour une reprise après un bail expiré, c'est
 * `agent/reprise-<n>-<génération>` : deux postes qui reprennent en même temps, un seul gagne.
 */

export const brancheIssue = (numero: number) => `agent/issue-${numero}`;
export const brancheReprise = (numero: number, generation: number) => `agent/reprise-${numero}-${generation}`;

export type Prise = { statut: "prise"; carte: Carte } | { statut: "deja_prise" };

async function poser(client: ClientGithub, numero: number, carte: Carte, moi: string): Promise<void> {
  await client.ecrireCarte(numero, carte);
  await client.poserLabels(numero, [LABEL_EN_COURS]);
  await client.retirerLabel(numero, LABEL_PRET);
  await client.assigner(numero, moi);
}

export async function reserver(client: ClientGithub, c: { numero: number; moi: string; agent: string; maintenant: number }): Promise<Prise> {
  const sha = await client.shaBrancheParDefaut();
  if (!(await client.creerBranche(brancheIssue(c.numero), sha))) return { statut: "deja_prise" };
  const carte = nouvelleCarte({ responsable: c.moi, agent: c.agent, maintenant: c.maintenant });
  await poser(client, c.numero, carte, c.moi);
  return { statut: "prise", carte };
}

/** Reprend le travail d'un autre poste. Ce qui est déjà sur la branche et dans la carte est gardé. */
export async function reprendre(
  client: ClientGithub,
  c: { numero: number; moi: string; agent: string; maintenant: number; generation: number; carte: Carte | null },
): Promise<Prise> {
  const sha = await client.shaBrancheParDefaut();
  if (!(await client.creerBranche(brancheReprise(c.numero, c.generation), sha))) return { statut: "deja_prise" };
  const carte: Carte = {
    ...prolongerBail(c.carte ?? nouvelleCarte({ responsable: c.moi, agent: c.agent, maintenant: c.maintenant }), c.maintenant),
    responsable: c.moi,
    agent: c.agent,
    statut: "en-cours",
    generation: c.generation,
  };
  await poser(client, c.numero, carte, c.moi);
  return { statut: "prise", carte };
}
