import type {} from "./bridge";

/** Point d'entrée du stockage du lieu choisi ; aucune donnée ne passe par un modèle. */
export async function appelerCerveau<T>(lieu: string | null, action: string, args: Record<string, unknown> = {}): Promise<T> {
  const fn = window.klyra?.agents.cerveau;
  if (!fn) throw new Error("Cette version de l’app ne dispose pas encore du stockage du second cerveau. Relancez la version construite depuis cette branche.");
  const reponse = await fn(lieu, action, args);
  if (!reponse.ok) throw new Error(reponse.message);
  return reponse.data as T;
}
