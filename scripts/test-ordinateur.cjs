/**
 * Computer Use de bout en bout, avec le vrai pilote (cua-driver), dans
 * Electron, sur un dossier d'app temporaire :
 *   pnpm build:electron && pnpm cua-driver && pnpm test:ordinateur
 * 1. Interrupteur coupé : pas de pilote, pas d'outils pour les agents.
 * 2. Allumé : le démon démarre ; sur Mac sans autorisations, l'état le dit et
 *    les agents n'ont toujours rien (fin du test là).
 * 3. Prêt : l'entrée MCP « ordinateur » existe ; on parle MCP au relais comme
 *    un agent : liste des outils, la fenêtre de test trouvée, son état (image +
 *    copie JSON ajoutée par le relais), un clic et une frappe reçus par la page.
 * 4. Coupé de nouveau : démon arrêté, entrée retirée, l'intermédiaire échoue.
 * Sous Linux (pas une cible de l'app), lancer sous xvfb-run.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-ordinateur-"));
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));
fs.mkdirSync(app.getPath("userData"), { recursive: true });
const EXE = process.platform === "win32" ? "cua-driver.exe" : "cua-driver";
process.env.KLYRA_CUA_DRIVER ??= path.join(__dirname, "..", "vendor", "cua-driver", process.platform, EXE);

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><title>Cible KLYRA</title><body style="margin:0;font:20px sans-serif;background:#fff">
<button id="b" style="position:absolute;left:40px;top:40px;width:200px;height:70px" onclick="window.clics=(window.clics||0)+1">Cible</button>
<input id="t" style="position:absolute;left:40px;top:150px;width:320px;height:36px">
</body>`;

/** Un client MCP minimal sur l'entrée « ordinateur », comme Claude Code ou Codex la lancent. */
function clientMcp(serveur) {
  const p = spawn(serveur.command, serveur.args, { env: { ...process.env, ...serveur.env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const attentes = new Map();
  let suivant = 1;
  let stderr = "";
  p.stderr.on("data", (d) => (stderr += d));
  createInterface({ input: p.stdout }).on("line", (ligne) => {
    let m;
    try {
      m = JSON.parse(ligne);
    } catch {
      return;
    }
    const a = attentes.get(m.id);
    if (!a) return;
    attentes.delete(m.id);
    if (m.error) a.rejeter(new Error(m.error.message));
    else a.resoudre(m.result);
  });
  p.on("exit", () => {
    for (const a of attentes.values()) a.rejeter(new Error(`l'intermédiaire s'est arrêté : ${stderr.trim().slice(0, 300)}`));
    attentes.clear();
  });
  const demander = (method, params, delai = 30_000) =>
    new Promise((resoudre, rejeter) => {
      const id = suivant++;
      const minuteur = setTimeout(() => {
        attentes.delete(id);
        rejeter(new Error(`${method} : pas de réponse`));
      }, delai);
      attentes.set(id, {
        resoudre: (r) => (clearTimeout(minuteur), resoudre(r)),
        rejeter: (e) => (clearTimeout(minuteur), rejeter(e)),
      });
      p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return {
    async ouvrir() {
      await demander("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-klyra", version: "1" } });
      p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    },
    demander,
    appeler: (name, args) => demander("tools/call", { name, arguments: args }),
    fermer: () => p.kill(),
  };
}

const texteDe = (r) => (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

app.whenReady().then(async () => {
  let fenetre = null;
  let client = null;
  try {
    const reglages = require("../dist-electron/reglages.js");
    const pilote = require("../dist-electron/ordinateur/pilote.js");
    const allumer = (actif) => reglages.ecrireReglages({ ...reglages.lireReglages(), computerUse: { actif } });

    // 1. Coupé.
    await allumer(false);
    let e = await pilote.etatPilote();
    verifier(e.statut === "coupe" && pilote.serveurOrdinateur() === null, "interrupteur coupé : pilote arrêté, aucun outil pour les agents");
    verifier(/coupé/.test(pilote.consigneOrdinateur()), "la consigne dit aux agents que Computer Use est coupé");

    // 2. Allumé.
    await allumer(true);
    e = await pilote.etatPilote();
    console.log(`       état : ${JSON.stringify(e)}`);
    if (process.platform === "darwin" && e.statut === "autorisations") {
      verifier(e.autorisations !== null && pilote.serveurOrdinateur() === null, "Mac sans autorisations : l'état le dit, les agents n'ont pas les outils");
      verifier(/autorisations/.test(pilote.consigneOrdinateur()), "la consigne renvoie aux Réglages");
      throw "fin";
    }
    verifier(e.statut === "pret", `pilote prêt (cua-driver ${e.version})`);
    const serveur = pilote.serveurOrdinateur();
    verifier(serveur?.type === "stdio" && serveur.args[0] === "mcp" && /relais/.test(serveur.args[2]), "entrée MCP « ordinateur » par le relais");
    verifier(/serveur MCP « ordinateur »/.test(pilote.consigneOrdinateur()), "la consigne explique les outils aux agents");
    verifier(pilote.signatureOrdinateur() !== "", "la signature des conversations change avec le pilote");

    // 3. Comme un agent.
    fenetre = new BrowserWindow({ x: 120, y: 120, width: 460, height: 260, show: true, frame: false, webPreferences: { sandbox: true } });
    await fenetre.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
    fenetre.focus();
    await pause(1000);

    client = clientMcp(serveur);
    await client.ouvrir();
    const { tools } = await client.demander("tools/list", {});
    const noms = new Set(tools.map((t) => t.name));
    verifier(tools.length >= 50 && ["click", "type_text", "get_window_state", "list_windows"].every((n) => noms.has(n)), `${tools.length} outils, dont click, type_text, get_window_state`);
    const skill = await client.demander("resources/read", { uri: "skill://cua-driver/SKILL.md" });
    verifier(/cua-driver/.test(skill?.contents?.[0]?.text ?? ""), "la ressource skill://cua-driver/SKILL.md se lit");

    const liste = await client.appeler("list_windows", { pid: process.pid });
    const fenetres = liste.structuredContent?.windows ?? [];
    const cible = fenetres.find((w) => /Cible KLYRA/.test(w.title ?? "")) ?? fenetres.find((w) => (w.bounds?.width ?? 0) >= 400);
    verifier(!!cible, `la fenêtre de test est trouvée (${fenetres.length} fenêtre(s) du process)`);
    if (!cible) throw new Error(texteDe(liste));
    const id = { pid: cible.pid ?? process.pid, window_id: cible.window_id };

    const vue = await client.appeler("get_window_state", { ...id, include_accessibility_tree: false });
    const image = (vue.content ?? []).find((c) => c.type === "image");
    verifier(!!image && image.data.length > 1000, `get_window_state rend une capture (${image?.mimeType ?? "aucune"})`);
    verifier(/structuredContent en JSON, copié par KLYRA/.test(texteDe(vue)) && texteDe(vue).includes(String(cible.window_id)), "le relais ajoute la copie JSON (window_id lisible en texte)");

    const page = (js) => fenetre.webContents.executeJavaScript(js);
    const centre = (sel) => page(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    // Les coordonnées « window » sont en pixels de la capture de la fenêtre : on les remet à l'échelle.
    const echelle = (vue.structuredContent?.screenshot_width ?? 460) / 460;
    const b = await centre("#b");
    // Electron sous X11 refuse les clics en arrière-plan : le pilote le dit, et l'agent recommence au premier plan.
    const devant = process.platform === "linux" ? { delivery_mode: "foreground" } : {};
    const clic = await client.appeler("click", { ...id, ...devant, x: Math.round(b.x * echelle), y: Math.round(b.y * echelle) });
    await pause(500);
    verifier((await page("window.clics || 0")) === 1, `clic reçu par le bouton (${texteDe(clic).split("\n")[0]})`);

    const t = await centre("#t");
    await client.appeler("click", { ...id, ...devant, x: Math.round(t.x * echelle), y: Math.round(t.y * echelle) });
    await pause(300);
    const frappe = await client.appeler("type_text", { ...id, ...devant, text: "bonjour" });
    await pause(500);
    const tape = await page("document.querySelector('#t').value");
    verifier(tape === "bonjour", `frappe reçue par le champ (« ${tape} »${tape === "bonjour" ? "" : ` ; ${texteDe(frappe).split("\n")[0]}`})`);

    // 4. Coupé de nouveau.
    await allumer(false);
    e = await pilote.etatPilote();
    verifier(e.statut === "coupe" && pilote.serveurOrdinateur() === null, "coupé : entrée MCP retirée");
    const apres = await client.appeler("list_windows", {}).then(
      (r) => (r.isError ? "refus" : "réponse"),
      () => "échec",
    );
    verifier(apres !== "réponse", `coupé : l'outil ne répond plus (${apres})`);
  } catch (err) {
    if (err !== "fin") verifier(false, `exception : ${err?.stack ?? err}`);
  } finally {
    client?.fermer();
    try {
      require("../dist-electron/ordinateur/pilote.js").arreterPilote();
    } catch {
      /* rien */
    }
    fenetre?.destroy();
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTOUT PASSE");
    app.exit(echecs.length ? 1 : 0);
  }
});
