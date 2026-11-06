/**
 * Le Chrome de ce poste, les règles pures (testées par `chrome-regles.test.mts`) : où le
 * trouver, comment le lancer, ce qu'il écrit en démarrant.
 *
 * Deux façons de le lancer, avec le même profil KLYRA (jamais celui de la personne) :
 * - `personne` : un Chrome ordinaire, sans pilotage. C'est là que la personne se connecte
 *   elle-même (Google refuse une connexion dans un navigateur piloté, `navigator.webdriver`).
 * - `agent` : le même profil, pilotable par le protocole de débogage sur un port local choisi
 *   par Chrome. La session ouverte par la personne y est déjà.
 * Un profil ne s'ouvre qu'une fois à la fois : les deux modes ne coexistent jamais.
 */

export type ModeChrome = "personne" | "agent";

/** Les emplacements habituels de Google Chrome (puis Chromium), par système. */
export function cheminsCandidatsChrome(systeme: string, env: Record<string, string | undefined>): string[] {
  const force = env.KLYRA_CHROME_PATH?.trim();
  const liste: string[] = force ? [force] : [];
  if (systeme === "win32") {
    for (const racine of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]) {
      if (racine) liste.push(`${racine}\\Google\\Chrome\\Application\\chrome.exe`);
    }
    if (!env.PROGRAMFILES) liste.push("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  } else if (systeme === "darwin") {
    liste.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    if (env.HOME) liste.push(`${env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`);
    liste.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    liste.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium");
  }
  return [...new Set(liste)];
}

/** Le premier emplacement qui existe, ou null. */
export function trouverChrome(systeme: string, env: Record<string, string | undefined>, existe: (chemin: string) => boolean): string | null {
  return cheminsCandidatsChrome(systeme, env).find(existe) ?? null;
}

/**
 * Les arguments de lancement. Le mode `personne` n'a rien de plus qu'un Chrome ordinaire (pas
 * de port de débogage : la page de connexion voit un vrai navigateur, que la personne utilise).
 * Le mode `agent` ouvre le port local (choisi par Chrome, écrit dans `DevToolsActivePort`) et
 * garde les onglets en arrière-plan actifs, pour qu'un agent y travaille sans qu'on les regarde.
 */
export function argumentsChrome(profil: string, mode: ModeChrome, url?: string): string[] {
  const args = [`--user-data-dir=${profil}`, "--no-first-run", "--no-default-browser-check"];
  if (mode === "agent") {
    args.push(
      "--remote-debugging-port=0",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    );
  }
  args.push(url && /^https?:\/\//i.test(url) ? url : "about:blank");
  return args;
}

/** Le contenu de `DevToolsActivePort` : le port, puis le chemin du point d'entrée du navigateur. */
export function lirePortActif(texte: string): { port: number; chemin: string } | null {
  const [ligne1, ligne2] = String(texte ?? "").split(/\r?\n/);
  const port = Number.parseInt(ligne1 ?? "", 10);
  const chemin = (ligne2 ?? "").trim();
  if (!Number.isInteger(port) || port <= 0 || port > 65_535 || !chemin.startsWith("/devtools/browser/")) return null;
  return { port, chemin };
}

/** Ce que l'écran et l'agent lisent quand Chrome manque. */
export const CHROME_ABSENT =
  "Google Chrome n’est pas installé sur ce poste (ou pas à un endroit connu). Installe-le, ou repasse au navigateur intégré dans Réglages › Navigateur.";

/** Ce que l'agent lit tant que la personne se connecte dans Chrome. */
export const CHROME_A_LA_PERSONNE =
  "Chrome est ouvert pour que la personne se connecte elle-même : attends qu’elle te dise que c’est fait, puis reprends.";
