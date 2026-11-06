/**
 * Pièces jointes d’une conversation sur un VPS (electron/joints-vps.ts), de bout en bout : l’app (vrai module
 * agents-distants, net.fetch d’Electron) envoie une capture du PC au vrai serveur KLYRA local, puis le message ; un faux Claude Code note ses arguments et lit le fichier qu’on lui donne.
 * Après `pnpm build:electron` : `pnpm test:joints-vps` (Linux : `xvfb-run -a … -- --no-sandbox`).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const REPO = path.resolve(__dirname, "..");
const temporaires = [];
const tmp = (p) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
  temporaires.push(d);
  return d;
};
app.setPath("userData", tmp("e2e-userdata-"));
const FAUX = `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.HOME + "/args.log", JSON.stringify(process.argv.slice(2)) + "\\n");
let t = "";
process.stdin.on("data", (d) => {
  t += d; const l = t.split("\\n"); t = l.pop();
  for (const x of l) { if (!x.trim()) continue; const m = JSON.parse(x); if (m.type !== "user") continue;
    const c = m.message.content; const ch = (c.match(/^- (\\/.+)$/m) || [])[1];
    const lu = ch && fs.existsSync(ch) ? "lu " + fs.readFileSync(ch).length + " octets : " + ch : "rien lu";
    process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "11111111-2222-3333-4444-555555555555" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: lu, session_id: "11111111-2222-3333-4444-555555555555" }) + "\\n"); }
});`;
app.whenReady().then(async () => {
  let code = 1;
  try {
    const srv = await import(pathToFileURL(path.join(REPO, "serveur", "klyra-serveur.mjs")).href);
    const { creerAgents } = await import(pathToFileURL(path.join(REPO, "serveur", "agents.mjs")).href);
    const dossier = tmp("e2e-donnees-"), home = tmp("e2e-home-");
    const claude = path.join(home, "faux-claude");
    fs.writeFileSync(claude, FAUX, { mode: 0o755 });
    fs.writeFileSync(path.join(dossier, "claude-token"), "x");
    process.env.HOME = home;
    const journal = srv.creerJournal();
    const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, claude });
    const ecoute = await srv.ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents });
    const origine = `http://127.0.0.1:${ecoute.port}`;
    const jeton = (await (await fetch(origine + srv.CHEMIN_APPAIRER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: srv.creerCode(dossier) }) })).json()).jeton;

    const d = require(path.join(REPO, "dist-electron", "agents-distants.js"));
    const fins = new Map();
    d.brancherAgentsDistants({
      fenetre: () => ({ evenement: (id, e) => e.type === "fin" && fins.set(id, e), spontane() {}, rendu() {} }),
      equipe: () => ({ fiches: [], assistant: "Cicco", configuration: { memoireAgents: true, consignes: null }, skillsParAgent: {}, empreinte: "e1" }),
      jeton: () => jeton,
    }, [origine]);
    const attendre = async (id) => { for (let i = 0; i < 100 && !fins.has(id); i++) await new Promise((r) => setTimeout(r, 100)); return fins.get(id); };

    // Une capture collée sur « le PC » (ici, un dossier temporaire), jointe au message comme le fait workspace.tsx.
    const collages = tmp("e2e-collages-");
    const capture = path.join(collages, "capture-2026-11-06-101500-ab12.png");
    fs.writeFileSync(capture, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(3 * 1024 * 1024, 7)]));
    const prompt = `Message de Corentin\nRegarde ce fichier.\n\n[Fichiers joints, à lire]\n- ${capture}`;
    await d.streamDistant(origine, "e2e-1", { agent: null, prompt, dossier: null, sessionId: null, chatId: "dm-camille", fichiers: [capture] });
    const fin = await attendre("e2e-1");
    const args = fs.readFileSync(path.join(home, "args.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
    const attendu = path.join(dossier, "joints", "dm-camille");
    const controles = [
      ["réponse reçue", fin?.ok === true],
      ["l'agent du VPS a lu la capture entière", fin?.texte?.startsWith(`lu ${3 * 1024 * 1024 + 4} octets : ${attendu}/`)],
      ["le chemin du PC ne part pas", !fin?.texte?.includes(collages)],
      ["dossier des pièces jointes ouvert à Claude Code", args[args.indexOf("--add-dir") + 1] === attendu],
    ];
    // Trop gros : refusé avant l'envoi, avec la raison.
    const gros = path.join(collages, "gros.bin");
    fs.writeFileSync(gros, Buffer.alloc(20 * 1024 * 1024 + 1));
    await d.streamDistant(origine, "e2e-2", { agent: null, prompt: `x\n\n[Fichiers joints, à lire]\n- ${gros}`, dossier: null, sessionId: null, chatId: "dm-camille", fichiers: [gros] });
    const refus = await attendre("e2e-2");
    controles.push(["fichier de plus de 20 Mo refusé avec sa raison", refus?.ok === false && /dépasse 20 Mo/.test(refus.erreur)]);
    // Sans pièce jointe : rien ne change.
    await d.streamDistant(origine, "e2e-3", { agent: null, prompt: "bonjour", dossier: null, sessionId: null, chatId: "dm-camille", fichiers: [] });
    controles.push(["message sans pièce jointe inchangé", (await attendre("e2e-3"))?.texte === "rien lu"]);
    for (const [nom, ok] of controles) console.log(`${ok ? "OK " : "ÉCHEC"} ${nom}`);
    if (!controles.every(([, ok]) => ok)) console.log(JSON.stringify({ fin, refus, args }, null, 1));
    code = controles.every(([, ok]) => ok) ? 0 : 1;
    await ecoute.fermer();
  } catch (e) {
    console.error(e);
  }
  for (const d of temporaires) fs.rmSync(d, { recursive: true, force: true });
  app.exit(code);
});
