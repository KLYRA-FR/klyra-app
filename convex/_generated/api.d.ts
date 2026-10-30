/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as connexion from "../connexion.js";
import type * as courriels from "../courriels.js";
import type * as equipe from "../equipe.js";
import type * as http from "../http.js";
import type * as model_acces from "../model/acces.js";
import type * as model_connexion from "../model/connexion.js";
import type * as model_contenus from "../model/contenus.js";
import type * as model_limites from "../model/limites.js";
import type * as model_valeurs from "../model/valeurs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  connexion: typeof connexion;
  courriels: typeof courriels;
  equipe: typeof equipe;
  http: typeof http;
  "model/acces": typeof model_acces;
  "model/connexion": typeof model_connexion;
  "model/contenus": typeof model_contenus;
  "model/limites": typeof model_limites;
  "model/valeurs": typeof model_valeurs;
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
};
