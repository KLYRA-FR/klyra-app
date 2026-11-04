/**
 * Le Coffre de KLYRA de bout en bout, dans Electron, sur un dossier d'app temporaire :
 *   pnpm build:electron && pnpm test:coffre      (Linux : xvfb-run -a … -- --no-sandbox)
 * - un secret est chiffré sur le disque, jamais rendu par la liste ni par un outil ;
 * - le serveur MCP de l'app donne les quatre outils ; lister, demander et ranger sans accord,
 *   écrire dans un fichier sur accord (accès « Projet ») ;
 * - un agent range un secret, n'en écrase jamais un ;
 * - écrire dans un fichier : refusé dans un fichier suivi par Git, hors du .gitignore, dans les
 *   données de l'app, par un lien, pour un secret non permis ; .env, modèle et brut, en 600 ;
 * - « Copier » met la valeur dans le presse-papiers depuis le main, puis le vide.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, clipboard, safeStorage } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-coffre-"));
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));
// Sous Linux sans trousseau : le chiffrement de base de Chromium (l'app installée garde celui du système).
if (process.platform === "linux") app.commandLine.appendSwitch("password-store", "basic");
fs.mkdirSync(app.getPath("userData"), { recursive: true });

const echecs = [];
const verifier = (ok, message, detail) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}${!ok && detail ? `\n       ${String(detail).slice(0, 600).replace(/\n/g, "\n       ")}` : ""}`);
  if (!ok) echecs.push(message);
};

const VALEUR = "sk_test_51KlyraTresSecret$42";
const VALEUR_AGENT = "ghp_AgentAObtenuCeJeton0099";

app.whenReady().then(async () => {
  const dist = path.join(__dirname, "..", "dist-electron");
  if (process.platform === "linux" && !safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption?.(true);
  const coffre = require(path.join(dist, "coffre.js"));
  const ia = require(path.join(dist, "ia.js"));
  const changements = [];
  coffre.surChangementCoffre(() => changements.push(Date.now()));

  try {
    /* La personne range une clé. */
    const s = await coffre.ajouterSecret({ variable: "stripe secret key", nom: "Clé Stripe", genre: "cle-api", service: "stripe.com", valeur: `  ${VALEUR}\n`, agents: true }, { par: "personne" });
    verifier(s.variable === "STRIPE_SECRET_KEY" && !("valeur" in s), "le secret est rangé sous son nom de variable, sans valeur dans la réponse", JSON.stringify(s));
    const disque = fs.readFileSync(path.join(app.getPath("userData"), "coffre.json"), "utf8");
    verifier(!disque.includes(VALEUR) && !disque.includes("sk_test"), "la valeur est chiffrée sur le disque");
    verifier((fs.statSync(path.join(app.getPath("userData"), "coffre.json")).mode & 0o777) === 0o600, "le fichier du coffre est en 600");
    verifier(changements.length >= 1, "l'écran est prévenu d'un changement");
    verifier(JSON.stringify(coffre.etatCoffre()).indexOf("sk_test") === -1, "l'état envoyé à l'écran ne contient aucune valeur");
    await coffre.ajouterSecret({ variable: "STRIPE_SECRET_KEY", valeur: "autre" }, { par: "personne" }).then(
      () => verifier(false, "un nom de variable pris est refusé sans « remplacer »"),
      () => verifier(true, "un nom de variable pris est refusé sans « remplacer »"),
    );

    /* Le serveur MCP de l'app. */
    await ia.demarrerServeurMcp();
    const config = JSON.parse(ia.configMcp({ chatId: "chat-a", roleId: "dev" })).mcpServers.klyra;
    const appel = async (method, params = {}) => {
      const rep = await fetch(config.url, { method: "POST", headers: { ...config.headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return (await rep.json()).result;
    };
    const outil = async (name, args) => {
      const r = await appel("tools/call", { name, arguments: args });
      return { texte: r.content.map((c) => c.text).join("\n"), erreur: !!r.isError };
    };
    const liste = await appel("tools/list");
    const noms = liste.tools.map((o) => o.name);
    verifier(["coffre_lister", "coffre_demander", "coffre_enregistrer", "coffre_ecrire_fichier"].every((n) => noms.includes(n)), "les agents ont les quatre outils du coffre", noms.join(", "));
    const libres = ia.OUTILS_APP();
    verifier(libres.includes("mcp__klyra__coffre_demander") && libres.includes("mcp__klyra__coffre_lister") && !libres.includes("mcp__klyra__coffre_ecrire_fichier"), "accès « Projet » : lister, demander, ranger sans accord ; écrire dans un fichier sur accord");

    let r = await outil("coffre_lister", {});
    verifier(/STRIPE_SECRET_KEY : Clé Stripe/.test(r.texte) && !r.texte.includes(VALEUR), "lister donne le nom, jamais la valeur", r.texte);

    r = await outil("coffre_demander", { variable: "OPENAI_API_KEY", nom: "Clé OpenAI", raison: "Pour générer les textes" });
    verifier(!r.erreur && /carte sécurisée/.test(r.texte) && /Termine ta réponse/.test(r.texte), "demander un secret absent : la carte s'affiche, l'agent termine sa réponse", r.texte);
    r = await outil("coffre_demander", { variable: "STRIPE_SECRET_KEY", nom: "Clé Stripe", raison: "Paiements" });
    verifier(/déjà dans le coffre/.test(r.texte), "demander un secret déjà permis : l'agent est renvoyé vers coffre_ecrire_fichier", r.texte);
    r = await outil("coffre_demander", { variable: "?", nom: "x", raison: "y" });
    verifier(r.erreur, "une demande sans nom de variable lisible est refusée", r.texte);

    /* Un agent range ce qu'il a obtenu, sans écraser. */
    r = await outil("coffre_enregistrer", { variable: "GITHUB_TOKEN", nom: "Jeton GitHub", genre: "jeton", valeur: VALEUR_AGENT });
    verifier(!r.erreur && !r.texte.includes(VALEUR_AGENT), "un agent range un jeton ; la réponse ne le répète pas", r.texte);
    const jeton = coffre.listerSecrets().find((x) => x.variable === "GITHUB_TOKEN");
    verifier(jeton && jeton.origine.par === "agent" && jeton.origine.roleId === "dev" && jeton.origine.chatId === "chat-a" && jeton.agents, "le coffre sait quel agent l'a rangé, dans quelle conversation", JSON.stringify(jeton));
    r = await outil("coffre_enregistrer", { variable: "STRIPE_SECRET_KEY", nom: "x", valeur: "pirate" });
    verifier(r.erreur && /déjà/.test(r.texte), "un agent n'écrase jamais un secret", r.texte);

    /* Écrire dans un fichier, hors de Git. */
    const depot = path.join(TMP, "projet");
    fs.mkdirSync(depot);
    execFileSync("git", ["init", "-q"], { cwd: depot });
    const env = path.join(depot, ".env.local");
    fs.writeFileSync(env, "AUTRE=1\n");
    r = await outil("coffre_ecrire_fichier", { variable: "STRIPE_SECRET_KEY", chemin: env, format: "env" });
    verifier(r.erreur && /suivi par Git/.test(r.texte) && fs.readFileSync(env, "utf8") === "AUTRE=1\n", "refusé dans un fichier que Git suivrait", r.texte);
    fs.writeFileSync(path.join(depot, ".gitignore"), ".env*.local\n");
    r = await outil("coffre_ecrire_fichier", { variable: "STRIPE_SECRET_KEY", chemin: env, format: "env" });
    const contenu = fs.readFileSync(env, "utf8");
    verifier(!r.erreur && contenu === `AUTRE=1\nSTRIPE_SECRET_KEY="${VALEUR.replace("$", "\\$")}"\n`, "écrit dans .env.local ignoré par Git (ligne ajoutée, valeur échappée)", `${r.texte}\n${contenu}`);
    verifier(!r.texte.includes(VALEUR), "la réponse à l'agent ne contient pas la valeur", r.texte);
    verifier((fs.statSync(env).mode & 0o777) === 0o600, "le fichier écrit est en 600");
    r = await outil("coffre_ecrire_fichier", { variable: "STRIPE_SECRET_KEY", chemin: env });
    verifier(!r.erreur && fs.readFileSync(env, "utf8").split("STRIPE_SECRET_KEY=").length === 2, "réécrire remplace la ligne, sans doublon", fs.readFileSync(env, "utf8"));

    // Déjà suivi par Git, même ignoré ensuite : refusé.
    const suivi = path.join(depot, "config.local");
    fs.writeFileSync(suivi, "cle={{coffre:GITHUB_TOKEN}}\n");
    execFileSync("git", ["add", "-f", "config.local"], { cwd: depot });
    fs.appendFileSync(path.join(depot, ".gitignore"), "config.local\n");
    r = await outil("coffre_ecrire_fichier", { variable: "GITHUB_TOKEN", chemin: suivi, format: "modele" });
    verifier(r.erreur && /suivi par Git/.test(r.texte), "refusé dans un fichier déjà suivi par Git, même ignoré ensuite", r.texte);

    // Hors d'un dépôt : modèle et brut.
    const libre = path.join(TMP, "hors-depot");
    fs.mkdirSync(libre);
    const modele = path.join(libre, "config.json");
    fs.writeFileSync(modele, '{"token":"{{coffre:GITHUB_TOKEN}}","autre":"{{coffre:AUTRE}}"}');
    r = await outil("coffre_ecrire_fichier", { variable: "GITHUB_TOKEN", chemin: modele, format: "modele" });
    verifier(!r.erreur && fs.readFileSync(modele, "utf8") === `{"token":"${VALEUR_AGENT}","autre":"{{coffre:AUTRE}}"}`, "format modèle : la marque est remplacée, les autres restent", r.texte);
    const brut = path.join(libre, "jeton.txt");
    r = await outil("coffre_ecrire_fichier", { variable: "GITHUB_TOKEN", chemin: brut, format: "brut" });
    verifier(!r.erreur && fs.readFileSync(brut, "utf8") === VALEUR_AGENT, "format brut : un fichier qui ne contient que la valeur", r.texte);
    r = await outil("coffre_ecrire_fichier", { variable: "GITHUB_TOKEN", chemin: brut, format: "brut" });
    verifier(r.erreur, "format brut : un fichier qui n'est pas vide n'est pas écrasé", r.texte);

    // Les gardes.
    r = await outil("coffre_ecrire_fichier", { variable: "GITHUB_TOKEN", chemin: "relatif/.env" });
    verifier(r.erreur && /chemin complet/.test(r.texte), "un chemin relatif est refusé", r.texte);
    r = await outil("coffre_ecrire_fichier", { variable: "GITHUB_TOKEN", chemin: path.join(app.getPath("userData"), "fuite.env") });
    verifier(r.erreur && /données de l’app/.test(r.texte), "les données de l'app sont refusées", r.texte);
    const lien = path.join(libre, "lien.env");
    fs.symlinkSync(path.join(libre, "cible.env"), lien);
    r = await outil("coffre_ecrire_fichier", { variable: "GITHUB_TOKEN", chemin: lien });
    verifier(r.erreur && /lien symbolique/.test(r.texte) && !fs.existsSync(path.join(libre, "cible.env")), "un lien symbolique est refusé", r.texte);
    r = await outil("coffre_ecrire_fichier", { variable: "INCONNU", chemin: path.join(libre, ".env") });
    verifier(r.erreur && /coffre_demander/.test(r.texte), "un secret absent : l'agent est invité à le demander", r.texte);

    // Retiré aux agents : plus listé, plus écrit.
    await coffre.modifierSecret(s.id, { agents: false });
    r = await outil("coffre_lister", {});
    verifier(!/STRIPE_SECRET_KEY/.test(r.texte), "un secret non permis n'est pas listé aux agents", r.texte);
    r = await outil("coffre_ecrire_fichier", { variable: "STRIPE_SECRET_KEY", chemin: path.join(libre, ".env") });
    verifier(r.erreur && /pas permis/.test(r.texte) && !fs.existsSync(path.join(libre, ".env")), "un secret non permis n'est pas écrit", r.texte);
    r = await outil("coffre_demander", { variable: "STRIPE_SECRET_KEY", nom: "Clé Stripe", raison: "Paiements" });
    verifier(!r.erreur && /carte sécurisée/.test(r.texte), "demander un secret non permis : la carte propose à la personne de le permettre", r.texte);

    /* Remplacer la valeur, copier, retirer. */
    await coffre.remplacerValeurSecret(s.id, "sk_nouvelle");
    verifier(!fs.readFileSync(path.join(app.getPath("userData"), "coffre.json"), "utf8").includes("sk_nouvelle"), "une nouvelle valeur est chiffrée aussi");
    try {
      const { delai } = coffre.copierSecret(s.id);
      const lu = await Promise.resolve(clipboard.readText());
      verifier(lu === "sk_nouvelle" && delai === 30_000, "« Copier » met la valeur dans le presse-papiers depuis le main", lu);
    } catch (e) {
      console.log(`       (presse-papiers non testé : ${e.message})`);
    }
    await coffre.retirerSecret(s.id);
    verifier(!coffre.listerSecrets().some((x) => x.id === s.id), "retirer efface le secret du coffre");
    const apres = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "coffre.json"), "utf8"));
    verifier(apres.length === 1 && apres[0].variable === "GITHUB_TOKEN", "le fichier ne garde que ce qui reste");
  } catch (e) {
    verifier(false, "le test s'est déroulé sans erreur", e.stack);
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT PASSE");
  app.exit(echecs.length ? 1 : 0);
});
