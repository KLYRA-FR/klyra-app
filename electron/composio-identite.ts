import { net } from "electron";
import { createHash } from "node:crypto";
import { adresseConvex, lireJeton, revisionCompte } from "./compte";

export interface IdentiteComposio {
  scope: string;
  nom: string;
  type: "local" | "equipe";
  revision: string;
}

const empreinte = (texte: string) => createHash("sha256").update(texte).digest("hex");
const cleSession = () => `__convexAuthJWT_${adresseConvex().replace(/[^a-zA-Z0-9]/g, "")}`;

/** Le jeton reste dans main. Même un rafraîchissement invalide les capacités déjà émises. */
export function revisionIdentiteComposio(): string {
  return `${revisionCompte()}:${empreinte(lireJeton(cleSession()) ?? "profil-local")}`;
}

/**
 * Contrat Convex déjà employé par son client HTTP installé : /api/query, Bearer,
 * {path, format, args}. Aucun identifiant de membre n'est accepté du renderer.
 * Avec une session présente mais non vérifiable, on ne revient jamais au profil local.
 */
export async function identiteComposio(): Promise<IdentiteComposio> {
  const jeton = lireJeton(cleSession());
  const revision = revisionIdentiteComposio();
  if (!jeton) return { scope: "local", nom: "Profil de cet ordinateur", type: "local", revision };
  let valeur: unknown;
  try {
    const r = await net.fetch(`${adresseConvex()}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ path: "equipe:moi", format: "convex_encoded_json", args: [{}] }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!r.ok) throw new Error();
    const corps = await r.json() as { status?: unknown; value?: unknown };
    if (corps.status !== "success") throw new Error();
    valeur = corps.value;
  } catch {
    throw new Error("Le compte d’équipe ne peut pas être vérifié. Rétablis la connexion ou reconnecte ton compte KLYRA.");
  }
  if (revisionIdentiteComposio() !== revision) throw new Error("Le compte KLYRA a changé. Actualise l’espace Composio.");
  if (!valeur || typeof valeur !== "object" || !("_id" in valeur) || typeof valeur._id !== "string") {
    throw new Error("Ce compte n’est plus membre de l’équipe. Aucun accès Composio n’est disponible.");
  }
  return {
    scope: empreinte(`${adresseConvex()}\0${valeur._id}`),
    nom: "nom" in valeur && typeof valeur.nom === "string" ? valeur.nom.slice(0, 80) : "Compte d’équipe",
    type: "equipe",
    revision,
  };
}
