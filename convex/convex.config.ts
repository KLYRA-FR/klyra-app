import presence from "@convex-dev/presence/convex.config.js";
import postshiba from "@postshiba/convex/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  /* Posées avec `npx convex env set`, jamais écrites dans le dépôt. */
  env: {
    /** Clé Send only. Avec l'équipe et le cluster (page API keys de PostShiba), active l'envoi. */
    POSTSHIBA_API_KEY: v.optional(v.string()),
    POSTSHIBA_TEAM_ID: v.optional(v.string()),
    POSTSHIBA_CLUSTER_ID: v.optional(v.string()),
    /** "1" sur un déploiement de développement sans PostShiba : les e-mails vont dans `courrielsSimules`. */
    KLYRA_COURRIEL_SIMULE: v.optional(v.string()),
    /**
     * Adresse https de l'app web (téléphone). Sans elle, une demande venue du web
     * ne redirige pas : la page relais donne le lien https à coller. Jamais `klyra://` dans ce cas.
     */
    KLYRA_APP_URL: v.optional(v.string()),
    /**
     * Notifications du téléphone (web push) : `npx web-push generate-vapid-keys`. Sans les deux clés,
     * rien ne part et Réglages › Ce téléphone le dit. Le sujet (mailto: ou https:) : `KLYRA_APP_URL` à défaut.
     */
    VAPID_PUBLIC_KEY: v.optional(v.string()),
    VAPID_PRIVATE_KEY: v.optional(v.string()),
    VAPID_SUJET: v.optional(v.string()),
    /** Clés privées des deux GitHub Apps des agents (`jetonsDepotEnvoi.ts`). Sans elles, aucun jeton n'est émis. */
    GITHUB_APP_AGENTS_CLE: v.optional(v.string()),
    GITHUB_APP_REVIEWER_CLE: v.optional(v.string()),
  },
});
/* Les e-mails (liens de connexion, rappels) : file durable, nouvelles tentatives, limite horaire. */
app.use(postshiba);
/* L'app ouverte : un signal régulier. Sans signal, la personne est hors ligne (e-mail d'un rappel assigné). */
app.use(presence);

export default app;
