/**
 * Textes de Réglages › Mobile (brief du 02/11, MO-T…). Les mots du poste viennent de
 * `plateforme.ts` (`poste.ce` : « ce PC », « ce Mac ») et sont passés en argument : rien ici
 * n'écrit « Mac » ni « PC » en dur.
 */

import { majuscule } from "./poste-texte";

export { majuscule };

export type ModeleTelephone = "iphone" | "android" | "navigateur";

/** Seulement trois mots sortent de l'userAgent : la chaîne brute n'est jamais envoyée ni affichée. */
export function modeleDe(userAgent: string): ModeleTelephone {
  if (/iPhone|iPod/.test(userAgent)) return "iphone";
  if (/Android/.test(userAgent)) return "android";
  return "navigateur";
}

/** MO-T8. null : une session qui ne s'est jamais signalée. */
export function nomModele(modele: ModeleTelephone | null): string {
  if (modele === "iphone") return "iPhone";
  if (modele === "android") return "Android";
  if (modele === "navigateur") return "Navigateur web";
  return "Appareil non identifié";
}

/** « cet iPhone » (MO-T9). */
export function cetAppareil(modele: ModeleTelephone | null): string {
  if (modele === "iphone") return "cet iPhone";
  if (modele === "android") return "ce téléphone Android";
  if (modele === "navigateur") return "ce navigateur web";
  return "cet appareil";
}

const deux = (n: number) => String(n).padStart(2, "0");
const jourMois = (d: Date) => `${deux(d.getDate())}/${deux(d.getMonth() + 1)}`;
const heure = (d: Date) => `${deux(d.getHours())}:${deux(d.getMinutes())}`;
const memeJour = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** « à 18:42 » (aujourd'hui), « hier », « le 31/10 ». */
export function quand(ms: number, maintenant: number): string {
  const d = new Date(ms);
  const auj = new Date(maintenant);
  if (memeJour(d, auj)) return `à ${heure(d)}`;
  const veille = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate() - 1);
  if (memeJour(d, veille)) return "hier";
  return `le ${jourMois(d)}`;
}

/** « Connecté le 02/11 · vu à 18:42 » (MO-T8). */
export function detailTelephone(connecteLe: number, vu: number, maintenant: number): string {
  return `Connecté le ${jourMois(new Date(connecteLe))} · vu ${quand(vu, maintenant)}`;
}

/** « Fermé depuis 18:42 », « Fermé depuis hier », « Fermé depuis le 31/10 ». */
export function fermeDepuis(dernierSignal: number, maintenant: number): string {
  const q = quand(dernierSignal, maintenant);
  return `Fermé depuis ${q.startsWith("à ") ? q.slice(2) : q}`;
}

/** « Klyra-VPS », « Klyra-VPS ou Atelier ». */
export function nomsVps(noms: string[]): string {
  if (noms.length <= 1) return noms[0] ?? "";
  return `${noms.slice(0, -1).join(", ")} ou ${noms.at(-1)}`;
}

/** Le dernier maillon de la chaîne : l'agent, sur ce poste ou sur le VPS. */
export function maillonAgent(ce: string, vps: string[]): string {
  return vps.length ? `L’agent, sur ${ce} ou sur ${nomsVps(vps)}` : `L’agent, sur ${ce}`;
}

/** MO-T3. */
export function phraseChemin(ce: string, vps: string[]): string {
  const Ce = majuscule(ce);
  const ou = vps.length ? `, ici ou sur ${nomsVps(vps)} selon la conversation` : "";
  return `Ce que tu écris sur ton téléphone passe par ton compte. ${Ce} le reprend et l’envoie à l’agent${ou}. ${Ce} fermé, tes messages attendent son ouverture.`;
}

/** MO-T11 : ce qui passe par le poste, et ce qui n'en dépend pas. */
export function phraseVps(ce: string, nombre: number): string {
  const ses = nombre > 1 ? "Leurs" : "Ses";
  return `${ses} conversations passent par ${ce}. ${ses} routines tournent même ${ce} fermé ; leur réponse arrive sur ton téléphone quand ${ce} se rouvre. Ton téléphone ne ${nombre > 1 ? "leur" : "lui"} écrit pas encore en direct.`;
}

/** MO-T12. */
export function phrasePerdu(ce: string, vps: string[]): string {
  if (!vps.length) return "Téléphone perdu : déconnecte-le ici.";
  return `Téléphone perdu : déconnecte-le ici. S’il était aussi relié à ${nomsVps(vps)}, lance revoquer-tout sur le VPS : tous ses appareils sont retirés, ${ce} compris.`;
}

/** MO-T9. */
export function confirmationDeconnexion(modele: ModeleTelephone | null, vps: string[]): { titre: string; texte: string } {
  const lien = vps.length ? ` Son lien avec ${nomsVps(vps)} ne change pas.` : "";
  return {
    titre: `Déconnecter ${cetAppareil(modele)} ?`,
    texte: `Il ne verra plus tes conversations. Pour revenir, il faudra te reconnecter avec ton adresse e-mail.${lien}`,
  };
}
