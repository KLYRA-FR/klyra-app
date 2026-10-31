/**
 * Point 10 — SPEC-EXPORT.md : vraie UI/IPC/écriture, sélecteur système simulé.
 * HOME, données, agents et fichiers sont jetables. Le wrapper n'entre jamais
 * dans le paquet livré ; aucun crochet de test n'est nécessaire en production.
 * Prérequis : build web + Electron. xvfb-run -a node scripts/test-export.mjs
 * KLYRA_TEST_APP : autre checkout construit ; KLYRA_TEST_GESTE : un geste précis.
 * La date du document est fixe ; Date.now/performance.now et les minuteurs restent réels.
 * Limite : les boîtes Enregistrer macOS/Windows ne sont pas pilotées ici.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const APP = path.resolve(process.env.KLYRA_TEST_APP ?? path.resolve(import.meta.dirname, ".."));
const ELECTRON = createRequire(path.join(APP, "package.json"))("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-export-"));
const DATA = path.join(TMP, "userdata"), HOME = path.join(TMP, "home"), DOCUMENTS = path.join(HOME, "Documents"), SORTIE = path.join(TMP, "exports");
const FICHIER = path.join(DATA, "conversations.json"), COMMANDES = path.join(TMP, "commande.json"), REPONSES = path.join(TMP, "reponse.json");
const WRAPPER = path.join(TMP, "main.cjs");
const PORT = 9352, INSTANT = Date.parse("2026-10-30T22:41:00Z");
const ID = "equipe-export", TITRE = "Devis cuisine Martin", BROUILLON = "Brouillon confidentiel fictif conservé";
const OPTIONS = 'main header button[aria-label="Plus d’options"]', MENU = '[role="menu"][aria-label="Options de la conversation"]', RETOUR = '[data-export-conversation]';
const q = JSON.stringify, memes = (a, b) => q(a) === q(b), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const echecs = []; let controles = 0, app, sequence = 0;
function verifier(ok, texte) { controles++; console.log(`${ok ? "OK    " : "ÉCHEC "} ${texte}`); if (!ok) echecs.push(texte); }
async function attendre(fn, ms = 6000) { for (let i = 0; i < ms / 25; i++) { if (await fn().catch(() => false)) return true; await pause(25); } return false; }
const date = "2026-10-30T13:32:00Z";
const chat = (id, title, kind = "equipe", autres = {}) => ({ id, title, kind, projectId: kind === "equipe" ? "durand" : null, roleIds: ["principal"], updatedAt: date, sessions: { principal: "session-privee-fictive" }, luJusqua: "2099-01-01T00:00:00Z", ...autres });
const message = (id, parts, auteur = "principal", autres = {}) => ({ id, chatId: ID, author: auteur === "user" ? { kind: "user" } : { kind: "role", roleId: auteur }, createdAt: date, statut: "fait", parts, ...autres });
const text = text => ({ type: "text", text });
const etapes = { type: "etapes", etapes: [{ id: "etape-privee", outil: "Bash", libelle: "commande-interdite-export", statut: "fait", parent: null, chemin: "/home/prive/cle" }] };
const fixture = () => ({
  version: 1, currentUser: { id: "personne-privee", name: " ", title: "KLYRA", initial: "" },
  chats: [chat(ID, TITRE), chat("vide", "Équipe vide"), chat("technique", "Étapes seulement"), chat("retire", "Ancien projet", "equipe", { projectId: "absent" }), chat("dm-principal", "Ancien nom", "direct"), chat("dm-redacteur", "Léa", "direct", { roleIds: ["redacteur"] }), chat("klyra-fil-export", "Fil à conserver", "direct", { fil: { roleId: "principal", statut: "ouvert", creeLe: date, retourAttendu: false } })],
  messages: [
    message("m-user", [text("\r\nTexte *littéral* # devis_1 🙂\r\n\r\nSuite conservée.   "), text("Second bloc."), { type: "fichiers", chemins: ["/Users/prive/metres_v2.pdf", "C:\\Privé\\photo cuisine.jpg", "/home/prive/collages/capture-2026-10-30.png", "/tmp/nom`rare.md"] }], "user"),
    message("m-code", [text("## Devis\n\n| Poste | Prix |\n|---|---|\n| Bois | 42 € |\n\n[Le lien](https://example.test/devis)\n\n```ts\nconst total = 42;\n```"), etapes, { type: "autorisation", id: "permission-privee", outil: "Bash", libelle: "Commande privée", detail: "secret-technique", description: "Privée", statut: "refusee" }, { type: "tasks", tasks: [] }, { type: "options", options: [] }, { type: "worklog", durationMin: 99, files: [] }, { type: "actions", actions: [] }]),
    message("m-passation", [{ type: "passation", etapeId: "outil-prive", roleId: "redacteur", consigne: "Revoir\n le_devis.", statut: "en-cours" }, { type: "passation", etapeId: "outil-prive2", roleId: "redacteur", consigne: "", statut: "fait" }, { type: "passation", etapeId: "outil-prive3", roleId: "redacteur", consigne: "x".repeat(400), statut: "erreur" }, { type: "proposition-agent", etapeId: "proposition-privee", proposition: { id: "agent-prive", nom: "Juriste *", role: "Droit #", description: "Relire <les> contrats.", consignes: "CONSIGNES_COMPLETES_INTERDITES" } }]),
    message("m-redacteur", [text("Réponse d’un agent désactivé.")], "redacteur"),
    message("m-inconnu", [text("Ancien message à conserver.")], "fantome"),
    message("m-routine", [text("Routine « Quotidien »\n\nVérifier le devis.")], "user", { routineRun: "routine-run-prive" }),
    message("m-encours", [text("  ~~~~js\n  const suite = 2;")], "principal", { statut: "en-cours" }),
    message("m-vide-encours", [], "principal", { statut: "en-cours" }),
    message("m-erreur", [], "principal", { statut: "erreur", erreur: "ERREUR_TECHNIQUE_INTERDITE" }),
    message("m-etapes", [etapes]),
    message("m-technique", [etapes], "principal", { chatId: "technique" }),
    message("m-direct", [text("Message direct conservé.")], "user", { chatId: "dm-principal" }),
    message("m-fil", [text("Message du fil conservé.")], "principal", { chatId: "klyra-fil-export" }),
    message("m-lecture", [text("Ancien message en lecture.")], "redacteur", { chatId: "dm-redacteur" }),
    message("m-retire", [text("Projet retiré, message gardé.")], "user", { chatId: "retire" }),
  ],
  projects: [{ id: "durand", name: "Atelier Durand", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder: path.join(TMP, "projet"), files: [], updatedAt: date }],
  taches: [], routines: [], evenements: [], workflows: [], executions: [], artefacts: [], categories: [{ id: "perso", nom: "Perso", teinte: "bleu-k2", icone: "home-01" }],
});

// Document attendu écrit indépendamment du sérialiseur de production.
const ATTENDU = [
  "# Devis cuisine Martin", "", "- Projet : Atelier Durand",
  "- Participants : Moi, Principal (Ton assistant), Léa (Rédaction), fantome (Agent introuvable sur ce poste), Routine « Quotidien »",
  "- Exporté depuis KLYRA le vendredi 30 octobre 2026 à 23:41", "", "---", "", "**Moi** · 30 oct. 2026 à 14:32", "",
  "Texte *littéral* # devis_1 🙂", "", "Suite conservée.", "", "Second bloc.", "",
  "Pièces jointes : `metres_v2.pdf`, `photo cuisine.jpg`, `capture-2026-10-30.png`, `` nom`rare.md ``", "", "---", "",
  "**Principal** · 30 oct. 2026 à 14:32", "", "## Devis", "", "| Poste | Prix |", "|---|---|", "| Bois | 42 € |", "", "[Le lien](https://example.test/devis)", "", "```ts", "const total = 42;", "```", "", "---", "",
  "**Principal** · 30 oct. 2026 à 14:32", "", "_Confié à Léa · Revoir le\\_devis._", "", "_Rendu par Léa_", "", `_Arrêté chez Léa · ${"x".repeat(200)}…_`, "",
  "_Proposition d’agent : Juriste \\* · Droit \\#_", "", "> Relire \\<les\\> contrats.", "", "---", "",
  "**Léa** · 30 oct. 2026 à 14:32", "", "Réponse d’un agent désactivé.", "", "---", "",
  "**fantome** · 30 oct. 2026 à 14:32", "", "Ancien message à conserver.", "", "---", "",
  "**Routine « Quotidien »** · 30 oct. 2026 à 14:32", "", "Vérifier le devis.", "", "---", "",
  "**Principal** · 30 oct. 2026 à 14:32", "", "  ~~~~js", "  const suite = 2;", "  ~~~~", "", "_Réponse en cours d’écriture au moment de l’export._", "", "---", "",
  "**Principal** · 30 oct. 2026 à 14:32", "", "_L’agent s’est arrêté sur une erreur._", "",
].join("\n");

for (const dossier of [DATA, HOME, DOCUMENTS, SORTIE, path.join(TMP, "projet"), path.join(HOME, ".claude", "agents")]) mkdirSync(dossier, { recursive: true });
writeFileSync(FICHIER, q(fixture()));
writeFileSync(path.join(HOME, ".claude", "agents", "redacteur.md"), '---\nname: redacteur\ndisplayName: Léa\ndescription: Rédaction\n---\n# Léa — Rédaction\n\nFiche fictive de test.\n');
writeFileSync(path.join(DATA, "mes-agents.json"), q({ version: 1, depart: "reprise", assistant: { nom: "Principal", teinte: null }, agents: { redacteur: { actif: false, ajouteLe: INSTANT, origine: { type: "local" }, empreinte: null } } }));

// Le wrapper importe le vrai main ; seule la frontière avec le système est simulée.
writeFileSync(WRAPPER, `
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path');
const electron = require('electron');
const {app, dialog, shell, ipcMain, BrowserWindow, net} = electron;
const ROOT=${q(APP)}, REQ=${q(COMMANDES)}, REP=${q(REPONSES)};
app.setPath('home',${q(HOME)}); app.setPath('documents',${q(DOCUMENTS)}); app.setPath('sessionData',${q(path.join(TMP, "session"))});
let plan={canceled:true}, ouvert=null, panne=null, dernier=0, browser=null;
const journal={dialogues:[],reveles:[],ouverts:[],ipc:{},exterieurs:[],notifications:0};
const handlers=new Map(), originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(canal,fn)=>{handlers.set(canal,fn);return originalHandle(canal,(event,...args)=>{
  journal.ipc[canal]=(journal.ipc[canal]||0)+1;
  if(canal==='claude:stream'||canal==='claude:run'){throw new Error('Agent réel interdit dans le test');}
  if(canal==='systeme:utilisateur')return {ok:false,code:'fixture',message:'Profil fictif seulement'};
  return fn(event,...args);
});};
dialog.showSaveDialog=async(win,options)=>{
  journal.dialogues.push(options); const choisi={...plan};
  if(choisi.attendre) await new Promise(resolve=>ouvert=resolve);
  ouvert=null; panne=choisi.erreur ? {code:choisi.erreur,dir:path.dirname(choisi.filePath),etape:choisi.etape||'open'} : null;
  return {canceled:!!choisi.canceled,filePath:choisi.filePath};
};
shell.showItemInFolder=p=>journal.reveles.push(p);
shell.openPath=async p=>{journal.ouverts.push(p);return '';};
shell.openExternal=async p=>{journal.ouverts.push(p);};
const ouvrir=fsp.open, renommer=fsp.rename;
fsp.open=async function(p,...args){if(panne?.etape==='open'&&path.dirname(String(p))===panne.dir)throw Object.assign(new Error('Erreur de disque fictive'),{code:panne.code});return ouvrir.call(this,p,...args);};
fsp.rename=async function(p,cible,...args){if(panne?.etape==='rename'&&path.dirname(String(cible))===panne.dir)throw Object.assign(new Error('Erreur de remplacement fictive'),{code:panne.code});return renommer.call(this,p,cible,...args);};
const fetchNatif=net.fetch.bind(net); net.fetch=(url,...args)=>{if(/^https?:/.test(String(url))){journal.exterieurs.push(String(url));return Promise.reject(new Error('Réseau externe interdit'));}return fetchNatif(url,...args);};
app.on('web-contents-created',(_e,wc)=>wc.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,done)=>{journal.exterieurs.push(d.url);done({cancel:true});}));
setInterval(async()=>{
  let c;try{c=JSON.parse(fs.readFileSync(REQ,'utf8'));}catch{return;} if(c.id===dernier)return; dernier=c.id;
  try{
    let data;
    if(c.action==='plan'){plan=c.valeur;panne=null;data=true;}
    if(c.action==='liberer'){ouvert?.();data=true;}
    if(c.action==='etat')data={...journal,pending:!!ouvert};
    if(c.action==='frame'){const win=BrowserWindow.getAllWindows().find(w=>w!==browser);const event={sender:win.webContents,senderFrame:{url:'app://klyra/chat'}};data=await handlers.get('conversations:exporter')(event,{contenu:'Refus',nomPropose:'refus - 2026-10-30.md'});}
    if(c.action==='sans-pont'){
      browser?.destroy();browser=new BrowserWindow({width:1100,height:700,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
      await browser.loadURL('app://klyra/chat?id=hero-home'); await new Promise(r=>setTimeout(r,700));
      data=await browser.webContents.executeJavaScript(${q(`(()=>{const b=document.querySelector('main header button[aria-label="Plus d’options"]');b?.click();return typeof window.klyra;})()`)});
      await new Promise(r=>setTimeout(r,100));
      const equipe=await browser.webContents.executeJavaScript(${q(`[...document.querySelectorAll('[role="menuitem"]')].map(e=>e.innerText.split('\\n')[0])`)});
      await browser.loadURL('app://klyra/chat?id=dm-principal');await new Promise(r=>setTimeout(r,700));
      const direct=await browser.webContents.executeJavaScript(${q(`!!document.querySelector('main header button[aria-label="Plus d’options"]')`)});
      browser.destroy();browser=null;data={bridge:data,equipe,direct};
    }
    fs.writeFileSync(REP,JSON.stringify({id:c.id,ok:true,data}));
  }catch(e){fs.writeFileSync(REP,JSON.stringify({id:c.id,ok:false,error:e.message,code:e.code}));}
},20).unref();
require(path.join(ROOT,'dist-electron/main.js'));
`);

const INJECTION = `(() => {
  const NativeDate=Date;function DateFixe(...args){if(!new.target)return new NativeDate(${INSTANT}).toString();return Reflect.construct(NativeDate,args.length?args:[${INSTANT}],new.target);}Object.setPrototypeOf(DateFixe,NativeDate);DateFixe.prototype=NativeDate.prototype;DateFixe.now=NativeDate.now.bind(NativeDate);window.Date=DateFixe;
  const annonces=[],notifications=[];window.addEventListener('klyra:annonce-agents',e=>annonces.push(e.detail));
  class NotificationFausse extends EventTarget{constructor(t){super();notifications.push(t);}close(){}static get permission(){return 'denied';}}Object.defineProperty(window,'Notification',{value:NotificationFausse,configurable:true});
  function workspace(){let el=document.querySelector('main'),f=el?.[Object.keys(el||{}).find(k=>k.startsWith('__reactFiber$'))];for(;f;f=f.return){for(let h=f.memoizedState;h&&typeof h==='object';h=h.next){if(h.memoizedState?.chats&&h.memoizedState?.messages&&h.queue?.dispatch)return h;}}throw new Error('Workspace de test introuvable');}
  window.__exportTest={annonces,notifications,dispatch:a=>workspace().queue.dispatch(a),state:()=>workspace().memoizedState};
})();`;

async function commande(action, valeur) {
  const id=++sequence;writeFileSync(COMMANDES,q({id,action,valeur}));let reponse;
  if(!await attendre(async()=>{try{reponse=JSON.parse(readFileSync(REPONSES,'utf8'));return reponse.id===id;}catch{return false;}},12000))throw new Error(`Commande main sans réponse : ${action}`);
  return reponse;
}
async function etatMain(){const r=await commande('etat');if(!r.ok)throw new Error(r.error);return r.data;}
async function plan(p){await commande('plan',p);}
async function lancer(){
  const fixes=["/usr/local/bin/claude","/opt/homebrew/bin/claude","/usr/bin/claude","/bin/claude"].filter(existsSync);if(fixes.length)throw new Error(`Claude accessible : ${fixes}`);
  const env={...process.env,HOME,KLYRA_USER_DATA:DATA,PATH:'/usr/bin:/bin',TZ:'Europe/Paris',DBUS_SESSION_BUS_ADDRESS:`unix:path=${path.join(TMP,'aucun-bus')}`};
  for(const k of ['ELECTRON_RUN_AS_NODE','KLYRA_DEV_URL','KLYRA_SMOKE_TEST','KLYRA_CLAUDE_PATH','CLAUDE_CONFIG_DIR','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'])delete env[k];
  const logs=[];const processus=spawn(ELECTRON,[WRAPPER,`--remote-debugging-port=${PORT}`,...process.argv.slice(2)],{cwd:APP,env,stdio:['ignore','pipe','pipe']});
  processus.stderr.on('data',b=>logs.push(b.toString()));let cible;
  if(!await attendre(async()=>{cible=await fetch(`http://127.0.0.1:${PORT}/json`).then(r=>r.json()).then(xs=>xs.find(x=>x.type==='page'&&x.url.startsWith('app://')));return !!cible;},20000)){processus.kill();throw new Error(`Electron absent : ${logs.join('').slice(-2500)}`);}
  const ws=new WebSocket(cible.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let numero=0;const enAttente=new Map(),erreurs=[];
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')erreurs.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);if(m.id){enAttente.get(m.id)?.(m);enAttente.delete(m.id);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++numero,timer=setTimeout(()=>{enAttente.delete(id);reject(new Error(`CDP ${method}`));},20000);enAttente.set(id,m=>{clearTimeout(timer);if(m.error)reject(new Error(q(m.error)));else resolve(m.result);});ws.send(q({id,method,params}));});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Page.addScriptToEvaluateOnNewDocument',{source:INJECTION});
  const a={ev,send,erreurs,
    async position(sel){return ev(`(()=>{const e=document.querySelector(${q(sel)});if(!e)throw new Error('Absent '+${q(sel)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);},
    async clic(sel,detail=1,apres=65){const p=await a.position(sel);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:detail});if(apres)await pause(apres);},
    async parquer(){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:4,y:4});},
    async touche(key){const vk={Enter:13,Escape:27,ArrowDown:40,ArrowUp:38,Home:36,End:35,Tab:9}[key];for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:vk,...(key==='Enter'&&type==='keyDown'?{text:'\r'}:{})});await pause(65);},
    async aller(id){await send('Page.navigate',{url:`app://klyra/chat?id=${encodeURIComponent(id)}`});if(!await attendre(()=>ev('!!window.__exportTest && !!document.querySelector("main header")'),10000))throw new Error('Chat absent '+id);await pause(700);},
    async charger(id=ID,data=fixture()){
      await send('Page.navigate',{url:'about:blank'});await pause(500);writeFileSync(FICHIER,q(data));await a.aller(id);
      // Reproduit des messages en cours sans lancer d'agent (le chargement les clôt normalement).
      await ev(`window.__exportTest.dispatch({...${q(data)},type:'charger',acces:'projet'});localStorage.setItem('klyra-brouillons',${q(q({[ID]:{text:BROUILLON,fichiers:[]}}))});`);
      await a.parquer();await pause(900);
    },
    async fermer(){if(processus.exitCode!==null)return;ws.close();processus.kill();await attendre(async()=>processus.exitCode!==null,3000);},
  };return a;
}
const present=sel=>app.ev(`!!document.querySelector(${q(sel)})`), texte=sel=>app.ev(`document.querySelector(${q(sel)})?.innerText.trim()??''`);
const focus=()=>app.ev(`document.activeElement===document.querySelector(${q(OPTIONS)})`);
const stockage=()=>app.ev(`Object.fromEntries(['klyra-brouillons','klyra-onglets-conversations'].map(k=>[k,localStorage.getItem(k)]))`);
const disque=()=>({contenu:readFileSync(FICHIER,'utf8'),mtime:statSync(FICHIER).mtimeMs});
async function menu(){if(!await present(MENU))await app.clic(OPTIONS);if(!await attendre(()=>present(MENU)))throw new Error('Menu absent '+JSON.stringify(app.erreurs));}
async function exporter({clavier=false,detail=1}={}){await menu();const sel=`${MENU} [role=menuitem]:nth-child(${(await app.ev(`window.__exportTest.state().chats.find(c=>c.id===new URL(location.href).searchParams.get('id'))?.kind`))==='equipe'?3:1})`;if(clavier){await app.ev(`document.querySelector(${q(sel)}).focus()`);await app.touche('Enter');}else await app.clic(sel,detail);}
async function fermeRetour(){if(await present(RETOUR))await app.clic(`${RETOUR} button[aria-label="Fermer"]`);}
async function etape(nom,fn){if(process.env.KLYRA_TEST_GESTE&&!nom.startsWith(process.env.KLYRA_TEST_GESTE+' ·'))return;console.log('\n'+nom);try{await fn();verifier(!app.erreurs.length,nom+' : aucune exception renderer');}catch(e){verifier(false,nom+' : '+(e.stack??e));}}

try{
  app=await lancer();
  await etape('1 · Entrées et clavier',async()=>{
    await app.charger();await plan({canceled:true});await exporter();const initial=(await etatMain()).dialogues[0];verifier(initial.defaultPath===path.join(DOCUMENTS,TITRE+' - 2026-10-30.md'),'premier export proposé dans Documents');await menu();const lignes=await app.ev(`[...document.querySelectorAll(${q(MENU+' [role=menuitem]')})].map(e=>e.innerText.split('\\n')[0])`);
    verifier(await app.ev(`document.querySelectorAll(${q(OPTIONS)}).length===1`),'un seul en-tête actif');verifier(memes(lignes,['Renommer','Épingler','Exporter en Markdown…','Ouvrir le projet']),'équipe : quatre lignes, ordre du point 9 conservé');
    await app.touche('ArrowUp');verifier((await app.ev('document.activeElement.innerText'))==='Ouvrir le projet','flèche haut boucle');await app.touche('Home');verifier((await app.ev('document.activeElement.innerText'))==='Renommer','Début');await app.touche('End');verifier((await app.ev('document.activeElement.innerText'))==='Ouvrir le projet','Fin');await app.touche('Escape');verifier(await focus(),'Échap rend le focus');
    for(const id of ['dm-principal','klyra-fil-export','dm-redacteur']){await app.charger(id);await menu();verifier((await texte(MENU))==='Exporter en Markdown…',id+' : export seul');await app.touche('Escape');}
    {const f=fixture();f.chats=f.chats.filter(c=>c.id!=='dm-redacteur');f.messages=f.messages.filter(m=>m.chatId!=='dm-redacteur');await app.charger('dm-redacteur',f);await menu();await app.touche('Enter');verifier((await texte(MENU)).includes('Pas encore de message')&&await app.ev(`document.activeElement.getAttribute('aria-disabled')==='true'`),'directe virtuelle vide : indisponible et focalisable');await app.touche('Escape');}
    for(const id of ['vide','technique']){await app.charger(id);await menu();const ligne=MENU+' [role=menuitem]:nth-child(3)';await app.ev(`document.querySelector(${q(ligne)}).focus()`);const n=(await etatMain()).dialogues.length;await app.touche('Enter');verifier(await present(MENU)&&(await app.ev(`document.activeElement.getAttribute('aria-disabled')`))==='true'&&(await etatMain()).dialogues.length===n,id+' : indisponible, focalisable, aucun dialogue');await app.touche('Escape');}
    const sans=await commande('sans-pont');verifier(sans.ok&&sans.data.bridge==='undefined'&&memes(sans.data.equipe,['Renommer','Épingler','Ouvrir le projet'])&&!sans.data.direct,'sans pont : export absent et pas de menu direct');
  });
  await etape('2 · Fichier exact et données privées',async()=>{
    await app.charger();const cible=path.join(SORTIE,'exact.md');await plan({filePath:cible});await exporter();await attendre(async()=>existsSync(cible));const contenu=readFileSync(cible,'utf8');
    verifier(contenu===ATTENDU,'document identique octet par octet au gabarit indépendant');if(contenu!==ATTENDU){const i=[...ATTENDU].findIndex((_,i)=>ATTENDU[i]!==contenu[i]);console.log('Écart document',i,q(ATTENDU.slice(Math.max(0,i-80),i+180)),q(contenu.slice(Math.max(0,i-80),i+180)));}
    verifier(!/\/Users\/|\/home\/|C:\\|file:\/\/|m-user|session-privee|secret-technique|ERREUR_TECHNIQUE|CONSIGNES_COMPLETES|Brouillon confidentiel|routine-run-prive/.test(contenu),'aucun chemin, identifiant, détail d’erreur, permission ou brouillon');
    verifier(!contenu.startsWith('\uFEFF')&&!contenu.includes('\r')&&contenu.endsWith('\n')&&!contenu.endsWith('\n\n'),'UTF-8 sans BOM, LF et une fin de ligne finale');
  });
  await etape('3 · Conservation du poste',async()=>{
    await app.charger();const avant=disque(),prefs=await stockage(),main=await etatMain();
    for(const mode of [{filePath:path.join(SORTIE,'preserve.md')},{canceled:true},{filePath:path.join(SORTIE,'refus.md'),erreur:'EACCES'}]){await plan(mode);await exporter();await pause(750);verifier(memes(disque(),avant),'contenu et mtime conversations.json inchangés : '+q(mode));verifier(memes(await stockage(),prefs),'brouillons et onglets inchangés');await fermeRetour();}
    const apres=await etatMain();verifier((apres.ipc['conversations:write']??0)===(main.ipc['conversations:write']??0),'aucun appel d’écriture des conversations');verifier(!apres.ipc['claude:stream']&&!apres.ipc['claude:run']&&apres.ouverts.length===main.ouverts.length&&apres.exterieurs.length===main.exterieurs.length,'export sans agent, ouverture automatique ou nouvel appel réseau externe');
  });
  await etape('4 · Instantané en mémoire',async()=>{
    await app.charger();const cible=path.join(SORTIE,'instantane.md');await plan({filePath:cible,attendre:true});await exporter();await attendre(async()=>(await etatMain()).pending);
    await app.ev(`window.__exportTest.dispatch({type:'message/add',message:${q(message('apres-clic',[text('MESSAGE_ARRIVE_APRES')]))}});window.__exportTest.dispatch({type:'message/update',id:'m-encours',patch:m=>({...m,parts:[{type:'text',text:'SUITE_ARRIVEE_APRES'}]})});`);
    await commande('liberer');await attendre(async()=>existsSync(cible));verifier(readFileSync(cible,'utf8')===ATTENDU,'ni message arrivé ni suite de réponse pendant le dialogue');
    await fermeRetour();await menu();const nouveau=message('avant-clic',[text('MESSAGE_AVANT_ECRITURE_DISQUE')]);await app.ev(`window.__exportTest.dispatch({type:'message/add',message:${q(nouveau)}})`);await pause(35);const avantClic=disque(),n=(await etatMain()).ipc['conversations:read'];const cible2=path.join(SORTIE,'avant-disque.md');await plan({filePath:cible2});await exporter();await attendre(async()=>existsSync(cible2));verifier(readFileSync(cible2,'utf8').includes('MESSAGE_AVANT_ECRITURE_DISQUE'),'message en mémoire inclus avant sauvegarde différée');verifier(!JSON.parse(avantClic.contenu).messages.some(m=>m.id==='avant-clic')&&(await etatMain()).ipc['conversations:read']===n,'export issu de la mémoire, sans relecture du JSON');
  });
  await etape('5 · Sélecteur, annulation et dernier dossier',async()=>{
    await app.charger();await plan({canceled:true});const n=(await etatMain()).dialogues.length,a=await app.ev('window.__exportTest.annonces.length');await exporter({clavier:true});await pause(200);const o=(await etatMain()).dialogues[n];verifier(o.title==='Exporter la conversation en Markdown'&&o.buttonLabel==='Exporter'&&memes(o.filters,[{name:'Markdown',extensions:['md']}])&&o.properties.includes('createDirectory')&&o.properties.includes('showOverwriteConfirmation'),'options du sélecteur et confirmation système');verifier(path.basename(o.defaultPath)==='Devis cuisine Martin - 2026-10-30.md','nom proposé daté');verifier(!await present(RETOUR)&&await focus()&&await app.ev('window.__exportTest.annonces.length')===a,'annulation sans message ni annonce, focus sur …');verifier(!readdirSync(DOCUMENTS).length,'aucun fichier dans Documents après annulation');
    const cible=path.join(SORTIE,'sans-extension');await plan({filePath:cible});await exporter();await attendre(async()=>existsSync(cible));verifier(!existsSync(cible+'.md'),'chemin choisi exact, aucune extension ajoutée après confirmation');await fermeRetour();await plan({canceled:true});await exporter();const suivant=(await etatMain()).dialogues.at(-1);verifier(path.dirname(suivant.defaultPath)===SORTIE,'dernier dossier réussi repris pendant la session');
  });
  await etape('6 · Succès, révélation et remplacement',async()=>{
    await app.charger();const cible=path.join(SORTIE,'remplacer.md');writeFileSync(cible,'Ancien contenu');await plan({filePath:cible});await exporter();await attendre(()=>present(RETOUR));verifier(readFileSync(cible,'utf8')===ATTENDU,'remplacement intégral après choix confirmé');verifier((await texte(RETOUR)).includes('Conversation exportée : remplacer.md')&&await focus(),'succès lisible et focus rendu');verifier(await app.ev(`document.querySelectorAll(${q(OPTIONS)}).length===1`),'après export : un seul en-tête actif');
    const annonces=await app.ev('window.__exportTest.annonces');verifier(annonces.filter(a=>a==='Conversation exportée : remplacer.md.').length===1,'annonce accessible une fois');const libelle='Montrer dans le gestionnaire de fichiers';const sel=await app.ev(`(()=>{const bs=[...document.querySelectorAll(${q(RETOUR+' button')})];return bs.findIndex(b=>b.innerText===${q(libelle)});})()`);verifier(sel>=0,'libellé du gestionnaire conforme au Linux du test');if(sel>=0)await app.clic(`${RETOUR} button:nth-of-type(${sel+1})`);const main=await etatMain();verifier(main.reveles.at(-1)===cible&&!main.ouverts.length,'révéler reçoit le chemin, aucun fichier ouvert');verifier(!readdirSync(SORTIE).some(n=>n.includes('.tmp')),'aucun temporaire après réussite');
  });
  await etape('7 · Minuterie et pause',async()=>{
    await app.charger();await plan({filePath:path.join(SORTIE,'minuterie.md')});await exporter();await attendre(()=>present(RETOUR));await app.parquer();await pause(5400);await app.send('Input.dispatchMouseEvent',{type:'mouseMoved',...await app.position(RETOUR)});await pause(3200);verifier(await present(RETOUR),'survol suspend le délai de huit secondes');await app.parquer();await pause(2200);verifier(await present(RETOUR),'reprise donne au moins trois secondes');await pause(1100);verifier(!await present(RETOUR),'succès disparaît après le temps restant');
  });
  await etape('8 · Erreurs et validation IPC',async()=>{
    await app.charger();const cible=path.join(SORTIE,'intact.md');writeFileSync(cible,'À garder');await plan({filePath:cible,erreur:'EACCES',etape:'rename'});await exporter();await attendre(()=>present(RETOUR));verifier((await texte(RETOUR)).includes('pas le droit d’écrire à cet endroit'),'erreur traduite sans détail technique');verifier(readFileSync(cible,'utf8')==='À garder'&&!readdirSync(SORTIE).some(n=>n.includes('.tmp')),'cible intacte et temporaire nettoyé après échec de remplacement');await app.parquer();await pause(15100);verifier(await present(RETOUR),'erreur toujours visible après quinze secondes');await app.ev(`document.querySelector(${q(RETOUR+' button')}).focus()`);await app.touche('Escape');verifier(!await present(RETOUR),'Échap ferme l’erreur focalisée');
    const n=(await etatMain()).dialogues.length;const mauvais=await app.ev(`window.klyra.conversations.exporter({contenu:42,nomPropose:'x.md'})`);verifier(!mauvais.ok,'contenu non textuel refusé');const trop=await app.ev(`window.klyra.conversations.exporter({contenu:'é'.repeat(11*1024*1024),nomPropose:'grand.md'})`);verifier(!trop.ok&&trop.code==='EXPORT_TROP_LONG','plafond UTF-8 20 Mo appliqué');const frame=await commande('frame');verifier(frame.ok&&frame.data?.ok===false&&frame.data.code==='EXPORT_INTERDIT','frame secondaire refusé');verifier((await etatMain()).dialogues.length===n,'arguments, taille et frame rejetés avant sélecteur');
  });
  await etape('9 · Un seul dialogue',async()=>{
    await app.charger();const cible=path.join(SORTIE,'unique.md');await plan({filePath:cible,attendre:true});const n=(await etatMain()).dialogues.length;await menu();const p=await app.position(MENU+' [role=menuitem]:nth-child(3)');for(const compte of [1,2])for(const type of ['mousePressed','mouseReleased'])await app.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:compte});await attendre(async()=>(await etatMain()).pending);verifier((await etatMain()).dialogues.length===n+1,'double clic : un dialogue');const appels=(await etatMain()).ipc['conversations:exporter'];await exporter({clavier:true});await exporter({clavier:true});verifier((await etatMain()).ipc['conversations:exporter']===appels&&(await etatMain()).dialogues.length===n+1&&!await present(RETOUR),'Entrée répétée pendant le sélecteur : verrou renderer, aucun deuxième IPC ni erreur');const occupe=await app.ev(`window.klyra.conversations.exporter({contenu:'Deuxième demande',nomPropose:'deux - 2026-10-30.md'})`);verifier(occupe.ok&&occupe.data.statut==='occupe'&&(await etatMain()).dialogues.length===n+1,'deuxième appel IPC ignoré pendant le dialogue');await commande('liberer');await attendre(async()=>existsSync(cible));verifier(readFileSync(cible,'utf8')===ATTENDU,'premier contenu conservé');
  });
  await etape('10 · Noms, directe et fil',async()=>{
    for(const [titre,base] of [['Devis: v2/final?','Devis v2 final'],['.notes','notes'],['???','Conversation'],['CON','CON'],['CON.txt','Conversation CON.txt'],['NUL.log','Conversation NUL.log'],['a'.repeat(79)+'🙂'+'z'.repeat(40),'a'.repeat(79)+'🙂']]){const f=fixture();f.chats[0].title=titre;await app.charger(ID,f);await plan({canceled:true});await exporter();verifier(path.basename((await etatMain()).dialogues.at(-1).defaultPath)===base+' - 2026-10-30.md','nom proposé : '+titre.slice(0,25));}
    for(const [id,nom,fragment] of [['dm-principal','Conversation avec Principal','# Conversation avec Principal'],['klyra-fil-export','Fil à conserver','- Fil avec Principal'],['dm-redacteur','Conversation avec Léa','Léa (Rédaction)'],['retire','Ancien projet','# Ancien projet']]){const f=fixture();if(id==='klyra-fil-export')f.chats.find(c=>c.id===id).fil.statut='archive';await app.charger(id,f);const cible=path.join(SORTIE,id+'.md');await plan({filePath:cible});await exporter();await attendre(async()=>existsSync(cible));const contenu=readFileSync(cible,'utf8');verifier(path.basename((await etatMain()).dialogues.at(-1).defaultPath)===nom+' - 2026-10-30.md'&&contenu.includes(fragment),id+' : nom et contenu adaptés');if(id==='retire')verifier(!contenu.includes('- Projet :'),'projet retiré absent du document');}
  });
  await etape('11 · Petite fenêtre et mouvement réduit',async()=>{
    await app.send('Emulation.setDeviceMetricsOverride',{width:1100,height:700,deviceScaleFactor:1,mobile:false});await app.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const id of [ID,'dm-principal']){
      await app.charger(id);
      if(id==='dm-principal'&&await present('main header button[aria-label="Ouvrir le panneau (réglages, fichiers, tâches)"]'))await app.clic('main header button[aria-label="Ouvrir le panneau (réglages, fichiers, tâches)"]');
      await menu();const limites=await app.ev(`(()=>{const b=document.querySelector(${q(OPTIONS)}).getBoundingClientRect(),m=document.querySelector(${q(MENU)}).getBoundingClientRect();return {visible:b.left>=0&&b.right<=innerWidth&&m.left>=0&&m.right<=innerWidth&&m.bottom<=innerHeight,animations:document.querySelector(${q(MENU)}).getAnimations().length};})()`);
      verifier(limites.visible&&!limites.animations,id+' : bouton et menu visibles, sans animation');await app.touche('Escape');
      await plan({filePath:path.join(SORTIE,id+' nom volontairement long pour éprouver la place du message exporté.md')});await exporter();await attendre(()=>present(RETOUR));
      verifier((await app.ev(`document.querySelector(${q(RETOUR)}).getAnimations().length`))===0,id+' : message de succès sans animation');
      verifier(await app.ev(`(()=>{const e=document.querySelector(${q(RETOUR)}),r=e.getBoundingClientRect(),s=e.querySelector('span'),style=getComputedStyle(s);return r.left>=0&&r.right<=innerWidth&&style.whiteSpace==='nowrap'&&style.textOverflow==='ellipsis'&&s.scrollWidth>s.clientWidth;})()`),id+' : nom tronqué, retour entièrement visible avec panneau ouvert');
      await fermeRetour();
    }
    await app.send('Emulation.setEmulatedMedia',{features:[]});await app.send('Emulation.clearDeviceMetricsOverride');
  });
  await etape('12 · Retrait à la navigation et absence de notification',async()=>{
    await app.charger();await plan({filePath:path.join(SORTIE,'navigation.md')});await exporter();await attendre(()=>present(RETOUR));const lien=await app.ev(`([...document.querySelectorAll('a[href^="/chat?id="]')].find(e=>e.getAttribute('href')!=='/chat?id='+${q(ID)}&&e.getBoundingClientRect().width>0))?.getAttribute('href')`);if(!lien)throw new Error('Aucune autre conversation visible');await app.ev(`document.querySelector(${q('a[href='+q(lien)+']')}).scrollIntoView({block:'center',behavior:'instant'})`);await pause(250);await app.clic('a[href='+q(lien)+']');await attendre(()=>app.ev(`new URL(location.href).searchParams.get('id')!==${q(ID)}`));await pause(500);verifier(await app.ev(`new URL(location.href).searchParams.get('id')!==${q(ID)}`),'navigation vers une autre conversation accomplie');verifier(!await present(RETOUR),'changer de conversation retire le message de succès');verifier(await app.ev(`document.querySelectorAll(${q(OPTIONS)}).length===1`),'navigation : un seul en-tête, aucun ancien bouton conservé');verifier((await app.ev('window.__exportTest.notifications.length'))===0,'aucune notification demandée');
  });
}catch(e){verifier(false,e.stack??String(e));}
finally{await app?.fermer();if(process.env.KLYRA_TEST_GARDER)console.log('Profil conservé : '+TMP);else rmSync(TMP,{recursive:true,force:true});}
console.log(`\n${controles-echecs.length}/${controles} contrôles réussis${echecs.length?' ; '+echecs.length+' échec(s)':''}.`);process.exitCode=echecs.length?1:0;
