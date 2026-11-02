/**
 * Notifications du téléphone (spec mobile § 8) : les règles partagées par Convex, l'action d'envoi
 * et l'app (Réglages › Ce téléphone). Rien ici ne lit la base ni le réseau.
 */

/** Les événements du téléphone. Les quatre premiers partent de l'ordinateur, le dernier de Convex. */
export const EVENEMENTS_PUSH = ["accord", "agentFini", "agentErreur", "workflow", "ouverture"] as const;
export type EvenementPush = (typeof EVENEMENTS_PUSH)[number];
export type EvenementBureau = Exclude<EvenementPush, "ouverture">;
export type PreferencesPush = Record<EvenementPush, boolean>;

/** Tout est actif au départ : « demande ton accord » est nouveau et activé par défaut ; « s'est ouvert » ne part qu'après une demande. */
export const PREFERENCES_PAR_DEFAUT: PreferencesPush = { accord: true, agentFini: true, agentErreur: true, workflow: true, ouverture: true };

/** Le JSON gardé dans `abonnementsPush.preferences`, complété par les valeurs par défaut. */
export function lirePreferences(json: string): PreferencesPush {
  let brut: unknown = null;
  try {
    brut = JSON.parse(json);
  } catch {
    brut = null;
  }
  const lu = { ...PREFERENCES_PAR_DEFAUT };
  if (brut && typeof brut === "object") {
    for (const evenement of EVENEMENTS_PUSH) {
      const valeur = (brut as Record<string, unknown>)[evenement];
      if (typeof valeur === "boolean") lu[evenement] = valeur;
    }
  }
  return lu;
}

export const ecrirePreferences = (preferences: PreferencesPush) => JSON.stringify(preferences);

/** Ce que le service worker affiche (`public/sw.js`). */
export interface MessagePush {
  titre: string;
  corps: string;
  /** Écran ouvert au toucher : un chemin de l'app, jamais une adresse. */
  lien: string;
  /** Une notification du même tag remplace la précédente. */
  tag: string;
}

export const TITRE_MAX = 120;
export const CORPS_MAX = 240;

const couper = (texte: string, max: number) => {
  const propre = texte.replace(/\s+/g, " ").trim();
  return propre.length > max ? `${propre.slice(0, max - 1).trimEnd()}…` : propre;
};

/** Un chemin de l'app (`/chat?id=…&message=…`, `/routines?…`) : ni adresse, ni `//`, ni protocole. */
export function lienValable(lien: string): boolean {
  return lien.length <= 600 && /^\/[a-z-]*(\?[^\s#]*)?$/.test(lien);
}

/** Le message tel qu'il part, ou null s'il n'est pas valable. */
export function messagePush(evenement: EvenementPush, titre: string, corps: string, lien: string): MessagePush | null {
  const t = couper(titre, TITRE_MAX);
  if (!t || !lienValable(lien)) return null;
  return { titre: t, corps: couper(corps, CORPS_MAX), lien, tag: `${evenement}:${lien}`.slice(0, 200) };
}

/** Un abonnement du navigateur (PushSubscription), tel que le téléphone l'envoie. */
export function abonnementValable(a: { endpoint: string; p256dh: string; auth: string }): boolean {
  const cle = /^[A-Za-z0-9_-]+={0,2}$/;
  return (
    a.endpoint.length <= 2000 &&
    /^https:\/\/[^\s/]+\/\S*$/.test(a.endpoint) &&
    a.p256dh.length >= 40 &&
    a.p256dh.length <= 200 &&
    cle.test(a.p256dh) &&
    a.auth.length >= 8 &&
    a.auth.length <= 100 &&
    cle.test(a.auth)
  );
}

export interface ClesVapid {
  publique: string;
  privee: string;
  sujet: string;
}

/** Les clés VAPID de l'env Convex. Sans les deux clés ou sans sujet (`VAPID_SUJET`, sinon `KLYRA_APP_URL`) : null, rien ne part. */
export function clesVapid(env: {
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUJET?: string | undefined;
  KLYRA_APP_URL?: string | undefined;
}): ClesVapid | null {
  const publique = env.VAPID_PUBLIC_KEY?.trim();
  const privee = env.VAPID_PRIVATE_KEY?.trim();
  const sujet = (env.VAPID_SUJET ?? env.KLYRA_APP_URL)?.trim();
  if (!publique || !privee || !sujet || !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(sujet)) return null;
  return { publique, privee, sujet };
}

/** Un abonnement mort : le service de push répond 404 ou 410, il ne reviendra pas. */
export const abonnementMort = (statut: number | undefined) => statut === 404 || statut === 410;

/**
 * Envoie à chacun ; renvoie les ids des abonnements morts, à retirer. Une autre erreur (réseau,
 * service saturé) ne retire rien : le prochain envoi réessaie.
 */
export async function envoyerATous<Id>(
  abonnements: { _id: Id; endpoint: string; p256dh: string; auth: string }[],
  envoyer: (abonnement: { endpoint: string; keys: { p256dh: string; auth: string } }) => Promise<unknown>,
): Promise<Id[]> {
  const morts: Id[] = [];
  await Promise.all(
    abonnements.map(async (a) => {
      try {
        await envoyer({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } });
      } catch (e) {
        const statut = (e as { statusCode?: unknown })?.statusCode;
        if (abonnementMort(typeof statut === "number" ? statut : undefined)) morts.push(a._id);
        else console.warn(`Notification non envoyée (${typeof statut === "number" ? statut : "réseau"}).`);
      }
    }),
  );
  return morts;
}
