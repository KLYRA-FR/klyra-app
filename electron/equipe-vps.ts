import { net } from "electron";
import { AgentError } from "./agents";

/**
 * L'équipe d'un VPS relié (serveur/equipe.mjs) : l'écran Agents la lit et la modifie comme celle de ce PC.
 * Un ancien serveur ne la connaît pas : `serveur-ancien`, et l'écran le dit.
 */

const ATTENTE_MS = 20_000;
const SERVEUR_ANCIEN = "serveur-ancien";

export async function appelEquipeVps(origine: string, jeton: string | null, methode: string, corps: unknown = {}): Promise<unknown> {
  if (!jeton) throw new AgentError("introuvable", "Ce PC n’est plus relié à ce VPS.");
  if (!/^[a-z-]{1,32}$/.test(methode)) throw new AgentError("introuvable", "Demande inconnue.");
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const reponse = await net.fetch(`${origine}/klyra/v1/equipe/${methode}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
      body: JSON.stringify(corps ?? {}),
      signal: controle.signal,
    });
    const json = (await reponse.json().catch(() => null)) as { resultat?: unknown; erreur?: string; message?: string } | null;
    if (reponse.status === 404) throw new AgentError(SERVEUR_ANCIEN, "Ce serveur n’a pas encore sa propre équipe : mets-le à jour.");
    if (reponse.status === 401) throw new AgentError("introuvable", "Ce PC n’est plus relié à ce VPS.");
    if (!reponse.ok || !json) throw new AgentError((json?.erreur ?? "serveur") as AgentError["code"], json?.message ?? "Le VPS n’a pas répondu.");
    return json.resultat ?? null;
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError("serveur", "Le VPS ne répond pas.");
  } finally {
    clearTimeout(delai);
  }
}
