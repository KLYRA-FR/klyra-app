/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artefactsEquipe from "../artefactsEquipe.js";
import type * as auth from "../auth.js";
import type * as bibliotheque from "../bibliotheque.js";
import type * as connexion from "../connexion.js";
import type * as conversationsCompte from "../conversationsCompte.js";
import type * as courriels from "../courriels.js";
import type * as demandesPoste from "../demandesPoste.js";
import type * as documentsKlyra from "../documentsKlyra.js";
import type * as equipe from "../equipe.js";
import type * as evenements from "../evenements.js";
import type * as http from "../http.js";
import type * as jetonsDepot from "../jetonsDepot.js";
import type * as jetonsDepotEnvoi from "../jetonsDepotEnvoi.js";
import type * as model_acces from "../model/acces.js";
import type * as model_connexion from "../model/connexion.js";
import type * as model_contenus from "../model/contenus.js";
import type * as model_definitions from "../model/definitions.js";
import type * as model_depots from "../model/depots.js";
import type * as model_evenements from "../model/evenements.js";
import type * as model_limites from "../model/limites.js";
import type * as model_push from "../model/push.js";
import type * as model_rappels from "../model/rappels.js";
import type * as model_valeurs from "../model/valeurs.js";
import type * as notificationsPush from "../notificationsPush.js";
import type * as notificationsPushEnvoi from "../notificationsPushEnvoi.js";
import type * as operationsFile from "../operationsFile.js";
import type * as postes from "../postes.js";
import type * as presence from "../presence.js";
import type * as rappels from "../rappels.js";
import type * as telephones from "../telephones.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  artefactsEquipe: typeof artefactsEquipe;
  auth: typeof auth;
  bibliotheque: typeof bibliotheque;
  connexion: typeof connexion;
  conversationsCompte: typeof conversationsCompte;
  courriels: typeof courriels;
  demandesPoste: typeof demandesPoste;
  documentsKlyra: typeof documentsKlyra;
  equipe: typeof equipe;
  evenements: typeof evenements;
  http: typeof http;
  jetonsDepot: typeof jetonsDepot;
  jetonsDepotEnvoi: typeof jetonsDepotEnvoi;
  "model/acces": typeof model_acces;
  "model/connexion": typeof model_connexion;
  "model/contenus": typeof model_contenus;
  "model/definitions": typeof model_definitions;
  "model/depots": typeof model_depots;
  "model/evenements": typeof model_evenements;
  "model/limites": typeof model_limites;
  "model/push": typeof model_push;
  "model/rappels": typeof model_rappels;
  "model/valeurs": typeof model_valeurs;
  notificationsPush: typeof notificationsPush;
  notificationsPushEnvoi: typeof notificationsPushEnvoi;
  operationsFile: typeof operationsFile;
  postes: typeof postes;
  presence: typeof presence;
  rappels: typeof rappels;
  telephones: typeof telephones;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  postshiba: import("@postshiba/convex/_generated/component.js").ComponentApi<"postshiba">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
