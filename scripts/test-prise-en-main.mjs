/** Vraie app exportée + IPC + Codex, faux programme et faux registre npm locaux.
 * Aucune installation réelle, connexion extérieure, clé ou dépense.
 * `KLYRA_TEST_PREUVES` : captures du rendu, sur des profils de démonstration.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp } from "./pilote-app.mjs";

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-prise-"));
const preuves = process.env.KLYRA_TEST_PREUVES;
if (preuves) mkdirSync(preuves, { recursive: true });
const journal = path.join(TMP, "journal.txt");
const connexion = path.join(TMP, "compte-factice");
const lire = (p) => JSON.parse(readFileSync(p, "utf8"));
const verifier = (ok, texte) => { assert.ok(ok, texte); console.log(`OK ${texte}`); };
const profil = (nom) => {
  const racine = path.join(TMP, nom);
  const maison = path.join(racine, "home");
  const donnees = path.join(racine, "donnees");
  mkdirSync(path.join(maison, ".claude", "agents"), { recursive: true }); mkdirSync(donnees, { recursive: true });
  return { donnees, env: { HOME: maison, USERPROFILE: maison, KLYRA_USER_DATA: donnees, CLAUDE_CONFIG_DIR: path.join(maison, ".claude"), CODEX_HOME: path.join(maison, ".codex"), KLYRA_CODEX_PATH: "", KLYRA_CLAUDE_PATH: "", KLYRA_TEST_PRISE_JOURNAL: journal } };
};

// Le seul binaire installé par le test est ce petit simulateur dans le HOME jetable.
const programme = `#!/usr/bin/env node
const {createInterface}=require('node:readline');
const {existsSync,writeFileSync,appendFileSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const compte=${JSON.stringify(connexion)};
const journal=${JSON.stringify(journal)};
const envoyer=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',ligne=>{
 let m;try{m=JSON.parse(ligne)}catch{return}if(m.id==null)return;
 const repondre=result=>envoyer({id:m.id,result});
 if(m.method==='initialize')return repondre({userAgent:'codex/1.0.0'});
 if(m.method==='account/read')return repondre({account:existsSync(compte)?{type:'chatgpt',email:null,planType:null}:null,requiresOpenaiAuth:true});
 if(m.method==='account/login/start'){
  repondre({loginId:'connexion-test',authUrl:process.env.KLYRA_REGISTRE_NPM+'/connexion-factice'});
  return setTimeout(()=>{writeFileSync(compte,'connecte');envoyer({method:'account/login/completed',params:{loginId:'connexion-test',success:true}})},400);
 }
 if(m.method==='model/list')return repondre({data:[{id:'modele-test',displayName:'Modèle de test',hidden:false,isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}],nextCursor:null});
 if(m.method==='thread/start'||m.method==='thread/resume')return repondre({thread:{id:m.params.threadId||randomUUID()}});
 if(m.method==='turn/start'){
  appendFileSync(journal,'premiere-demande-codex\\n');const id=randomUUID();const threadId=m.params.threadId;
  repondre({turn:{id}});
  return setTimeout(()=>{
   envoyer({method:'turn/started',params:{threadId,turn:{id}}});
   envoyer({method:'item/agentMessage/delta',params:{threadId,turnId:id,itemId:'reponse-test',delta:'Réponse du fournisseur de test : ta demande a bien été transmise à l’IA choisie.'}});
   envoyer({method:'turn/completed',params:{threadId,turn:{id,status:'completed',error:null}}});
  },500);
 }
 return repondre({});
});
`;
const exe = process.platform === "win32" ? "codex.exe" : "codex";
if (process.platform === "win32") { console.log("Le scénario d’interface utilise un exécutable de test Unix ; les contrats de stockage restent testés sur Windows."); process.exit(0); }
const paquet = path.join(TMP, "package"); mkdirSync(path.join(paquet, "bin"), { recursive: true });
writeFileSync(path.join(paquet, "bin", exe), programme); chmodSync(path.join(paquet, "bin", exe), 0o755);
const archivePath = path.join(TMP, "paquet.tgz");
assert.equal(spawnSync("tar", ["-czf", archivePath, "-C", TMP, "package"]).status, 0);
const archive = readFileSync(archivePath);
const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
let premier = true;
let base;
const server = createServer((req, res) => {
  const adresse = decodeURIComponent(req.url);
  res.setHeader("content-type", "application/json");
  if (adresse.endsWith("/paquet.tgz")) { res.setHeader("content-type", "application/octet-stream"); res.setHeader("content-length", archive.length); return res.end(archive); }
  if (adresse.endsWith("/connexion-factice")) return res.end("Connexion factice de test");
  const cible = `@openai/codex-${process.platform}-${process.arch}`;
  if (adresse.includes(cible)) {
    const empreinte = premier ? "sha512-refusee" : integrity; premier = false;
    return res.end(JSON.stringify({ version: "1.0.0", dist: { tarball: `${base}/paquet.tgz`, integrity: empreinte } }));
  }
  if (adresse.includes("@openai/codex")) return res.end(JSON.stringify({ version: "1.0.0", optionalDependencies: { [cible]: "1.0.0" } }));
  res.statusCode = 404; res.end("{}");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
base = `http://127.0.0.1:${server.address().port}`;
let app;
const ouvrir = async (p) => {
  const env = { ...p.env, KLYRA_REGISTRE_NPM: base, PATH: `${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin` };
  const a = await lancerApp({ port: 9472, env, priseEnMain: true, entree: "scripts/faux-prise-en-main.cjs" });
  await a.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return a;
};
const capture = async (id) => {
  if (!preuves) return;
  await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 });
  await attendre(350);
  const r = await app.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(path.join(preuves, `${id}.png`), Buffer.from(r.data, "base64"));
};
const cliquerIA = (nom) => app.ev(`([...document.querySelectorAll('button')].find(b=>b.querySelector('strong')?.textContent===${JSON.stringify(nom)}))?.click()`);
try {
  const p = profil("nouveau");
  const fichier = path.join(p.donnees, "prise-en-main.json");
  app = await ouvrir(p);
  verifier(await app.quand(`document.querySelector('[data-prise-etape="assistant"]')`), "nouveau profil : le parcours complet s’ouvre");
  verifier(await app.ev(`document.activeElement?.tagName === 'INPUT'`), "le champ du nom est accessible au clavier");
  await app.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  verifier(await app.ev(`getComputedStyle(document.querySelector('.prise-contenu')).animationName==='none'`), "la préférence de mouvement réduit désactive les transitions d’étape");
  await app.send("Emulation.setEmulatedMedia", { features: [] });
  await app.saisir(".prise-nommage input", "Sam"); await capture("01-assistant");
  await app.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  verifier(await app.ev("document.documentElement.scrollWidth <= innerWidth"), "le parcours tient à 390 px"); await capture("01-mobile");
  await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.cliquer("Créer mon assistant");
  verifier(await app.quand(`document.querySelector('[data-prise-etape="ia"]')`), "le nom mène au choix d’IA, pas à un accueil non préparé");
  await cliquerIA("ChatGPT");
  verifier(await app.quand(`!![...document.querySelectorAll('button')].find(b=>b.innerText==='Installer ChatGPT'&&!b.disabled)`), "le programme absent est détecté");
  await capture("02-ia-absente");
  await app.cliquer("Installer ChatGPT");
  verifier(await app.quand(`document.querySelector('[role="alert"]')?.innerText.includes('empreinte')`), "un téléchargement invalide reste sur l’étape avec une erreur"); await capture("02-erreur-installation");
  await app.cliquer("Installer ChatGPT");
  verifier(await app.quand(`!![...document.querySelectorAll('button')].find(b=>b.innerText==='Connecter mon compte'&&!b.disabled)`, 20000), "réessayer installe uniquement le programme factice dans le profil jetable");
  await app.cliquer("Connecter mon compte");
  verifier(await app.quand(`!![...document.querySelectorAll('button')].find(b=>b.innerText==='Continuer'&&!b.disabled)`), "la connexion passe par le vrai IPC et le fournisseur factice");
  verifier(readFileSync(journal, "utf8").includes("connexion-factice-ouverte"), "aucune page de compte réelle n’est ouverte"); await capture("02-ia-connectee");
  await app.cliquer("Continuer");
  verifier(await app.quand(`document.querySelector('[data-prise-etape="acces"]')`), "l’IA connectée mène à l’explication des accès");
  await app.ev(`document.querySelectorAll('[aria-label="Accès de ton assistant"] button')[1].click()`); await capture("03-acces");
  await app.cliquer("Continuer");
  verifier(await app.quand(`document.querySelector('[data-prise-etape="demande"]')`), "la première demande se prépare dans le parcours");
  await app.cliquer("Faire le tri dans mes idées");
  await app.saisir(".prise-demande textarea", "Aide-moi à structurer ma présentation.");
  await attendre(800); await capture("04-demande");
  verifier(!readFileSync(journal, "utf8").includes("premiere-demande-codex"), "aucun appel IA avant l’envoi explicite");
  await app.fermer(); app = await ouvrir(p);
  verifier(await app.quand(`document.querySelector('[data-prise-etape="demande"]')`), "la fermeture reprend la bonne étape après le nommage");
  verifier(await app.ev(`document.querySelector('textarea')?.value==='Aide-moi à structurer ma présentation.'`), "le brouillon est conservé au redémarrage");
  rmSync(connexion);
  await app.cliquer("Commencer la conversation");
  verifier(await app.quand(`document.querySelector('[data-prise-etape="ia"]')`), "une connexion expirée est revalidée avant tout envoi");
  verifier(lire(fichier).brouillon.includes("présentation"), "la demande est gardée lors d’une reconnexion");
  await app.cliquer("Connecter mon compte");
  await app.quand(`!![...document.querySelectorAll('button')].find(b=>b.innerText==='Continuer'&&!b.disabled)`);
  await app.cliquer("Continuer"); await app.quand(`document.querySelector('[data-prise-etape="acces"]')`);
  await app.cliquer("Continuer"); await app.quand(`document.querySelector('[data-prise-etape="demande"]')`);
  await app.cliquer("Commencer la conversation");
  verifier(await app.quand(`document.querySelector('main')?.innerText.includes('Réponse du fournisseur de test')`, 20000), "une vraie conversation reçoit la réponse de l’adaptateur Codex factice");
  verifier(await app.quand(`document.querySelector('.prise-guide')?.innerText.includes('première réponse est là')`), "la fin du parcours attend la réponse reçue");
  await capture("05-premiere-reponse");
  await attendre(800);
  verifier(lire(path.join(p.donnees, "conversations.json")).chats.find(c=>c.id==='dm-principal')?.fournisseur==='codex', "l’IA choisie est celle qui répond, sans repli vers Claude");
  await app.cliquer("Continuer l’échange");
  verifier(await app.quand(`!document.querySelector('.prise-guide')`), "l’échange reste ouvert après la prise en main");
  verifier(lire(fichier).etape==='termine', "la fin est enregistrée séparément du nom");
  verifier(await app.quand(`document.querySelector('[data-visite-etape="invitation"][open]')`), "la visite des pages est proposée juste après l’onboarding");
  await app.cliquer("Plus tard");
  verifier(await app.quand(`!document.querySelector('.visite-dialogue')`), "la visite peut être passée pour continuer la conversation");
  verifier(app.erreurs.length===0, "aucune exception JavaScript dans le parcours");
  await app.fermer(); app = null;
  const q=profil("exploration"); app=await ouvrir(q);
  await app.quand(`document.querySelector('[data-prise-etape="assistant"]')`);
  await app.cliquer("Explorer l’app");
  verifier(await app.quand(`document.querySelector('[aria-label="Reprendre la prise en main"]')`), "l’exploration laisse un point de reprise visible");
  verifier(lire(path.join(q.donnees,"prise-en-main.json")).etape!=='termine', "explorer ne valide pas une IA prête");
  await app.cliquer("Reprendre la prise en main");
  verifier(await app.quand(`document.querySelector('[data-prise-etape="assistant"]')`), "le guidage peut reprendre depuis l’accueil");
  await app.aller("/serveurs");
  verifier(await app.ev(`!document.querySelector('[data-prise-etape]') && !!document.querySelector('main')`), "les invitations et serveurs gardent leur propre parcours");
  console.log("PRISE EN MAIN VÉRIFIÉE — profils isolés, installation et connexion simulées, aucun compte réel.");
} finally {
  if (app) await app.fermer();
  await new Promise(r=>server.close(r));
  if (!process.env.KLYRA_TEST_GARDER) rmSync(TMP,{recursive:true,force:true});
}
