import type { EvenementBureau } from "../../convex/model/push";

/**
 * Notifications du téléphone (spec mobile § 8), côté app : ce que le navigateur sait faire, et le
 * relais de l'ordinateur. Le téléphone s'abonne (`src/components/telephone/push.ts`) ; l'ordinateur
 * prévient le compte quand sa fenêtre n'a pas le focus (`pousserAuTelephone`, `RelaisPush`).
 */

/** Ce que le navigateur de ce téléphone permet, avant de demander quoi que ce soit. */
export type EtatNavigateur = "non-supporte" | "iphone-a-installer" | "refusee" | "a-demander" | "accordee";

export interface Navigateur {
  userAgent: string;
  /** `navigator.maxTouchPoints` : un iPad se présente comme un Mac. */
  pointsTactiles: number;
  /** Ouverte depuis l'écran d'accueil (`display-mode: standalone`, `navigator.standalone`). */
  installee: boolean;
  /** `serviceWorker`, `PushManager` et `Notification` existent. */
  push: boolean;
  permission: NotificationPermission | null;
}

export function estIphone(n: Pick<Navigateur, "userAgent" | "pointsTactiles">): boolean {
  return /iPhone|iPad|iPod/.test(n.userAgent) || (/Macintosh/.test(n.userAgent) && n.pointsTactiles > 1);
}

/** Sur iPhone, les notifications demandent l'app posée sur l'écran d'accueil (iOS 16.4 et plus). */
export function etatNavigateur(n: Navigateur): EtatNavigateur {
  if (estIphone(n) && !n.installee) return "iphone-a-installer";
  if (!n.push || n.permission === null) return "non-supporte";
  if (n.permission === "denied") return "refusee";
  return n.permission === "granted" ? "accordee" : "a-demander";
}

export function lireNavigateur(): Navigateur {
  const installee =
    window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const push = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return {
    userAgent: navigator.userAgent,
    pointsTactiles: navigator.maxTouchPoints ?? 0,
    installee,
    push,
    permission: "Notification" in window ? Notification.permission : null,
  };
}

/** La clé publique VAPID (base64url) telle que `pushManager.subscribe` la demande. */
export function cleEnOctets(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(base64);
  const octets = new Uint8Array(new ArrayBuffer(brut.length));
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets;
}

/** Un abonnement du navigateur, tel que `notificationsPush:sAbonner` l'attend. */
export function champsAbonnement(abonnement: PushSubscription): { endpoint: string; p256dh: string; auth: string } | null {
  const json = abonnement.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  return json.endpoint && p256dh && auth ? { endpoint: json.endpoint, p256dh, auth } : null;
}

/* ─── L'ordinateur ───────────────────────────────────────────────── */

export const EVENEMENT_POUSSER = "klyra:pousser";

export interface DemandePush {
  evenement: EvenementBureau;
  titre: string;
  corps: string;
  lien: string;
}

/**
 * L'ordinateur prévient aussi le téléphone, aux mêmes moments que ses notifications. Pas de
 * doublon : rien ne part quand la fenêtre de KLYRA a le focus. `RelaisPush` (dans le compte)
 * l'envoie ; hors compte, l'événement se perd.
 */
export function pousserAuTelephone(demande: DemandePush) {
  if (typeof window === "undefined" || document.hasFocus()) return;
  window.dispatchEvent(new CustomEvent<DemandePush>(EVENEMENT_POUSSER, { detail: demande }));
}

/** L'écran d'un message : `/chat?id=…&message=…`, comme la recherche. */
export function lienMessage(chatId: string, messageId?: string): string {
  return `/chat?id=${encodeURIComponent(chatId)}${messageId ? `&message=${encodeURIComponent(messageId)}` : ""}`;
}

/** L'écran d'un workflow (Automatisations › Workflows). */
export function lienWorkflow(workflowId: string): string {
  return `/routines?vue=workflows&workflow=${encodeURIComponent(workflowId)}`;
}

/** Pourquoi ce téléphone ne peut pas recevoir de notifications, ou null s'il le peut. */
export function raisonSansNotifications(etat: EtatNavigateur | "sans-cles"): string | null {
  if (etat === "sans-cles") return "Les notifications du téléphone ne sont pas encore activées sur le compte KLYRA : rien ne part pour l’instant.";
  if (etat === "iphone-a-installer")
    return "Sur iPhone, les notifications demandent KLYRA sur l’écran d’accueil (iOS 16.4 ou plus) : ajoute-la depuis le menu Partager de Safari, puis ouvre-la depuis l’écran d’accueil.";
  if (etat === "non-supporte") return "Ce navigateur ne reçoit pas les notifications de KLYRA.";
  if (etat === "refusee") return "Les notifications de KLYRA sont refusées sur ce téléphone : autorise-les dans ses réglages, puis reviens ici.";
  return null;
}
