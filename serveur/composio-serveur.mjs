/**
 * La connexion Composio d'un serveur : son compte, à lui seul, gardé chiffré comme son Coffre. Un VPS n'a pas de
 * navigateur : l'app de la personne fait la connexion chez elle puis lui donne les jetons, qu'il renouvelle
 * lui-même. Ses agents joignent ensuite le serveur MCP de Composio sans le PC.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ComposioConnect } from "./composio-connect.mjs";

const jetonsValides = (j) =>
  !!j && typeof j.clientId === "string" && typeof j.acces === "string" && (j.renouvellement === null || typeof j.renouvellement === "string") && typeof j.expireLe === "number" && (j.compte === null || typeof j.compte === "string");

/** @param {{ donnees: string, coffre: { chiffrerTexte: (t: string) => string, dechiffrerTexte: (t: string) => string }, fetch?: typeof fetch }} options */
export function creerComposioServeur({ donnees, coffre, fetch: appelReseau = globalThis.fetch }) {
  const fichier = path.join(donnees, "composio-connect.json");
  const connect = new ComposioConnect({
    fetch: appelReseau,
    ouvrir: () => {},
    lire: async () => {
      if (!existsSync(fichier)) return null;
      try {
        return JSON.parse(coffre.dechiffrerTexte(JSON.parse(readFileSync(fichier, "utf8")).contenu));
      } catch {
        return null;
      }
    },
    ecrire: async (jetons) => {
      if (!jetons) return rmSync(fichier, { force: true });
      const tmp = `${fichier}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, contenu: coffre.chiffrerTexte(JSON.stringify(jetons)) }), { mode: 0o600 });
      renameSync(tmp, fichier);
    },
  });
  const pret = connect.charger().catch(() => {});

  /** Une demande de l'app (route `/klyra/v1/composio/<méthode>`). */
  async function appeler(methode, corps = {}) {
    await pret;
    switch (methode) {
      case "etat":
        return connect.etat();
      case "adopter":
        if (!jetonsValides(corps.jetons)) throw new Error("Jetons Composio illisibles.");
        await connect.adopter(corps.jetons);
        return connect.etat();
      case "deconnecter":
        await connect.deconnecter();
        return connect.etat();
      default:
        throw new Error("Ce serveur ne connaît pas cette demande.");
    }
  }

  /** Le serveur MCP à ajouter à une session d'agent, si ce serveur est connecté. */
  const mcp = () => connect.serveur();
  return { appeler, mcp };
}
