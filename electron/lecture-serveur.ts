/**
 * Lecture commune du lien d’appairage (`klyra://rejoindre?adresse=…&code=…`).
 * Le téléphone et le processus principal s’en servent : une origine https,
 * http seulement sur la machine locale, jamais une IP collée à la main.
 */

export const PROTOCOLE_SERVEUR = 1;
export const CHEMIN_SERVEUR = "/klyra/v1/serveur";
export const CHEMIN_APPAIRER = "/klyra/v1/appairer";
export const CHEMIN_APPAREIL = "/klyra/v1/appareil";

export const MESSAGE_SILENCE = "Ce serveur ne répond pas. S’il est éteint, la connexion échoue.";
/** Le jeton de cet appareil n’est plus reconnu (retiré, révoqué) ou n’a jamais existé. */
export const MESSAGE_INVITATION = "Cet appareil n’est plus relié à ce serveur. Relance la commande sur le VPS et colle le nouveau lien.";
export const MESSAGE_CODE = "Ce lien a expiré ou a déjà servi. Relance la commande sur le VPS pour en avoir un nouveau.";
export const MESSAGE_VERSION = "Ce serveur ne parle pas la même version.";
export const MESSAGE_REPONSE = "Ce serveur n’a pas répondu comme un VPS KLYRA.";

export type Saisie =
  | { ok: true; adresse: string; code: string | null }
  | { ok: false; message: string };

export type Lecture =
  | { ok: true; nom: string; version: string }
  | { ok: false; message: string };

export type Appairage =
  | { ok: true; nom: string; version: string; jeton: string }
  | { ok: false; message: string };

function estIpv4(hote: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hote);
}

/** Un lien d’appairage ou une adresse https. Sans code, le serveur doit déjà connaître cet appareil. */
export function lireSaisie(texte: string): Saisie {
  const brut = texte.trim();
  if (!brut) return { ok: false, message: "Colle le lien d’invitation." };
  if (estIpv4(brut.split("/")[0]?.split(":")[0] ?? "")) {
    return { ok: false, message: "Colle le lien d’invitation, pas une adresse IP." };
  }

  let codeLien: string | null = null;
  let candidat = brut;
  if (brut.toLowerCase().startsWith("klyra://")) {
    let lien: URL;
    try {
      lien = new URL(brut);
    } catch {
      return { ok: false, message: "Cette invitation n’est pas lisible." };
    }
    if (lien.hostname !== "rejoindre") return { ok: false, message: "Cette invitation n’est pas lisible." };
    const adresse = lien.searchParams.get("adresse")?.trim() ?? "";
    if (!adresse) return { ok: false, message: "Cette invitation n’a pas d’adresse." };
    codeLien = lien.searchParams.get("code");
    candidat = adresse;
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidat)) {
    return { ok: false, message: "Colle le lien d’invitation." };
  }

  let url: URL;
  try {
    url = new URL(candidat);
  } catch {
    return { ok: false, message: "Cette adresse n’est pas lisible." };
  }
  if (estIpv4(url.hostname) && url.hostname !== "127.0.0.1" && !brut.toLowerCase().startsWith("klyra://")) {
    return { ok: false, message: "Colle le lien d’invitation, pas une adresse IP." };
  }
  if (url.username || url.password) return { ok: false, message: "L’adresse ne doit pas contenir de mot de passe." };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, message: "L’adresse doit commencer par https://." };
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol === "http:" && !local) return { ok: false, message: "L’adresse doit commencer par https://." };
  if (!url.hostname || url.origin === "null" || url.origin.length > 200) return { ok: false, message: "Cette adresse n’est pas lisible." };

  const code = codeLien?.trim().toUpperCase() || null;
  if (code && !/^[A-Z0-9]{6,32}$/.test(code)) return { ok: false, message: "Cette invitation n’est pas lisible." };
  return { ok: true, adresse: url.origin, code };
}

export function lireCorps(statut: number, corps: unknown): Lecture {
  if (statut === 401) return { ok: false, message: MESSAGE_INVITATION };
  if (!corps || typeof corps !== "object") return { ok: false, message: MESSAGE_REPONSE };
  const recu = corps as Record<string, unknown>;
  if (recu.produit !== "klyra-serveur") return { ok: false, message: MESSAGE_REPONSE };
  if (recu.protocole !== PROTOCOLE_SERVEUR) return { ok: false, message: MESSAGE_VERSION };
  if (typeof recu.nom !== "string" || !recu.nom.trim() || typeof recu.version !== "string" || !recu.version.trim()) {
    return { ok: false, message: MESSAGE_REPONSE };
  }
  return { ok: true, nom: recu.nom.trim().slice(0, 80), version: recu.version.trim().slice(0, 40) };
}

/** Réponse de `POST /klyra/v1/appairer`. Le jeton ne sort jamais de là où il est gardé. */
export function lireAppairage(statut: number, corps: unknown): Appairage {
  if (statut === 401) return { ok: false, message: MESSAGE_CODE };
  if (statut === 409) return { ok: false, message: "Ce serveur a déjà trop d’appareils reliés. Retire-en un depuis un autre appareil." };
  const lu = lireCorps(statut, corps);
  if (!lu.ok) return lu;
  const jeton = (corps as Record<string, unknown>).jeton;
  if (typeof jeton !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(jeton)) return { ok: false, message: MESSAGE_REPONSE };
  return { ...lu, jeton };
}
