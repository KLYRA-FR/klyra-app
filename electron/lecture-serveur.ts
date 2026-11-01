/**
 * Lecture commune du lien d’invitation.
 * Le téléphone et le processus principal s’en servent : une origine https,
 * http seulement sur la machine locale, jamais une IP collée à la main.
 */

export const PROTOCOLE_SERVEUR = 1;
export const CHEMIN_SERVEUR = "/klyra/v1/serveur";

export const MESSAGE_SILENCE = "Ce serveur ne répond pas. S’il est éteint, la connexion échoue.";
export const MESSAGE_INVITATION = "Cette invitation n’est pas la bonne.";
export const MESSAGE_VERSION = "Ce serveur ne parle pas la même version.";
export const MESSAGE_REPONSE = "Ce serveur n’a pas répondu comme un VPS KLYRA.";

export type Saisie =
  | { ok: true; adresse: string; invitation: string | null }
  | { ok: false; message: string };

export type Lecture =
  | { ok: true; nom: string; version: string }
  | { ok: false; message: string };

function estIpv4(hote: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hote);
}

export function lireSaisie(texte: string, invitationSaisie: string): Saisie {
  const brut = texte.trim();
  if (!brut) return { ok: false, message: "Colle le lien d’invitation." };
  if (estIpv4(brut.split("/")[0]?.split(":")[0] ?? "")) {
    return { ok: false, message: "Colle le lien d’invitation, pas une adresse IP." };
  }

  let invitationLien: string | null = null;
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
    invitationLien = lien.searchParams.get("invitation");
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

  const champ = invitationSaisie.trim();
  const invitation = champ || invitationLien?.trim() || null;
  if (invitation && (invitation.length > 200 || /[\r\n]/.test(invitation))) {
    return { ok: false, message: "Cette invitation n’est pas lisible." };
  }
  return { ok: true, adresse: url.origin, invitation };
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
