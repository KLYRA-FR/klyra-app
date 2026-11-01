import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { auth } from "./auth";
import { pageConnexion } from "./model/contenus";

const http = httpRouter();

auth.addHttpRoutes(http);

/* Le lien reçu par e-mail arrive ici (SITE_URL). L'ordinateur ouvre `klyra://` ;
   une demande venue du web ouvre l'adresse https, ou le lien à coller. */
http.route({
  path: "/connexion",
  method: "GET",
  handler: httpAction(async (_ctx, requete) => {
    const url = new URL(requete.url);
    const web = url.searchParams.get("cible") === "web";
    return pageConnexion(url.searchParams.get("code"), {
      web,
      appUrl: env.KLYRA_APP_URL ?? null,
      lienCopie: web ? url.toString() : null,
    });
  }),
});

export default http;
