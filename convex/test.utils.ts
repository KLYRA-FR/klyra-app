/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

/** Tests seulement (deux points dans le nom : Convex ne déploie pas ce fichier). */

const modules = import.meta.glob("./**/*.ts");

export type Essai = TestConvex<typeof schema>;

export function nouvelEssai(): Essai {
  return convexTest(schema, modules);
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

export async function demanderLien(t: Essai, email: string) {
  return await t.action(api.auth.signIn, { provider: "postshiba", params: { email } });
}

export async function ouvrirLien(t: Essai, email: string, code: string) {
  return await t.action(api.auth.signIn, { provider: "postshiba", params: { email, code } });
}

/** Le parcours complet du lien magique. Renvoie un client avec la session obtenue. */
export async function connecter(t: Essai, email: string) {
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
