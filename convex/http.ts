import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { pageConnexion } from "./model/contenus";

const http = httpRouter();

auth.addHttpRoutes(http);

/* Le lien reçu par e-mail arrive ici (SITE_URL), puis ouvre l'app par `klyra://`. */
http.route({
  path: "/connexion",
  method: "GET",
  handler: httpAction(async (_ctx, requete) => pageConnexion(new URL(requete.url).searchParams.get("code"))),
});

export default http;
