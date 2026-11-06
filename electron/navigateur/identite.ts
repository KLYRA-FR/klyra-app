/**
 * L'identité du navigateur intégré (règles pures, testées par `identite.test.mts`), sur le modèle
 * d'OpenBot (`browser-identity.ts`, `browser-policy.ts`) : le Chromium d'Electron, tel qu'il est,
 * sans rien prétendre de plus.
 *
 * - Les pages voient l'identité de Chromium sans « Electron » ni le nom de l'app (certains sites
 *   refusent un navigateur embarqué), avec son vrai numéro.
 * - Electron n'envoie aucun en-tête Client Hints : on ajoute ceux de base, avec les mêmes marques
 *   que `navigator.userAgentData` (Chromium et sa fausse marque, jamais « Google Chrome ») : un
 *   en-tête qui contredit la page est refusé (Cloudflare, Google).
 * - Sur `accounts.google.com` seulement, l'identité garde « Electron » : Google refuse l'étape de
 *   l'identifiant sans elle (constat d'OpenBot), et accepte un navigateur intégré qui se déclare.
 * Rien d'autre : ni identité de Google Chrome, ni protocole de débogage branché d'avance.
 */

/** L'identité de Chromium, sans « Electron » ni le nom de l'app. */
export function agentUtilisateur(ua: string, nomApp: string): string {
  const echappe = nomApp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return ua.replace(new RegExp(`\\s(Electron|klyra-app|KLYRA|${echappe})\\/\\S+`, "gi"), "").replace(/\s{2,}/g, " ").trim();
}

/** Une page de connexion au compte Google. */
export function estConnexionGoogle(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.replace(/\.+$/, "") === "accounts.google.com";
  } catch {
    return false;
  }
}

/** L'identité envoyée à une adresse : celle de la session, plus « Electron » pour la connexion Google. */
export function agentPourRequete(url: string, uaSession: string, versionElectron: string): string {
  if (!estConnexionGoogle(url) || /\sElectron\//.test(uaSession)) return uaSession;
  return uaSession.replace(/(Chrome\/\S+)/, `$1 Electron/${versionElectron}`);
}

const CARACTERES_GREASE = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const VERSIONS_GREASE = ["8", "99", "24"];

/**
 * Les marques de `navigator.userAgentData` d'Electron, telles que Chromium les tire de son numéro
 * (`GenerateBrandVersionList`, `user_agent_utils.cc`) : une fausse marque et « Chromium ».
 */
export function enteteMarques(versionChrome: string): string {
  const majeure = Number.parseInt(versionChrome, 10);
  if (!Number.isFinite(majeure) || majeure <= 0) throw new Error(`Version de Chromium illisible : ${versionChrome}`);
  const n = CARACTERES_GREASE.length;
  const fausse = `"Not${CARACTERES_GREASE[majeure % n]}A${CARACTERES_GREASE[(majeure + 1) % n]}Brand";v="${VERSIONS_GREASE[majeure % VERSIONS_GREASE.length]}"`;
  const chromium = `"Chromium";v="${majeure}"`;
  return majeure % 2 === 0 ? `${fausse}, ${chromium}` : `${chromium}, ${fausse}`;
}

/** Les trois indices de base, ceux que Chrome envoie à toute page sûre. */
export function indicesDeBase(versionChrome: string, systeme: string): Record<string, string> {
  const plateforme = systeme === "darwin" ? "macOS" : systeme === "win32" ? "Windows" : "Linux";
  return { "Sec-CH-UA": enteteMarques(versionChrome), "Sec-CH-UA-Mobile": "?0", "Sec-CH-UA-Platform": `"${plateforme}"` };
}

/** Une adresse à laquelle Chrome envoie les Client Hints : https, ou un serveur de ce poste. */
export function recoitIndices(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
}

/** Les en-têtes d'une requête du navigateur intégré : son identité, et les indices de base qui manquent. */
export function entetesNavigateur(
  entetes: Record<string, string>,
  url: string,
  poste: { versionChrome: string; versionElectron: string; systeme: string },
): Record<string, string> {
  const sortie = { ...entetes };
  const cleUa = Object.keys(sortie).find((c) => c.toLowerCase() === "user-agent");
  if (cleUa) sortie[cleUa] = agentPourRequete(url, sortie[cleUa], poste.versionElectron);
  if (recoitIndices(url)) {
    for (const [nom, valeur] of Object.entries(indicesDeBase(poste.versionChrome, poste.systeme))) {
      if (!Object.keys(sortie).some((c) => c.toLowerCase() === nom.toLowerCase())) sortie[nom] = valeur;
    }
  }
  return sortie;
}

/** Ce que l'agent reçoit s'il veut agir sur une page de connexion de Google. */
export const CONNEXION_GOOGLE =
  "C'est la page de connexion de Google : la personne s'y connecte elle-même, jamais un agent. Passe-lui la main (action passer_la_main), puis attends qu'elle te dise que c'est fait.";
