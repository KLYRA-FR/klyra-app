/**
 * L'identité du navigateur de KLYRA : celle du Google Chrome du même numéro,
 * pareille partout où un site peut la lire (règles pures, testées par `identite.test.mts`).
 *
 * Electron s'annonce comme « Chromium » dans les Client Hints (`Sec-CH-UA`,
 * `navigator.userAgentData`), avec son numéro complet dans l'identité : un site
 * voit alors un Chrome qui n'en est pas un. Google refuse la connexion dans ce
 * cas (« Ce navigateur ou cette application ne sont peut-être pas sécurisés »).
 * On annonce donc ce que le vrai Chrome annoncerait sur ce poste : identité
 * réduite (`Chrome/146.0.0.0`), et les trois marques dans l'ordre que Chrome
 * tire de son numéro (algorithme « GREASE » de Chromium, `user_agent_utils.cc`).
 */

export interface Marque {
  brand: string;
  version: string;
}

/** Ce que `Emulation.setUserAgentOverride` attend dans `userAgentMetadata`. */
export interface MetadonneesAgent {
  brands: Marque[];
  fullVersionList: Marque[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
}

export interface IdentiteNavigateur {
  userAgent: string;
  metadonnees: MetadonneesAgent;
}

/** Ce que le poste dit de lui (lu par le main), et ce que Chromium en a déjà tiré, quand on l'a. */
export interface Poste {
  /** `process.versions.chrome`, ex. « 146.0.7680.65 ». */
  versionChrome: string;
  /** `process.platform`. */
  systeme: string;
  /** `process.arch`. */
  arch: string;
  /** `process.getSystemVersion()` : « 15.3.1 » sur Mac, « 10.0.26100 » sous Windows. */
  versionSysteme: string;
  /** Les valeurs « hautes » de `navigator.userAgentData` lues dans l'app, plus justes que nos déductions. */
  natif?: Partial<Pick<MetadonneesAgent, "platformVersion" | "architecture" | "bitness" | "wow64" | "model">> | null;
}

const CARACTERES_GREASE = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const VERSIONS_GREASE = ["8", "99", "24"];
const ORDRES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/** Les trois marques de Chrome, dans l'ordre et avec la fausse marque que Chrome tire de son numéro. */
export function marquesChrome(versionChrome: string, complete: boolean): Marque[] {
  const majeure = Number.parseInt(versionChrome, 10);
  if (!Number.isFinite(majeure) || majeure <= 0) throw new Error(`Version de Chrome illisible : ${versionChrome}`);
  const n = CARACTERES_GREASE.length;
  const fausse = `Not${CARACTERES_GREASE[majeure % n]}A${CARACTERES_GREASE[(majeure + 1) % n]}Brand`;
  const versionFausse = VERSIONS_GREASE[majeure % VERSIONS_GREASE.length];
  const version = complete ? versionChrome : String(majeure);
  const marques: Marque[] = new Array(3);
  const ordre = ORDRES[majeure % ORDRES.length];
  marques[ordre[0]] = { brand: fausse, version: complete ? `${versionFausse}.0.0.0` : versionFausse };
  marques[ordre[1]] = { brand: "Chromium", version };
  marques[ordre[2]] = { brand: "Google Chrome", version };
  return marques;
}

/** Une liste de marques telle que dans l'en-tête `Sec-CH-UA` : `"Google Chrome";v="146", …`. */
export function enteteMarques(marques: Marque[]): string {
  return marques.map((m) => `"${m.brand}";v="${m.version}"`).join(", ");
}

/**
 * La version de Windows que Chrome annonce : celle de l'« Universal API Contract »,
 * pas le numéro du noyau (Windows 11 24H2 → « 19.0.0 »). Déduite du numéro de build
 * quand l'app n'a pas pu la lire elle-même.
 */
export function versionWindowsChrome(versionSysteme: string): string {
  const build = Number.parseInt(versionSysteme.split(".")[2] ?? "", 10);
  if (!Number.isFinite(build)) return "10.0.0";
  if (build >= 26100) return "19.0.0";
  if (build >= 22621) return "15.0.0";
  if (build >= 22000) return "14.0.0";
  if (build >= 19041) return "10.0.0";
  if (build >= 18362) return "8.0.0";
  if (build >= 17763) return "7.0.0";
  return "1.0.0";
}

/** Le morceau « système » de l'identité, tel que Chrome l'écrit (figé par Chrome depuis 2023). */
function systemeDansIdentite(systeme: string): string {
  if (systeme === "win32") return "Windows NT 10.0; Win64; x64";
  if (systeme === "darwin") return "Macintosh; Intel Mac OS X 10_15_7";
  return "X11; Linux x86_64";
}

function nomSysteme(systeme: string): string {
  if (systeme === "win32") return "Windows";
  if (systeme === "darwin") return "macOS";
  if (systeme === "linux") return "Linux";
  return "Unknown";
}

function versionTriple(v: string): string {
  const parties = v.split(".").filter((x) => /^\d+$/.test(x));
  while (parties.length < 3) parties.push("0");
  return parties.slice(0, 3).join(".");
}

/** L'identité complète : la chaîne d'identité et les Client Hints, ceux d'un Google Chrome sur ce poste. */
export function identiteChrome(poste: Poste): IdentiteNavigateur {
  const majeure = Number.parseInt(poste.versionChrome, 10);
  const marques = marquesChrome(poste.versionChrome, false);
  const natif = poste.natif ?? {};
  const arm = poste.arch === "arm64" || poste.arch === "arm";
  const platformVersion =
    natif.platformVersion ||
    (poste.systeme === "win32" ? versionWindowsChrome(poste.versionSysteme) : versionTriple(poste.versionSysteme));
  return {
    userAgent: `Mozilla/5.0 (${systemeDansIdentite(poste.systeme)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majeure}.0.0.0 Safari/537.36`,
    metadonnees: {
      brands: marques,
      fullVersionList: marquesChrome(poste.versionChrome, true),
      fullVersion: poste.versionChrome,
      platform: nomSysteme(poste.systeme),
      platformVersion,
      architecture: natif.architecture ?? (arm ? "arm" : "x86"),
      model: natif.model ?? "",
      mobile: false,
      bitness: natif.bitness ?? (poste.arch === "ia32" || poste.arch === "arm" ? "32" : "64"),
      wow64: natif.wow64 ?? false,
    },
  };
}

/** Les indices détaillés qu'un site peut demander par `Accept-CH` (ceux que Chrome connaît pour l'identité). */
const INDICES_DETAILLES = [
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-form-factors",
  "sec-ch-ua-full-version",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-model",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-wow64",
] as const;

/** Les indices détaillés qu'une réponse demande (`Accept-CH: Sec-CH-UA-Arch, …`), sans les inconnus. */
export function indicesDemandes(acceptCh: string | string[] | undefined): string[] {
  const brut = Array.isArray(acceptCh) ? acceptCh.join(",") : (acceptCh ?? "");
  const connus = new Set<string>(INDICES_DETAILLES);
  return [...new Set(brut.split(",").map((x) => x.trim().toLowerCase()))].filter((x) => connus.has(x));
}

/** Une adresse à laquelle Chrome envoie les Client Hints : https, ou un serveur de ce poste. */
export function recoitIndices(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname));
  } catch {
    return false;
  }
}

const guillemets = (v: string) => `"${v}"`;
const booleen = (v: boolean) => (v ? "?1" : "?0");

/** La valeur de chaque indice, pour ce poste. */
function valeursIndices(identite: IdentiteNavigateur): Record<string, string> {
  const m = identite.metadonnees;
  return {
    "sec-ch-ua": enteteMarques(m.brands),
    "sec-ch-ua-mobile": booleen(m.mobile),
    "sec-ch-ua-platform": guillemets(m.platform),
    "sec-ch-ua-arch": guillemets(m.architecture),
    "sec-ch-ua-bitness": guillemets(m.bitness),
    "sec-ch-ua-form-factors": guillemets("Desktop"),
    "sec-ch-ua-full-version": guillemets(m.fullVersion),
    "sec-ch-ua-full-version-list": enteteMarques(m.fullVersionList),
    "sec-ch-ua-model": guillemets(m.model),
    "sec-ch-ua-platform-version": guillemets(m.platformVersion),
    "sec-ch-ua-wow64": booleen(m.wow64),
  };
}

/**
 * Les en-têtes d'une requête avec les Client Hints que Chrome enverrait : Electron n'en envoie aucun.
 * Les trois de base vers toute adresse qui les reçoit, les détaillés seulement si le site les a
 * demandés (`demandes`). Ceux qu'Electron aurait déjà mis sont remplacés.
 */
export function entetesAvecIndices(entetes: Record<string, string>, url: string, identite: IdentiteNavigateur, demandes: Iterable<string> = []): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(entetes)) if (!/^sec-ch-ua(-|$)/i.test(cle)) sortie[cle] = valeur;
  if (!recoitIndices(url)) return sortie;
  const valeurs = valeursIndices(identite);
  for (const cle of ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", ...demandes]) if (valeurs[cle] !== undefined) sortie[cle] = valeurs[cle];
  return sortie;
}

/**
 * Une page de connexion de Google (le compte Google lui-même, pas un site qui propose
 * « Se connecter avec Google » : celui-là y renvoie). La personne s'y connecte elle-même :
 * l'agent n'y agit pas, il passe la main.
 */
export function estConnexionGoogle(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

/** Ce que l'agent reçoit s'il veut agir sur une page de connexion de Google. */
export const CONNEXION_GOOGLE =
  "C'est la page de connexion de Google : la personne s'y connecte elle-même, jamais un agent (Google refuse une connexion pilotée). Passe-lui la main (action passer_la_main), puis attends qu'elle te dise que c'est fait.";
