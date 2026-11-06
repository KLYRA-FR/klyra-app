/**
 * Les pièces jointes envoyées par l'app pour une conversation de ce VPS (règles communes : joints-vps.mjs,
 * généré depuis electron/joints-vps.ts). Chaque fichier est rangé dans `donnees/joints/<conversation>/`,
 * nommé par son empreinte : la même capture envoyée deux fois n'est écrite qu'une fois. Rien n'est effacé
 * ici : les messages envoyés y renvoient, comme les captures collées gardées dans `collages/` sur le PC.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { conversationValide, dossierJoints, ErreurJoint, JOINT_TAILLE_MAX, nomStocke } from "./joints-vps.mjs";

export { ErreurJoint };

/** @param {{ donnees: string }} options */
export function creerJoints(options) {
  const donnees = path.resolve(options.donnees);

  /** Le dossier des pièces jointes d'une conversation (même s'il n'existe pas encore). */
  function dossier(conversation) {
    if (!conversationValide(conversation)) throw new ErreurJoint("Conversation invalide.");
    return dossierJoints(donnees, conversation);
  }

  /**
   * Range un fichier reçu et renvoie son chemin sur ce VPS.
   * @param {unknown} conversation @param {unknown} nom @param {Buffer} octets
   */
  function recevoir(conversation, nom, octets) {
    const ici = dossier(conversation);
    if (!Buffer.isBuffer(octets) || !octets.length) throw new ErreurJoint("Fichier vide.");
    if (octets.length > JOINT_TAILLE_MAX) throw new ErreurJoint(`Fichier de plus de ${JOINT_TAILLE_MAX / 1024 / 1024} Mo.`);
    const cible = path.join(ici, nomStocke(createHash("sha256").update(octets).digest("hex"), String(nom ?? "")));
    if (existsSync(cible)) return cible;
    mkdirSync(ici, { recursive: true, mode: 0o700 });
    const tmp = `${cible}.${process.pid}.tmp`;
    writeFileSync(tmp, octets, { mode: 0o600 });
    renameSync(tmp, cible);
    return cible;
  }

  return { dossier, recevoir };
}
