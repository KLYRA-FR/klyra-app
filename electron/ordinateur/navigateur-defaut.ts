/**
 * Le navigateur par défaut de la personne, ouvert dans une nouvelle fenêtre.
 * Pur : la lecture du système et le lancement sont dans fenetre-navigateur.ts.
 *
 * Pris en charge : Chrome, Edge, Firefox, Safari (Mac), Brave.
 * Le profil habituel est celui du navigateur : aucun chemin de profil, aucun
 * mode invité, aucun onglet ajouté à une fenêtre déjà ouverte.
 */

export type NavigateurConnu = "chrome" | "edge" | "firefox" | "safari" | "brave";

export interface LectureSysteme {
  plateforme: string;
  /** ProgId Windows ou identifiant de bundle Mac. */
  indice: string | null;
  /** Ligne « shell\open\command » Windows, s'il y en a une. */
  commande: string | null;
}

export interface Detection {
  etat: "connu" | "non_pris_en_charge" | "illisible" | "plateforme";
  navigateur: NavigateurConnu | null;
  nom: string;
  /** Exécutable Windows. Null sur Mac : on parle à l'application par son nom. */
  executable: string | null;
  message: string;
}

export interface PlanLancement {
  fichier: string;
  args: string[];
  /** Vrai : on attend la fin (osascript, open). Faux : le navigateur reste lancé. */
  attendre: boolean;
}

const NOMS: Record<NavigateurConnu, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  safari: "Safari",
  brave: "Brave",
};

const APP_MAC: Record<NavigateurConnu, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  safari: "Safari",
  brave: "Brave Browser",
};

const BUNDLES: Record<string, NavigateurConnu> = {
  "com.google.chrome": "chrome",
  "com.microsoft.edgemac": "edge",
  "org.mozilla.firefox": "firefox",
  "com.apple.safari": "safari",
  "com.brave.browser": "brave",
};

const NOMS_CONNUS: Record<string, string> = {
  "com.operasoftware.opera": "Opera",
  "company.thebrowser.browser": "Arc",
  "com.vivaldi.vivaldi": "Vivaldi",
  "org.chromium.chromium": "Chromium",
  "com.duckduckgo.macos.browser": "DuckDuckGo",
  "com.google.chrome.canary": "Chrome Canary",
  "com.google.chrome.beta": "Chrome Beta",
};

export const MESSAGE_PLATEFORME = "La détection du navigateur par défaut se fait sur Windows et sur Mac. Sur cet ordinateur, rien n'a été ouvert.";
export const MESSAGE_ILLISIBLE = "Le navigateur par défaut n'a pas pu être lu. Rien n'a été ouvert.";

const INTERDIT = /user-data-dir|profile-directory|--profile\b|-profile\b|(?:^|\s)-P(?:\s|$)|incognito|--guest\b/i;

export function messageNonPrisEnCharge(nom: string): string {
  return `Le navigateur par défaut (${nom}) n'est pas pris en charge. KLYRA ouvre seulement Chrome, Edge, Firefox, Safari ou Brave, dans une nouvelle fenêtre, sans toucher aux onglets déjà ouverts. Rien n'a été ouvert.`;
}

export function phraseConsigne(): string {
  return "Navigateur de la personne, en local : pour le piloter avec Computer Use, ouvre-le seulement avec l'outil ordinateur_fenetre_navigateur. Il détecte le navigateur par défaut sur Windows et sur Mac (Chrome, Edge, Firefox, Safari ou Brave) et l'ouvre dans une nouvelle fenêtre, avec le profil habituel, sans rien y modifier et sans ajouter d'onglet aux fenêtres déjà ouvertes. Le panneau Navigateur capture cette fenêtre. Si l'outil dit que ce navigateur n'est pas pris en charge, répète son message et n'ouvre rien d'autre.";
}

/** ProgId ou bundle → navigateur connu, ou un nom à montrer tel quel. */
export function reconnaitre(indice: string): { navigateur: NavigateurConnu | null; nom: string } {
  const brut = indice.trim();
  const cle = brut.toLowerCase();
  const bundle = BUNDLES[cle];
  if (bundle) return { navigateur: bundle, nom: NOMS[bundle] };
  if (/^chromehtml\b/.test(cle)) return { navigateur: "chrome", nom: NOMS.chrome };
  if (/^msedgehtm\b/.test(cle) || cle.startsWith("appxq0fevzme2pys62n3e0fbqa7peapykr8v")) return { navigateur: "edge", nom: NOMS.edge };
  if (/^firefoxurl\b/.test(cle)) return { navigateur: "firefox", nom: NOMS.firefox };
  if (/^bravehtml\b/.test(cle)) return { navigateur: "brave", nom: NOMS.brave };
  if (/^safarihtml\b/.test(cle)) return { navigateur: "safari", nom: NOMS.safari };
  const nom = NOMS_CONNUS[cle] ?? (brut.slice(0, 120) || "inconnu");
  return { navigateur: null, nom };
}

export function progIdDepuisReg(sortie: string): string | null {
  const m = sortie.match(/ProgId\s+REG_\w+\s+(\S+)/i);
  return m?.[1] && progIdSur(m[1]) ? m[1] : null;
}

export function valeurReg(sortie: string): string | null {
  const m = sortie.match(/REG_\w+\s+(.+)/);
  const v = m?.[1]?.trim();
  return v || null;
}

/** Un ProgId sert de fragment de chemin de registre : rien d'autre que ces caractères. */
export function progIdSur(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(id);
}

export function executableDepuisCommande(commande: string): string | null {
  const t = commande.trim();
  const quoted = t.match(/^"([^"]+)"/);
  const chemin = (quoted ? quoted[1] : t.split(/\s+/)[0]) ?? "";
  return executableSur(chemin) ? chemin : null;
}

export function executableSur(chemin: string): boolean {
  if (!chemin || chemin.length > 260 || /[\r\n&|;`]/.test(chemin)) return false;
  return /^[A-Za-z]:\\[^"]+$/.test(chemin) || /^\\\\[^"]+$/.test(chemin);
}

/** L'identifiant https (sinon http) dans le plist LaunchServices, déjà en JSON. */
export function bundleDepuisHandlers(lu: unknown): string | null {
  const handlers = estObjet(lu) && Array.isArray(lu.LSHandlers) ? lu.LSHandlers : null;
  if (!handlers) return null;
  const scheme = (s: string) => handlers.find((h) => estObjet(h) && h.LSHandlerURLScheme === s);
  const handler = scheme("https") ?? scheme("http");
  if (!estObjet(handler)) return null;
  const id = handler.LSHandlerRoleAll ?? handler.LSHandlerRoleViewer;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Null : pas d'adresse (fenêtre vide). « refus » : on n'ouvre rien. */
export function adresseHttp(url: string | undefined): string | null | "refus" {
  if (url === undefined || url.trim() === "") return null;
  const t = url.trim();
  if (t.length > 2_000 || /[\s"'\\]/.test(t) || !/^https?:\/\//i.test(t)) return "refus";
  return t;
}

export function detectionDe(l: LectureSysteme): Detection {
  if (l.plateforme !== "win32" && l.plateforme !== "darwin") {
    return { etat: "plateforme", navigateur: null, nom: "", executable: null, message: MESSAGE_PLATEFORME };
  }
  if (!l.indice) return { etat: "illisible", navigateur: null, nom: "", executable: null, message: MESSAGE_ILLISIBLE };
  const r = reconnaitre(l.indice);
  if (!r.navigateur) return { etat: "non_pris_en_charge", navigateur: null, nom: r.nom, executable: null, message: messageNonPrisEnCharge(r.nom) };
  if (r.navigateur === "safari" && l.plateforme !== "darwin") {
    return { etat: "non_pris_en_charge", navigateur: null, nom: NOMS.safari, executable: null, message: "Safari n'est pris en charge que sur Mac. Rien n'a été ouvert." };
  }
  const executable = l.plateforme === "win32" ? executableDepuisCommande(l.commande ?? "") : null;
  return { etat: "connu", navigateur: r.navigateur, nom: r.nom, executable, message: "" };
}

export function planDeLancement(d: Detection, plateforme: string, url: string | null): PlanLancement | { erreur: string } {
  if (d.etat !== "connu" || !d.navigateur) return { erreur: d.message || MESSAGE_ILLISIBLE };
  if (plateforme === "darwin") {
    const app = APP_MAC[d.navigateur];
    if (d.navigateur === "firefox") {
      const args = ["-a", "Firefox", "--args", "-new-window", ...(url ? [url] : [])];
      return propre({ fichier: "open", args, attendre: true });
    }
    return propre({ fichier: "osascript", args: ["-e", scriptFenetre(app, url)], attendre: true });
  }
  if (plateforme === "win32") {
    if (!d.executable) return { erreur: `${d.nom} est le navigateur par défaut, mais son programme est introuvable. Rien n'a été ouvert.` };
    const drapeau = d.navigateur === "firefox" ? "-new-window" : "--new-window";
    return propre({ fichier: d.executable, args: [drapeau, ...(url ? [url] : [])], attendre: false });
  }
  return { erreur: MESSAGE_PLATEFORME };
}

/** La fenêtre de ce navigateur : celle au premier plan, sinon la dernière de la liste. */
export function fenetreDuNavigateur(enveloppe: unknown, navigateur: NavigateurConnu): { windowId: number; pid: number | null; titre: string } | null {
  const racine = estObjet(enveloppe) && estObjet(enveloppe.result) ? enveloppe.result : enveloppe;
  const sc = estObjet(racine) && estObjet(racine.structuredContent) ? racine.structuredContent : {};
  const liste = Array.isArray(sc.windows) ? sc.windows : estObjet(racine) && Array.isArray(racine.windows) ? racine.windows : [];
  const trouvées = liste.filter((w) => estObjet(w) && correspond(w, navigateur));
  const choisie = trouvées.find((w) => estObjet(w) && (w.focused === true || w.is_focused === true || w.frontmost === true)) ?? trouvées[trouvées.length - 1];
  if (!estObjet(choisie)) return null;
  const windowId = nombre(choisie.window_id);
  if (windowId == null) return null;
  return { windowId, pid: nombre(choisie.pid), titre: typeof choisie.title === "string" ? choisie.title.slice(0, 200) : NOMS[navigateur] };
}

function scriptFenetre(app: string, url: string | null): string {
  const nom = app.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (!url) return `tell application "${nom}" to make new window`;
  const u = url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (app === "Safari") return `tell application "Safari" to make new document with properties {URL:"${u}"}`;
  return `tell application "${nom}"\nmake new window\nset URL of active tab of front window to "${u}"\nend tell`;
}

function propre(plan: PlanLancement): PlanLancement | { erreur: string } {
  const texte = [plan.fichier, ...plan.args].join(" ");
  if (INTERDIT.test(texte) || /make new tab/i.test(texte)) return { erreur: "Refus : la commande toucherait au profil ou à un onglet déjà ouvert. Rien n'a été ouvert." };
  return plan;
}

function correspond(w: Record<string, unknown>, navigateur: NavigateurConnu): boolean {
  const texte = [w.app, w.app_name, w.owner, w.process_name, w.application, w.title].filter((v) => typeof v === "string").join("\n");
  switch (navigateur) {
    case "chrome":
      return /google chrome/i.test(texte) && !/chromium/i.test(texte);
    case "edge":
      return /microsoft edge|\bmsedge\b/i.test(texte);
    case "firefox":
      return /firefox/i.test(texte);
    case "safari":
      return /\bsafari\b/i.test(texte);
    case "brave":
      return /\bbrave\b/i.test(texte);
    default:
      return false;
  }
}

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === "object" && v !== null && !Array.isArray(v);

function nombre(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
