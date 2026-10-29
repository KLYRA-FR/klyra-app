/** Une erreur de la dictée que l'interface sait expliquer : clé, quota, réseau, service, Whisper. */
export class ErreurDictee extends Error {
  constructor(
    public code: "cle" | "quota" | "reseau" | "service" | "local",
    message: string,
  ) {
    super(message);
  }
}

/** Les mots du studio, pour que chaque moteur les écrive juste. */
export const TERMES = ["KLYRA", "localhost", "Next.js", "Figma", "Vercel", "Claude", "Pelin", "Corentin", "commit", "push"];
