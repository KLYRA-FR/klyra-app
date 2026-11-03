// Généré par scripts/serveur-genere.mjs depuis electron/ia-catalogue.ts : ne pas modifier à la main.
/**
 * Les IA à consulter que l'app propose, avec leur adresse « chat completions » et un modèle par défaut.
 * Le même catalogue sert sur le VPS : `serveur/ia-catalogue.mjs` en est généré (scripts/serveur-genere.mjs).
 */
export const FOURNISSEURS = {
    openai: { nom: "ChatGPT", url: "https://api.openai.com/v1", modele: "gpt-5" },
    gemini: { nom: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", modele: "gemini-2.5-pro" },
    mistral: { nom: "Mistral", url: "https://api.mistral.ai/v1", modele: "mistral-large-latest" },
    deepseek: { nom: "DeepSeek", url: "https://api.deepseek.com/v1", modele: "deepseek-chat" },
    xai: { nom: "Grok", url: "https://api.x.ai/v1", modele: "grok-4" },
    openrouter: { nom: "OpenRouter", url: "https://openrouter.ai/api/v1", modele: "openai/gpt-5" },
    autre: { nom: "Autre", url: "", modele: "" },
};
