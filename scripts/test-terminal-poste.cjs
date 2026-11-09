/**
 * Le terminal interactif d'un agent de ce PC, dans Electron, sur un dossier d'app temporaire :
 *   pnpm build:electron && pnpm test:terminal-poste      (Linux : xvfb-run -a … -- --no-sandbox)
 * - le serveur MCP de l'app sert les quatre outils, libres en accès « Projet » ;
 * - un agent ouvre un terminal qui attend une saisie, l'écran (même module que l'IPC) le voit et y tape,
 *   l'agent lit la suite, puis tape un secret du Coffre de ce PC, masqué ;
 * - un autre agent d'une autre conversation n'y touche pas.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-terminal-poste-"));
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));
if (process.platform === "linux") app.commandLine.appendSwitch("password-store", "basic");
fs.mkdirSync(app.getPath("userData"), { recursive: true });

const echecs = [];
const verifier = (ok, message, detail) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}${!ok && detail ? `\n       ${String(detail).slice(0, 600).replace(/\n/g, "\n       ")}` : ""}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const dist = path.join(__dirname, "..", "dist-electron");
  if (process.platform === "linux" && !safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption?.(true);
  const coffre = require(path.join(dist, "coffre.js"));
  const ia = require(path.join(dist, "ia.js"));
  try {
    await coffre.ajouterSecret({ variable: "JETON_TEST", nom: "Jeton de test", genre: "jeton", valeur: "valeur-du-poste-777", agents: true }, { par: "personne" });
    await ia.demarrerServeurMcp();
    const configDe = (chatId, roleId) => JSON.parse(ia.configMcp({ chatId, roleId })).mcpServers.klyra;
    const outil = async (config, name, args) => {
      const rep = await fetch(config.url, { method: "POST", headers: { ...config.headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
      const r = (await rep.json()).result;
      return { texte: r.content.map((c) => c.text).join("\n"), erreur: !!r.isError };
    };
    const config = configDe("chat-a", "dev");
    const rep = await fetch(config.url, { method: "POST", headers: { ...config.headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
    const noms = (await rep.json()).result.tools.map((o) => o.name);
    verifier(["terminal_ouvrir", "terminal_envoyer", "terminal_lire", "terminal_fermer"].every((n) => noms.includes(n)), "les agents ont les quatre outils du terminal", noms.join(", "));
    verifier(["terminal_ouvrir", "terminal_envoyer", "terminal_lire", "terminal_fermer"].every((n) => ia.OUTILS_APP().includes(`mcp__klyra__${n}`)), "sans demander d'accord");

    if (process.platform === "win32") {
      const r = await outil(config, "terminal_ouvrir", { commande: "echo" });
      verifier(r.erreur && /Windows/.test(r.texte), "sous Windows, l'outil dit que le terminal n'existe pas encore", r.texte);
    } else {
      const ouvert = await outil(config, "terminal_ouvrir", { commande: "read -p 'Code : ' c; echo \"code=$c\"; read -s -p 'Jeton : ' j; echo; echo \"jeton=$j\"" });
      verifier(!ouvert.erreur && /Code :/.test(ouvert.texte), "l'agent ouvre un terminal qui attend une saisie", ouvert.texte);
      const id = /term-[0-9a-f]{12}/.exec(ouvert.texte)?.[0];
      const liste = ia.terminaux.lister("chat-a");
      verifier(liste.length === 1 && liste[0].id === id && liste[0].agent === "dev" && ia.terminaux.lister("chat-b").length === 0, "l'écran le voit dans cette conversation, pas dans une autre", JSON.stringify(liste));
      verifier(ia.terminaux.saisir(id, "1234\r"), "la personne tape dans le terminal");
      await attendre(500);
      const lu = await outil(config, "terminal_lire", { id, attendre: 2 });
      verifier(/code=1234/.test(lu.texte) && /Jeton :/.test(lu.texte), "l'agent lit ce qu'elle a tapé", lu.texte);
      const autre = await outil(configDe("chat-b", "iris"), "terminal_lire", { id });
      verifier(autre.erreur, "un agent d'une autre conversation n'y touche pas");
      const envoi = await outil(config, "terminal_envoyer", { id, secret: "JETON_TEST", entree: true });
      const fin = await outil(config, "terminal_lire", { id, attendre: 2 });
      verifier(!envoi.erreur && /jeton=•{19}/.test(fin.texte) && !/valeur-du-poste/.test(envoi.texte + fin.texte + ia.terminaux.flux(id, 0).donnees), "le secret du Coffre est tapé, jamais montré", fin.texte);
      ia.terminaux.fermerTout();
    }
  } catch (e) {
    verifier(false, `le test s'est déroulé sans exception : ${e instanceof Error ? e.stack : e}`);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTERMINAL (POSTE) : TOUT PASSE");
  app.exit(echecs.length ? 1 : 0);
});
