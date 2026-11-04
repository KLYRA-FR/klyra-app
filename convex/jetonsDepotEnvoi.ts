"use node";

import { createPrivateKey, createSign } from "node:crypto";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, env } from "./_generated/server";
import { APPS_DEPOT, normaliserCle, vRoleDepot } from "./model/depots";
import type { CodeErreur } from "./model/valeurs";

const API = "https://api.github.com";

const base64url = (texte: string) => Buffer.from(texte).toString("base64url");

/** Le JWT d'une App, valable neuf minutes (GitHub en accepte dix), avec une marge sur son horloge. */
function signerJwt(appId: string, cle: string): string {
  const maintenant = Math.floor(Date.now() / 1000);
  const entete = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const charge = base64url(JSON.stringify({ iat: maintenant - 60, exp: maintenant + 540, iss: appId }));
  const signature = createSign("RSA-SHA256").update(`${entete}.${charge}`).sign(createPrivateKey(cle)).toString("base64url");
  return `${entete}.${charge}.${signature}`;
}

function refus(code: CodeErreur): ConvexError<CodeErreur> {
  return new ConvexError(code);
}

async function appeler(chemin: string, jwt: string, corps?: unknown): Promise<Response> {
  try {
    return await fetch(`${API}${chemin}`, {
      method: corps === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "klyra-app",
        ...(corps === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw refus("github_indisponible");
  }
}

/** Ce qu'une réponse de GitHub veut dire. Le corps n'est jamais recopié dans l'erreur. */
function refusDe(statut: number): ConvexError<CodeErreur> {
  if (statut === 401 || statut === 403) return refus("jetons_non_configures");
  if (statut === 404 || statut === 422) return refus("app_non_installee");
  return refus("github_indisponible");
}

/**
 * Un jeton d'une heure, limité à ce dépôt et aux droits de ce rôle. Le membre et son accès sont
 * vérifiés avant tout, par sa session. Le jeton n'est gardé nulle part : seul l'appelant le reçoit.
 */
export const demander = action({
  args: { depot: v.string(), role: vRoleDepot },
  returns: v.object({ jeton: v.string(), expire: v.string() }),
  handler: async (ctx, args): Promise<{ jeton: string; expire: string }> => {
    const { proprietaire, nom } = await ctx.runMutation(internal.jetonsDepot.reserver, args);
    const app = APPS_DEPOT[args.role];
    const cle = normaliserCle(env[app.variable] ?? "");
    if (cle === null) throw refus("jetons_non_configures");
    let jwt: string;
    try {
      jwt = signerJwt(app.appId, cle);
    } catch {
      throw refus("jetons_non_configures");
    }

    const installation = await appeler(`/repos/${proprietaire}/${nom}/installation`, jwt);
    if (!installation.ok) throw refusDe(installation.status);
    const { id } = (await installation.json()) as { id: number };

    const reponse = await appeler(`/app/installations/${id}/access_tokens`, jwt, {
      repositories: [nom],
      permissions: app.permissions,
    });
    if (!reponse.ok) throw refusDe(reponse.status);
    const { token, expires_at: expire } = (await reponse.json()) as { token: string; expires_at: string };
    return { jeton: token, expire };
  },
});
