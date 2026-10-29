import { Email } from "@convex-dev/auth/providers/Email";
import { convexAuth } from "@convex-dev/auth/server";
import { makeFunctionReference, type GenericActionCtx, type GenericDataModel } from "convex/server";
import type { MutationCtx } from "./_generated/server";
import { accepterConnexion } from "./model/connexion";
import { DUREE_LIEN_MINUTES } from "./model/contenus";

/* Référence par nom : importer `internal` ici créerait une boucle de types avec `_generated/api`. */
const envoyerLienConnexion = makeFunctionReference<"mutation", { a: string; lien: string }, null>(
  "courriels:envoyerLienConnexion",
);

/**
 * Lien magique : le lien vaut SITE_URL (la page `/connexion` de `convex/http.ts`) suivi de
 * `?code=…`. Le fournisseur vérifie aussi, à l'ouverture, que l'adresse donnée par l'app
 * est celle à qui le lien a été envoyé.
 */
const LienMagique = Email({
  id: "postshiba",
  maxAge: DUREE_LIEN_MINUTES * 60,
  async sendVerificationRequest({ identifier, url }, ctx?: GenericActionCtx<GenericDataModel>) {
    if (!ctx) throw new Error("Convex Auth n’a pas transmis son contexte.");
    await ctx.runMutation(envoyerLienConnexion, { a: identifier, lien: url });
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [LienMagique],
  callbacks: {
    createOrUpdateUser: (ctx, args) => accepterConnexion(ctx as unknown as MutationCtx, args),
  },
});
