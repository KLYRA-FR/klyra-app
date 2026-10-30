/**
 * Mes agents dans l'app de bureau (export statique), sur des profils et des `~/.claude/agents`
 * jetables : les vrais agents ne sont jamais touchés. Gestes de la spec d'Iris (§17) :
 * 1. Nouveau profil, avec des fiches d'un autre outil déjà sur l'ordinateur : l'écran du premier
 *    lancement, nommer l'assistant, Mes agents vide, « Hors de Mes agents », ajouter une fiche
 *    trouvée, la proposition de l'assistant ouverte dans l'éditeur, créer à la main (nom pris,
 *    identifiant pris), un modèle KLYRA, désactiver puis réactiver, et le redémarrage.
 * 2. Installation existante : tout reste, empreintes, réglages et conversations identiques,
 *    l'assistant garde « Principal », modèles reconnus, une fiche modifiée signalée.
 * 2 bis. Installation existante sans conversation (seulement agents-meta.json).
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:agents          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const APP = path.resolve(import.meta.dirname, "..");
const MODELES = path.join(APP, "agents-equipe");
const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-agents-"));
const empreinte = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const empreintesDe = (dossier) => Object.fromEntries(readdirSync(dossier).filter((f) => f.endsWith(".md")).map((f) => [f, empreinte(path.join(dossier, f))]));
const lireJson = (f) => JSON.parse(readFileSync(f, "utf8"));

function profil(nom) {
  const racine = path.join(TMP, nom);
  const home = path.join(racine, "home");
  const agents = path.join(home, ".claude", "agents");
  const donnees = path.join(racine, "userdata");
  mkdirSync(agents, { recursive: true });
  mkdirSync(donnees, { recursive: true });
  return { home, agents, donnees, env: { HOME: home, KLYRA_USER_DATA: donnees } };
}

/** Les cartes de Mes agents : nom, étiquettes et texte. */
const cartes = (app) =>
  app.ev(`[...document.querySelectorAll('main a[href^="/equipe?agent="]')].filter((a) => a.querySelector('h2')).map((a) => ({ id: new URL(a.href).searchParams.get('agent'), texte: a.innerText.replace(/\\s+/g, ' ').trim() }))`);
const panneau = (app) =>
  app.ev(`[...document.querySelectorAll('nav[aria-label="Agents et conversations"] section')][0]?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);

let app;
try {
  /* ─── 1. Nouveau profil ─────────────────────────────────────────── */
  const n = profil("nouveau");
  for (const f of readdirSync(MODELES)) cpSync(path.join(MODELES, f), path.join(n.agents, f));
  writeFileSync(path.join(n.agents, "seo.md"), "---\nname: seo\ndisplayName: Sasha\ndescription: \"SEO — mots-clés. Appelle Sasha pour le SEO.\"\n---\n\n# Sasha — SEO\n\nFiche d’un autre outil.\n");
  const avant = empreintesDe(n.agents);

  app = await lancerApp({ port: 9336, env: n.env });
  verifier(await app.quand("document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')"), "nouveau profil : l’écran du premier lancement");
  let mes = lireJson(path.join(n.donnees, "mes-agents.json"));
  verifier(mes.depart === "nouveau" && Object.keys(mes.agents).length === 0 && mes.assistant.nom === null, "nouveau profil : aucun agent dans Mes agents, assistant à nommer");
  verifier((await app.ev("document.activeElement?.tagName")) === "INPUT", "le champ du nom a le focus");
  await app.saisir("main form input", "Sam");
  await app.touche("Enter", "Enter", 13);
  verifier(await app.quand("!document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')"), "Entrée enregistre le nom");
  verifier(lireJson(path.join(n.donnees, "mes-agents.json")).assistant.nom === "Sam", "le nom est gardé sur l’ordinateur");
  verifier(await app.quand("document.activeElement?.tagName === 'TEXTAREA'"), "l’Accueil : focus dans le composeur");
  verifier(await app.quand("(document.activeElement?.placeholder ?? '').includes('Sam')"), "le composeur écrit à Sam");

  await app.aller("/equipe");
  await app.quand("document.querySelector('[role=tablist]')");
  let c = await cartes(app);
  verifier(c.length === 1 && c[0].id === "principal" && c[0].texte.startsWith("Sam"), `Mes agents : seulement la carte de Sam (${c.map((x) => x.id).join(", ")})`);
  let texte = await app.texte();
  verifier(texte.includes("Pour l’instant, Sam travaille seul."), "le bloc « Sam travaille seul »");
  verifier(texte.includes("Hors de Mes agents · 12"), "les 12 fiches trouvées sont « Hors de Mes agents »");
  verifier(!(await panneau(app)).includes("Hugo"), "le panneau ne propose aucun agent hors de Mes agents");
  verifier(JSON.stringify(empreintesDe(n.agents)) === JSON.stringify(avant), "aucune fiche écrite, modifiée ni supprimée");

  // Ajouter la fiche d'un autre outil : seulement elle, telle quelle.
  await app.ev(`document.querySelector('[data-hors-de-mes-agents]').open = true; 0`);
  await app.cliquer("Ajouter à mes agents", "document.querySelector('[data-agent-hors=\"seo\"]')");
  await app.quand("[...document.querySelectorAll('main a[href^=\"/equipe?agent=\"] h2')].some((h) => h.innerText === 'Sasha')");
  mes = lireJson(path.join(n.donnees, "mes-agents.json"));
  verifier(mes.agents.seo?.actif === true && Object.keys(mes.agents).length === 1, "« Ajouter à mes agents » : seule la fiche seo entre dans Mes agents");
  verifier(empreinte(path.join(n.agents, "seo.md")) === avant["seo.md"], "seo.md inchangé");
  await app.fermer();

  // Une proposition de l'assistant dans sa conversation (réponse simulée, aucun appel à Claude).
  const conv = lireJson(path.join(n.donnees, "conversations.json"));
  const maintenant = new Date().toISOString();
  conv.chats = [...(conv.chats ?? []), { id: "dm-principal", kind: "direct", projectId: null, title: "Sam", roleIds: ["principal"], updatedAt: maintenant, sessions: {}, luJusqua: null }];
  conv.messages = [
    ...(conv.messages ?? []),
    { id: "m-demande", chatId: "dm-principal", author: { kind: "user" }, createdAt: maintenant, parts: [{ type: "text", text: "Aide-moi à créer un agent qui relit mes contrats." }] },
    {
      id: "m-proposition",
      chatId: "dm-principal",
      author: { kind: "role", roleId: "principal" },
      createdAt: maintenant,
      statut: "fait",
      parts: [
        { type: "text", text: "Voici une proposition." },
        {
          type: "proposition-agent",
          etapeId: "toolu_essai",
          proposition: {
            id: "juriste",
            nom: "Nina",
            role: "Juriste",
            description: "Juriste — contrats, CGV. Appelle Nina dès qu’il faut relire un contrat.",
            consignes: "# Nina — Juriste\n\nJe relis les contrats et je réponds en clair.\n\n## Comment je travaille\n\n1. Je lis le contrat en entier.",
          },
        },
      ],
    },
  ];
  writeFileSync(path.join(n.donnees, "conversations.json"), JSON.stringify(conv));

  app = await lancerApp({ port: 9336, env: n.env });
  verifier(!(await app.quand("document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')", 3000)), "redémarrage : pas d’écran du premier lancement");
  await app.aller("/chat?id=dm-principal");
  verifier(await app.quand("document.querySelector('main')?.innerText.includes('Proposition d’agent')"), "la carte « Proposition d’agent » dans le fil");
  await app.cliquer("Ouvrir pour ajuster");
  verifier(await app.quand("document.querySelector('main')?.innerText.includes('Préparé par Sam')"), "l’éditeur s’ouvre, préparé par Sam");
  verifier((await app.ev("document.querySelector('main input')?.value")) === "Nina", "le nom proposé est pré-rempli");
  verifier(!existsSync(path.join(n.agents, "juriste.md")), "rien n’est écrit avant « Créer l’agent »");
  await app.cliquer("Créer l’agent");
  verifier(await app.quand("new URL(location.href).searchParams.get('agent') === 'juriste'"), "« Créer l’agent » ouvre sa fiche");
  mes = lireJson(path.join(n.donnees, "mes-agents.json"));
  verifier(existsSync(path.join(n.agents, "juriste.md")) && mes.agents.juriste?.actif && mes.agents.juriste.origine.type === "local", "juriste.md écrit, actif dans Mes agents, à soi");

  // Créer à la main : un nom pris, puis un identifiant pris.
  await app.aller("/equipe?nouveau=1");
  await app.quand("document.querySelector('main input')");
  await app.saisir("main input", "Sasha");
  await app.cliquer("Créer l’agent");
  verifier(await app.quand("document.querySelector('main')?.innerText.includes('Tu as déjà un agent qui s’appelle Sasha')"), "nom déjà pris : l’erreur l’explique");
  await app.saisir("main input", "Dev");
  await app.ev(`(() => { const t = [...document.querySelectorAll('main textarea')][0]; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Dev — essai. Appelle Dev pour l’essai.'); t.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
  await app.ev(`(() => { const i = [...document.querySelectorAll('main input')][1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Essai'); i.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
  await attendre(300);
  verifier(
    (await app.texte()).includes("identifiant « dev-2 »") && (await app.ev("document.querySelector('main details')?.textContent ?? ''")).includes("« dev » est déjà pris : celui-ci s’appellera « dev-2 »"),
    "identifiant pris : « dev-2 » visible, et l’aide l’explique",
  );
  const avantCreation = empreintesDe(n.agents);
  await app.cliquer("Créer l’agent");
  verifier(await app.quand("new URL(location.href).searchParams.get('agent') === 'dev-2'"), "agent créé sous « dev-2 »");
  const apresCreation = empreintesDe(n.agents);
  verifier(Object.keys(avantCreation).every((f) => avantCreation[f] === apresCreation[f]), "aucune autre fiche modifiée (dev.md compris)");

  // Un modèle KLYRA déjà sur l'ordinateur : remis tel quel dans Mes agents, sans « designer-2 ».
  await app.aller("/equipe?vue=bibliotheque");
  await app.quand("document.querySelector('main')?.innerText.includes('Modèles KLYRA')");
  await app.ev(`document.querySelector('button[aria-label="Ajouter Iris à tes agents"]')?.click(); 0`);
  await app.quand("document.querySelector('[role=dialog]')");
  await app.cliquer("Ajouter", "document.querySelector('[role=dialog]')");
  await app.quand("!document.querySelector('[role=dialog]')");
  mes = lireJson(path.join(n.donnees, "mes-agents.json"));
  verifier(mes.agents.designer?.actif && !existsSync(path.join(n.agents, "designer-2.md")), "modèle Iris remis dans Mes agents, sans second exemplaire");
  verifier(empreinte(path.join(n.agents, "designer.md")) === avant["designer.md"], "designer.md inchangé");

  // Désactiver Nina : elle sort de partout, sa conversation reste lisible, elle revient telle quelle.
  await app.aller("/equipe?agent=juriste");
  await app.ev(`document.querySelector('main button[aria-label="Plus d’options"]')?.click(); 0`);
  await app.quand("document.querySelector('[role=menu]')");
  await app.cliquer("Désactiver", "document.querySelector('[role=menu]')");
  await app.quand("document.querySelector('[role=alertdialog]')");
  verifier((await app.ev("document.querySelector('[role=alertdialog]')?.innerText ?? ''")).includes("Cela ne vaut que pour KLYRA"), "la confirmation dit que cela ne vaut que pour KLYRA");
  await app.cliquer("Désactiver", "document.querySelector('[role=alertdialog]')");
  await app.quand("document.querySelector('main')?.innerText.includes('n’est plus dans Mes agents depuis')");
  mes = lireJson(path.join(n.donnees, "mes-agents.json"));
  verifier(mes.agents.juriste.actif === false && existsSync(path.join(n.agents, "juriste.md")), "désactivée : fichier gardé, inactif dans Mes agents");
  verifier(!(await panneau(app)).includes("Nina"), "le panneau ne la propose plus");
  await app.aller("/chat?id=dm-juriste");
  verifier(await app.quand("document.querySelector('main')?.innerText.includes('Nina n’est plus dans Mes agents. Ses messages restent lisibles.')"), "sa conversation : la barre remplace le composeur");
  await app.cliquer("Réactiver");
  await app.quand("!document.querySelector('main')?.innerText.includes('n’est plus dans Mes agents')");
  verifier(lireJson(path.join(n.donnees, "mes-agents.json")).agents.juriste.actif === true, "« Réactiver » : même agent, de retour");
  await app.fermer();

  app = await lancerApp({ port: 9336, env: n.env });
  await app.aller("/equipe");
  await app.quand("document.querySelector('[role=tablist]')");
  c = await cartes(app);
  verifier(["principal", "dev-2", "designer", "juriste", "seo"].every((id) => c.some((x) => x.id === id)) && c.length === 5, `après redémarrage : Sam et ses 4 agents (${c.map((x) => x.id).join(", ")})`);
  verifier(c.find((x) => x.id === "designer")?.texte.includes("Modèle KLYRA"), "Iris étiquetée « Modèle KLYRA »");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs[0]}` : ""}`);
  await app.fermer();
  app = null;

  /* ─── 2. Installation existante ──────────────────────────────────── */
  const r = profil("reprise");
  for (const f of readdirSync(MODELES)) cpSync(path.join(MODELES, f), path.join(r.agents, f));
  writeFileSync(path.join(r.agents, "dev.md"), `${readFileSync(path.join(MODELES, "dev.md"), "utf8")}\n## Ajout local\n\nUne règle à moi.\n`);
  writeFileSync(path.join(r.agents, "perso.md"), "---\nname: perso\ndisplayName: Perso\ndescription: \"Perso — essai. Appelle Perso pour l’essai.\"\n---\n\n# Perso — Essai\n\nÀ moi.\n");
  const reglages = { dev: { tag: "Code", teinte: "violet" } };
  writeFileSync(path.join(r.donnees, "agents-meta.json"), JSON.stringify(reglages));
  const conversations = {
    version: 1,
    chats: [
      { id: "dm-dev", kind: "direct", projectId: null, title: "Hugo", roleIds: ["dev"], updatedAt: "2026-10-29T10:00:00.000Z", sessions: { dev: "11111111-1111-4111-8111-111111111111" }, luJusqua: null },
      { id: "equipe-1", kind: "equipe", projectId: null, title: "Refonte", roleIds: ["principal", "designer"], updatedAt: "2026-10-29T11:00:00.000Z", sessions: {}, luJusqua: null },
    ],
    messages: [{ id: "m1", chatId: "dm-dev", author: { kind: "user" }, createdAt: "2026-10-29T10:00:00.000Z", parts: [{ type: "text", text: "Bonjour Hugo" }] }],
  };
  writeFileSync(path.join(r.donnees, "conversations.json"), JSON.stringify(conversations));
  const avantReprise = empreintesDe(r.agents);

  app = await lancerApp({ port: 9336, env: r.env });
  await attendre(1500);
  verifier(!(await app.texte()).includes("donne un nom à ton assistant"), "reprise : pas d’écran du premier lancement");
  mes = lireJson(path.join(r.donnees, "mes-agents.json"));
  verifier(mes.depart === "reprise" && Object.keys(mes.agents).length === 12 && Object.values(mes.agents).every((e) => e.actif), "reprise : les 12 fiches dans Mes agents, actives");
  verifier(mes.assistant.nom === "Principal", "reprise : l’assistant garde « Principal »");
  verifier(JSON.stringify(empreintesDe(r.agents)) === JSON.stringify(avantReprise), "reprise : empreinte de chaque fiche inchangée");
  verifier(JSON.stringify(lireJson(path.join(r.donnees, "agents-meta.json"))) === JSON.stringify(reglages), "reprise : réglages des agents intacts");
  const relues = lireJson(path.join(r.donnees, "conversations.json"));
  verifier(
    JSON.stringify(relues.chats.map((x) => [x.id, x.roleIds, x.sessions])) === JSON.stringify(conversations.chats.map((x) => [x.id, x.roleIds, x.sessions])) && relues.messages.length === 1,
    "reprise : conversations, sessions et messages intacts",
  );
  await app.aller("/equipe");
  await app.quand("document.querySelector('[role=tablist]')");
  texte = await app.texte();
  verifier(texte.includes("Tes 12 agents et leurs conversations sont toujours là."), "la note unique de reprise");
  c = await cartes(app);
  verifier(c.filter((x) => x.texte.includes("Modèle KLYRA")).length === 10, `10 modèles KLYRA à jour reconnus (${c.filter((x) => x.texte.includes("Modèle KLYRA")).length})`);
  verifier(c.find((x) => x.id === "dev")?.texte.includes("Code") && !c.find((x) => x.id === "dev")?.texte.includes("Modèle KLYRA"), "la fiche modifiée : sans étiquette, son rôle court personnel gardé");
  await app.aller("/equipe?agent=dev");
  verifier(await app.quand("document.querySelector('main')?.innerText.includes('Ta version diffère du modèle KLYRA.')"), "sa fiche propose de comparer avec le modèle");
  await app.aller("/equipe");
  await app.ev(`document.querySelector('button[aria-label="Fermer la note"]')?.click(); 0`);
  await app.fermer();
  app = await lancerApp({ port: 9336, env: r.env });
  await app.aller("/equipe");
  await app.quand("document.querySelector('[role=tablist]')");
  verifier(!(await app.texte()).includes("sont toujours là"), "la note fermée ne revient pas");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs[0]}` : ""}`);
  await app.fermer();
  app = null;

  /* ─── 2 bis. Installation existante sans conversation ────────────── */
  const b = profil("reprise-sans-conversation");
  for (const id of ["dev", "qa", "val"]) cpSync(path.join(MODELES, `${id}.md`), path.join(b.agents, `${id}.md`));
  writeFileSync(path.join(b.donnees, "agents-meta.json"), "{}");
  app = await lancerApp({ port: 9336, env: b.env });
  await attendre(1500);
  mes = lireJson(path.join(b.donnees, "mes-agents.json"));
  verifier(
    mes.depart === "reprise" && Object.keys(mes.agents).length === 3 && mes.assistant.nom === "Principal" && !(await app.texte()).includes("donne un nom"),
    "sans conversation mais déjà ouverte : reprise, 3 agents actifs, « Principal »",
  );
  await app.fermer();
  app = null;
} finally {
  if (app) await app.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
