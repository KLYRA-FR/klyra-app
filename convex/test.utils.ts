/// <reference types="vite/client" />
import presence from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { vi } from "vitest";
import { api, internal } from "./_generated/api";
import { DELAI_ENTRE_LIENS_MS } from "./model/limites";
import schema from "./schema";

/** Tests seulement (deux points dans le nom : Convex ne déploie pas ce fichier). */

const modules = import.meta.glob("./**/*.ts");

export type Essai = TestConvex<typeof schema>;

/** Horloge simulée : les délais se testent en l'avançant (`patienter`), jamais en attendant. */
export function nouvelEssai(): Essai {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  presence.register(t);
  return t;
}

/** Avance l'horloge, puis laisse finir ce qui devait partir entre-temps (envoi du lien, nettoyages). */
export async function patienter(t: Essai, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

/** Les e-mails simulés reçus par une adresse. */
export async function courrielsRecus(t: Essai, email: string): Promise<number> {
  const liste = await t.run((ctx) =>
    ctx.db
      .query("courrielsSimules")
      .withIndex("by_a", (q) => q.eq("a", email))
      .take(100),
  );
  return liste.length;
}

export const EQUIPE_DE_DEPART = [
  { email: "corentin@klyra.design", nom: "Corentin" },
  { email: "pelin@klyra.design", nom: "Pelin" },
];

/** Le lien du dernier e-mail simulé pour une adresse, et son code. */
export async function dernierLien(t: Essai, email: string): Promise<{ lien: string; code: string } | null> {
  const courriel = await t.query(internal.courriels.dernierCourrielSimule, { a: email });
  const lien = courriel?.texte.match(/https:\/\/\S+\?code=([A-Za-z0-9]+)/);
  return lien ? { lien: lien[0], code: lien[1] } : null;
}

/**
 * Comme l'app : `connexion:demanderLien`, puis l'envoi en arrière-plan. convex-test date chaque
 * transaction une à quelques millisecondes après la précédente : on avance de 50 ms pour que l'envoi parte.
 */
export async function demanderLien(t: Essai, email: string) {
  const reponse = await t.mutation(api.connexion.demanderLien, { email });
  await patienter(t, 50);
  return reponse;
}

/** Une réponse telle que l'écran la montre : acceptée ou non, et l'attente en secondes. */
export const enSecondes = (r: { acceptee: boolean; attenteMs: number }) => ({ acceptee: r.acceptee, secondes: Math.ceil(r.attenteMs / 1000) });

/** Comme une version de l'app d'avant le délai, ou un appel à la main : `auth:signIn` directement. */
export async function demanderLienDirect(t: Essai, email: string) {
  return await t.action(api.auth.signIn, { provider: "postshiba", params: { email } });
}

export async function ouvrirLien(t: Essai, email: string, code: string) {
  return await t.action(api.auth.signIn, { provider: "postshiba", params: { email, code } });
}

/** Le parcours complet du lien magique (après le délai d'une éventuelle demande précédente). Renvoie un client avec la session obtenue. */
export async function connecter(t: Essai, email: string) {
  await patienter(t, DELAI_ENTRE_LIENS_MS);
  await demanderLien(t, email);
  const lien = await dernierLien(t, email);
  if (lien === null) throw new Error(`Aucun lien envoyé à ${email}`);
  const { tokens } = await ouvrirLien(t, email, lien.code);
  if (!tokens) throw new Error(`Le lien n’a pas ouvert de session pour ${email}`);
  const charge = JSON.parse(atob(tokens.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string };
  return t.withIdentity({ subject: charge.sub, issuer: "https://essai.convex.site" });
}

export async function initialiser(t: Essai, admins = EQUIPE_DE_DEPART) {
  return await t.mutation(internal.equipe.initialiser, { admins });
}
