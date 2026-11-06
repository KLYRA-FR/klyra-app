import path from "node:path";

/**
 * Les pièces jointes d'une conversation sur un VPS. L'agent tourne là-bas : un fichier joint sur ce PC
 * (capture collée dans `collages/`, fichier glissé) n'y existe pas. Avant le message, le PC envoie chaque
 * fichier au VPS (`POST /klyra/v1/agent/joint`, octets bruts), qui le range dans `donnees/joints/<conversation>/`
 * et répond son chemin ; le message porte alors ce chemin à la place de celui du PC, et la session de
 * Claude Code reçoit ce dossier en lecture (`--add-dir`), comme les dossiers des pièces jointes sur le PC.
 *
 * Module pur, partagé : le PC (electron/agents-distants.ts) et le VPS (généré en serveur/joints-vps.mjs).
 */

export const CHEMIN_JOINT = "/klyra/v1/agent/joint";
/** Comme le composeur : 10 pièces au plus par message. */
export const JOINTS_MAX = 10;
/** Comme une capture collée (electron/collages.ts). */
export const JOINT_TAILLE_MAX = 20 * 1024 * 1024;
/** Les mêmes que les conversations du VPS (serveur/agents.mjs). */
const CONVERSATION = /^[A-Za-z0-9_.:@|-]{1,160}$/;

export class ErreurJoint extends Error {}

export function conversationValide(conversation: unknown): conversation is string {
  return typeof conversation === "string" && CONVERSATION.test(conversation);
}

/** Le nom d'un fichier joint, sans dossier, sans caractère qui gênerait un shell ou un chemin. */
export function nomJoint(nom: unknown): string {
  const base = typeof nom === "string" ? (nom.split(/[\\/]/).pop() ?? "") : "";
  const propre = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(-120);
  return propre || "fichier";
}

/** Le dossier des pièces jointes d'une conversation, dans les données du serveur. */
export function dossierJoints(donnees: string, conversation: string): string {
  return path.join(donnees, "joints", conversation.replace(/[^A-Za-z0-9_-]/g, "_"));
}

/** Le nom rangé : l'empreinte d'abord (la même capture envoyée deux fois n'est gardée qu'une fois), puis son nom. */
export function nomStocke(empreinte: string, nom: string): string {
  return `${empreinte.slice(0, 16)}-${nomJoint(nom)}`;
}

/**
 * Le message envoyé au VPS : chaque ligne « - <chemin du PC> » d'un fichier envoyé porte son chemin sur le VPS
 * (cf. « [Fichiers joints, à lire] » dans src/lib/workspace.tsx). Le reste du message ne change pas.
 */
export function remplacerJoints(prompt: string, envoyes: ReadonlyArray<readonly [string, string]>): string {
  if (!envoyes.length) return prompt;
  const table = new Map(envoyes);
  return prompt
    .split("\n")
    .map((ligne) => {
      if (!ligne.startsWith("- ")) return ligne;
      const vps = table.get(ligne.slice(2));
      return vps ? `- ${vps}` : ligne;
    })
    .join("\n");
}

export interface AccesJoints {
  /** La taille d'un fichier de ce PC ; null s'il n'y est pas (un chemin du VPS, un fichier effacé). */
  taille: (chemin: string) => number | null;
  lire: (chemin: string) => Promise<Uint8Array>;
  /** Envoie un fichier au VPS : `status` et réponse JSON de la route. */
  envoyer: (nom: string, octets: Uint8Array) => Promise<{ status: number; json: unknown }>;
}

/**
 * Envoie au VPS les fichiers joints présents sur ce PC, et renvoie pour chacun [chemin du PC, chemin du VPS].
 * Un chemin absent de ce PC reste tel quel : c'est peut-être déjà un fichier du VPS (arbre d'un projet du serveur).
 * Échec : une `ErreurJoint` au message lisible, le message ne part pas avec un chemin qui ne mène nulle part.
 */
export async function envoyerJoints(fichiers: readonly string[], acces: AccesJoints): Promise<Array<[string, string]>> {
  const uniques = [...new Set(fichiers.filter((f) => typeof f === "string" && f))];
  const presents = uniques.flatMap((chemin) => {
    const taille = acces.taille(chemin);
    return taille === null ? [] : [{ chemin, taille }];
  });
  if (presents.length > JOINTS_MAX) throw new ErreurJoint(`${JOINTS_MAX} fichiers joints au plus par message vers le VPS.`);
  const envoyes: Array<[string, string]> = [];
  for (const { chemin, taille } of presents) {
    const nom = nomJoint(chemin);
    if (taille > JOINT_TAILLE_MAX) throw new ErreurJoint(`« ${nom} » dépasse ${JOINT_TAILLE_MAX / 1024 / 1024} Mo : il ne peut pas partir au VPS.`);
    let recu: { status: number; json: unknown };
    try {
      recu = await acces.envoyer(nom, await acces.lire(chemin));
    } catch {
      throw new ErreurJoint(`« ${nom} » n’a pas pu partir au VPS : le serveur ne répond pas.`);
    }
    if (recu.status === 401) throw new ErreurJoint("Ce PC n’est plus relié à ce VPS. Relance la commande sur le VPS et colle le nouveau lien dans Serveurs.");
    if (recu.status === 404) throw new ErreurJoint("Ce VPS ne reçoit pas encore les pièces jointes : relance la commande d’installation pour le mettre à jour.");
    const vps = (recu.json as { chemin?: unknown } | null)?.chemin;
    if (recu.status !== 200 || typeof vps !== "string" || !vps) {
      const message = (recu.json as { message?: unknown } | null)?.message;
      throw new ErreurJoint(typeof message === "string" && message ? message : `« ${nom} » n’a pas pu être rangé sur le VPS.`);
    }
    envoyes.push([chemin, vps]);
  }
  return envoyes;
}
