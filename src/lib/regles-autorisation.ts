/**
 * Les règles d'autorisation de Claude Code (« Bash(npm test:*) »), dites en mots pour l'écran : la carte
 * d'autorisation (« Toujours : les commandes npm test… ») et les autorisations retenues d'un projet.
 */

/**
 * Une règle en mots : « Bash(npm run test:*) » → « les commandes npm run test… », « Read(./src/**) » → « lire
 * ./src/** », « WebFetch(domain:example.com) » → « le site example.com ». Le reste tel quel.
 */
export function regleEnMots(regle: string): string {
  const m = /^([A-Za-z_][\w-]*)(?:\(([\s\S]*)\))?$/.exec(regle.trim());
  if (!m) return regle;
  const [, outil, contenu] = m;
  if (!contenu) {
    if (outil.startsWith("mcp__")) return `l’outil ${outil.split("__").slice(1).join(" · ")}`;
    return outil === "Bash" ? "toutes les commandes" : `l’outil ${outil}`;
  }
  if (outil === "Bash") return contenu.endsWith(":*") ? `les commandes « ${contenu.slice(0, -2)}… »` : contenu.endsWith(" *") ? `les commandes « ${contenu.slice(0, -2)}… »` : `la commande « ${contenu} »`;
  if (outil === "WebFetch" && contenu.startsWith("domain:")) return `le site ${contenu.slice(7)}`;
  if (outil === "Read") return `lire ${contenu}`;
  if (outil === "Edit" || outil === "Write" || outil === "MultiEdit") return `modifier ${contenu}`;
  return `${outil} : ${contenu}`;
}
