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
  },
});
/* Les e-mails (liens de connexion, rappels) : file durable, nouvelles tentatives, limite horaire. */
app.use(postshiba);
/* L'app ouverte : un signal régulier. Sans signal, la personne est hors ligne (e-mail d'un rappel assigné). */
app.use(presence);

export default app;
