/**
 * L'atelier d'un agent dans la conversation avec l'assistant (outils `proposer_agent` et
 * `proposer_choix`), dans l'app de bureau (export statique), sur un profil et un `~/.claude/agents`
 * jetables. Les réponses de l'assistant sont écrites d'avance dans la conversation : aucun appel à
 * Claude (Claude Code est retiré du PATH de l'app).
 *  - la carte vivante : le dernier appel montre la carte entière, les précédents une ligne ;
 *  - les cinq piliers, le poids de la fiche, la fiche au verso ;
 *  - les réponses toutes prêtes : figées une fois répondues, envoyées d'un clic sinon ;
 *  - la couleur choisie gardée dans la conversation ;
 *  - « Créer l'agent » : la fiche écrite (sans mémoire), active dans Mes agents, à soi, la carte
 *    « Dans ton équipe », l'agent dans la barre latérale.
 * Puis, si Claude Code est là (KLYRA_CLAUDE_PATH), le vrai Claude Code face à un faux fournisseur
 * local (aucun compte, aucune dépense) : l'assistant appelle `proposer_agent` et `proposer_choix` par
 * le serveur MCP de l'app, la carte et les réponses paraissent dans le fil, l'outil lui répond.
 * Enfin la même chose sur un VPS : un vrai serveur KLYRA local (dossier jetable) avec ce Claude Code,
 * relié à l'app ; l'app n'a pas de Claude Code, donc l'épreuve ne peut tourner que sur le serveur.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:atelier:app          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFournisseur } from "./faux-fournisseur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-atelier-"));
const lireJson = (f) => JSON.parse(readFileSync(f, "utf8"));

const home = path.join(TMP, "home");
const agents = path.join(home, ".claude", "agents");
const donnees = path.join(TMP, "userdata");
mkdirSync(agents, { recursive: true });
mkdirSync(donnees, { recursive: true });
// Sans Claude Code : un clic sur une réponse envoie le message, sans appel à une IA.
const env = { HOME: home, KLYRA_USER_DATA: donnees, PATH: "/usr/bin:/bin" };

const parts = (id) => lireJson(path.join(donnees, "conversations.json")).messages.find((m) => m.id === id)?.parts ?? [];
async function surDisque(test, ms = 8000) {
  for (let t = 0; t < ms; t += 250) {
    try {
      if (test()) return true;
    } catch {
      /* fichier en cours d'écriture */
    }
    await attendre(250);
  }
  return false;
}

let app;
try {
  /* Le premier lancement : nommer l'assistant. */
  app = await lancerApp({ port: 9341, env });
  await app.quand("document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')");
  await app.saisir("main form input", "Cicco");
  await app.touche("Enter", "Enter", 13);
  await app.quand("!document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')");
  await app.fermer();

  /* L'atelier mené par l'assistant : deux réponses, deux appels de la carte, deux questions. */
  const conv = lireJson(path.join(donnees, "conversations.json"));
  const maintenant = Date.now();
  const le = (s) => new Date(maintenant - (60 - s) * 1000).toISOString();
  const cicco = (id, s, ps) => ({ id, chatId: "dm-principal", author: { kind: "role", roleId: "principal" }, createdAt: le(s), statut: "fait", parts: ps });
  const moi = (id, s, texte) => ({ id, chatId: "dm-principal", author: { kind: "user" }, createdAt: le(s), parts: [{ type: "text", text: texte }] });
  conv.chats = [...(conv.chats ?? []).filter((c) => c.id !== "dm-principal"), { id: "dm-principal", kind: "direct", projectId: null, title: "Cicco", roleIds: ["principal"], updatedAt: le(40), sessions: {}, luJusqua: null }];
  // Des échanges plus anciens : le fil défile, la carte peut sortir de l'écran.
  const ancien = (i) => (i % 2 ? cicco(`a${i}`, -60 + i, [{ type: "text", text: `Réponse ${i}. ${"Une réponse un peu longue pour remplir le fil. ".repeat(12)}` }]) : moi(`a${i}`, -60 + i, `Question ${i}`));
  conv.messages = [
    ...(conv.messages ?? []),
    ...Array.from({ length: 10 }, (_, i) => ancien(i)),
    moi("m1", 0, "J’aimerais un agent pour mes propositions commerciales : la dernière m’a pris trois heures."),
    cicco("m2", 10, [
      { type: "text", text: "Je vois : un agent commercial. Il lui faut un prénom." },
      { type: "atelier-agent", etapeId: "toolu_e1", maj: { role: "Commercial", mission: "Rédige les propositions commerciales à partir d’un brief client, prêtes à relire." } },
      { type: "choix", etapeId: "toolu_c1", question: "Son prénom ?", options: ["Nina", "Basile", "Romy"], multiple: false },
    ]),
    moi("m3", 20, "Nina"),
    cicco("m4", 30, [
      { type: "text", text: "Nina, c’est noté. Qu’est-ce qui demande ton accord ?" },
      {
        type: "atelier-agent",
        etapeId: "toolu_e2",
        maj: { nom: "Nina", declencheurs: ["Un brief client arrive", "Tu dis « devis »"], livrables: ["Une proposition en .docx"] },
      },
      { type: "choix", etapeId: "toolu_c2", question: "Ce qui demande ton accord", options: ["Envoyer au client", "Engager un prix", "Promettre un délai"], multiple: true },
    ]),
  ];
  writeFileSync(path.join(donnees, "conversations.json"), JSON.stringify(conv));

  app = await lancerApp({ port: 9341, env });
  await app.aller("/chat?id=dm-principal");
  verifier(await app.quand("document.querySelector('main')?.innerText.includes('Atelier · nouvel agent')"), "la carte de l’atelier dans le fil");
  const carte = "document.querySelector('[data-message=\"m4\"]')";
  verifier(await app.quand(`${carte}?.innerText.includes('Nina') && ${carte}.innerText.includes('Commercial')`), "la carte entière sur le dernier appel : prénom et rôle des deux appels");
  verifier(
    (await app.ev(`${carte}?.querySelector('[role=img][aria-label*="piliers sur 5"]')?.getAttribute('aria-label')`)) === "3 piliers sur 5 : sa mission, quand l’appeler, ce qu’il livre",
    "trois piliers allumés sur cinq",
  );
  verifier((await app.ev(`document.querySelector('[data-message="m2"]')?.innerText ?? ''`)).includes("Carte de l’agent : sa mission"), "l’appel précédent : une ligne, ce qu’il a rempli");
  verifier(/~\d+ jetons/.test(await app.ev(`${carte}?.innerText ?? ''`)), "le poids de la fiche sur la carte");

  // La barre de l'atelier : seulement quand la carte est hors de l'écran ; un clic y ramène.
  const barre = "[...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Voir la carte')";
  verifier(!(await app.quand(barre, 1500)), "carte visible : pas de barre de l’atelier");
  await app.ev("document.querySelector('[data-carte-atelier]').closest('.overflow-y-auto').scrollTop = 0; 0");
  verifier(await app.quand(barre), "carte hors de l’écran : la barre de l’atelier en haut du fil");
  verifier((await app.ev(`${barre}?.closest('div.absolute')?.innerText ?? ''`)).includes("Nina"), "la barre montre l’agent en préparation");
  await app.ev(`${barre}.click(); 0`);
  verifier(await app.quand(`!${barre}`, 5000), "« Voir la carte » ramène à la carte, la barre s’en va");

  // Les réponses toutes prêtes : la première est répondue, la seconde attend.
  const puce = (message, texte) => `[...document.querySelectorAll('[data-message="${message}"] [role=group] button')].find((b) => b.innerText.trim() === ${JSON.stringify(texte)})`;
  verifier((await app.ev(`${puce("m2", "Nina")}?.getAttribute('aria-pressed')`)) === "true", "réponse donnée : « Nina » marquée");
  verifier((await app.ev(`${puce("m2", "Basile")}?.disabled`)) === true, "réponse donnée : les autres ne se cliquent plus");
  verifier((await app.ev(`${puce("m4", "Envoyer au client")}?.disabled`)) === false, "la dernière question : réponses ouvertes");

  // Le verso : la fiche telle qu'elle sera écrite.
  await app.cliquer("Voir sa fiche", carte);
  verifier(await app.quand(`${carte}.querySelector('[data-retournee]')`), "« Voir sa fiche » retourne la carte");
  const verso = await app.ev(`${carte}.querySelector('pre')?.innerText ?? ''`);
  verifier(verso.includes("name: nina") && verso.includes("## Quand m’appeler") && !/^memory:/m.test(verso), "au verso : la fiche, sans mémoire");
  await app.cliquer("Retourner la carte", carte);

  // La couleur choisie : gardée dans la conversation.
  await app.ev(`${carte}.querySelector('[role=radio][aria-label="Vert"]')?.click(); 0`);
  verifier(await surDisque(() => parts("m4").some((p) => p.type === "atelier-agent" && p.teinte === "vert")), "la couleur choisie est gardée sur la carte");

  // Plusieurs réponses cochées, puis envoyées : un seul message.
  await app.ev(`${puce("m4", "Envoyer au client")}.click(); ${puce("m4", "Engager un prix")}.click(); 0`);
  await app.cliquer("Envoyer", carte);
  verifier(
    await app.quand(`[...document.querySelectorAll('[data-auteur="user"]')].some((m) => m.innerText.includes('Envoyer au client · Engager un prix'))`),
    "les réponses cochées partent en un message",
  );
  verifier(await app.quand(`${puce("m4", "Promettre un délai")}?.disabled === true && ${puce("m4", "Engager un prix")}?.getAttribute('aria-pressed') === 'true'`), "puis elles se figent sur ce qui a été répondu");

  // La naissance.
  verifier(!existsSync(path.join(agents, "nina.md")), "rien n’est écrit avant « Créer l’agent »");
  await app.cliquer("Créer l’agent", carte);
  // La fiche est créée sans écraser (`wx`) : elle existe un instant avant d'être remplie.
  const ficheEcrite = (nom) => surDisque(() => /\n---\n[\s\S]*\n$/.test(readFileSync(path.join(agents, `${nom}.md`), "utf8")));
  verifier(await ficheEcrite("nina"), "« Créer l’agent » écrit nina.md");
  const fiche = readFileSync(path.join(agents, "nina.md"), "utf8");
  verifier(/^displayName: Nina$/m.test(fiche) && /^description: "Commercial — Rédige les propositions/m.test(fiche) && !/^memory:/m.test(fiche), "la fiche : prénom, description composée, sans mémoire");
  verifier(fiche.includes("## Quand m’appeler\n\n- Un brief client arrive"), "la fiche reprend les piliers");
  verifier(
    await surDisque(() => {
      const mes = lireJson(path.join(donnees, "mes-agents.json"));
      return mes.agents.nina?.actif === true && mes.agents.nina.origine.type === "local";
    }),
    "Nina est active dans Mes agents, à soi",
  );
  verifier(await surDisque(() => lireJson(path.join(donnees, "agents-meta.json")).nina?.teinte === "vert"), "sa couleur est celle choisie sur la carte");
  verifier(await app.quand(`${carte}.innerText.includes('Dans ton équipe') && ${carte}.innerText.includes('Lui écrire')`), "la carte : « Dans ton équipe », « Lui écrire »");
  verifier(await surDisque(() => parts("m4").some((p) => p.type === "atelier-agent" && p.cree === "nina")), "la carte se souvient de l’agent créé");
  verifier(
    await app.quand(`document.querySelector('nav[aria-label="Agents et conversations"]')?.innerText.includes('Nina')`),
    "Nina est dans la barre latérale",
  );
  verifier(await app.quand(`!${carte}.innerText.includes('Créer l’agent')`), "plus de « Créer l’agent » une fois créé");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
  await app.fermer();
  app = null;

  // Au redémarrage, la carte est toujours celle d'un agent créé.
  app = await lancerApp({ port: 9341, env });
  await app.aller("/chat?id=dm-principal");
  verifier(await app.quand(`${carte}?.innerText.includes('Dans ton équipe')`), "redémarrage : la carte reste « Dans ton équipe »");
  await app.fermer();
  app = null;

  /* Le vrai Claude Code appelle les outils de l'atelier (faux fournisseur, réponses scriptées). */
  const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find((c) => c && existsSync(c));
  if (!CLAUDE) console.log("Claude Code introuvable : l’appel des outils par l’assistant est sauté (KLYRA_CLAUDE_PATH).");
  else {
    const fournisseur = await demarrerFournisseur([]);
    try {
      app = await lancerApp({ port: 9341, env: { HOME: home, KLYRA_USER_DATA: donnees, KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" } });
      await app.aller("/chat?id=dm-principal");
      const derniere = "[...document.querySelectorAll('[data-auteur=\"role\"]')].at(-1)";
      const ecrire = async (texte) => {
        await app.saisir("main textarea", texte);
        await app.ev("document.querySelector('main textarea')?.focus(); 0");
        await app.touche("Enter", "Enter", 13);
      };

      await ecrire("atelier lea");
      verifier(await app.quand(`${derniere}?.innerText.includes('L’assistant écrit sa carte')`, 60000), "la carte s’écrit pendant que l’assistant remplit l’outil");
      verifier(await app.quand(`${derniere}?.innerText.includes('Atelier · nouvel agent') && ${derniere}.innerText.includes('Lea')`, 60000), "Claude Code → proposer_agent : une nouvelle carte dans le fil");
      verifier(await app.quand(`${derniere}?.innerText.includes('fin OK')`, 60000), "l’outil répond sans erreur");
      verifier((await app.ev(`${derniere}?.innerText ?? ''`)).includes("Nina fait déjà une partie de ce travail"), "ses voisins dans l’équipe, avant de créer un doublon");
      verifier(
        fournisseur.requetes.some((q) => q.resultats.some((r) => !r.erreur && r.texte.includes("Carte de Lea à jour : 2/5 piliers"))),
        "l’assistant reçoit où en est la carte (2/5 piliers, ce qui reste)",
      );
      verifier(
        (await app.ev(`${derniere}?.querySelector('[role=img][aria-label*="piliers sur 5"]')?.getAttribute('aria-label')`)) === "2 piliers sur 5 : sa mission, quand l’appeler",
        "après un agent créé, la carte suivante repart de zéro",
      );
      verifier(await app.quand(`${carte}?.innerText.includes('Dans ton équipe')`), "la carte de Nina reste « Dans ton équipe »");

      // L'épreuve : trois vrais essais de la fiche, jugés ; un raté propose sa correction.
      const verdict = (type) => app.ev(`${derniere}?.querySelector('[data-cas="${type}"]')?.dataset.verdict`);
      const avantEssais = fournisseur.requetes.length;
      verifier(await app.cliquer("Lancer l’épreuve", derniere), "« Lancer l’épreuve »");
      verifier(
        await app.quand(`['normal','floue','hors-metier'].every((t) => ['ok','ko'].includes(${derniere}?.querySelector('[data-cas="' + t + '"]')?.dataset.verdict))`, 90000),
        "les trois essais reviennent jugés",
      );
      verifier((await verdict("normal")) === "ok" && (await verdict("floue")) === "ok" && (await verdict("hors-metier")) === "ko", "cas normal et demande floue réussis, hors de son métier à corriger");
      const essais = fournisseur.requetes.slice(avantEssais).filter((q) => q.systeme.includes("C'est un essai avant ta création"));
      verifier(essais.length === 3 && essais.every((q) => q.systeme.includes("Suit les concurrents et rend une note sourcée.") && q.outils.length === 0), "chaque essai : la fiche comme agent de la session, sans aucun outil");
      verifier((await app.ev(`!!${derniere}?.querySelector('.klyra-etoile-alerte')`)) === true, "l’étoile « Ses limites » clignote");
      verifier(/\d+ jetons, sur ton compte Claude/.test(await app.ev(`${derniere}?.innerText ?? ''`)), "ce que l’épreuve a coûté, en jetons");
      await app.cliquer("Ajouter à sa fiche et rejouer", derniere);
      verifier(await app.quand(`${derniere}?.querySelector('[data-cas="hors-metier"]')?.dataset.verdict === 'ok'`, 60000), "la phrase ajoutée, l’essai rejoué réussit");
      verifier((await app.ev(`!${derniere}?.querySelector('.klyra-etoile-alerte')`)) === true, "plus d’étoile en alerte");

      // La naissance de Lea, puis la suite : la routine proposée et le partage.
      await app.cliquer("Créer l’agent", derniere);
      verifier(await ficheEcrite("lea"), "Lea est créée");
      verifier(readFileSync(path.join(agents, "lea.md"), "utf8").includes("- Le code et les bugs : je passe la main."), "sa fiche garde la phrase ajoutée pendant l’épreuve");
      verifier(await app.quand(`${derniere}?.innerText.includes('Lui confier : Note de veille')`), "« Lui confier » la routine proposée par l’assistant");
      verifier(
        (await app.ev(`[...${derniere}.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Partager avec l’équipe')?.disabled`)) === true &&
          (await app.ev(`${derniere}.innerText`)).includes("Connecte-toi à ton compte d’équipe"),
        "« Partager avec l’équipe » attend un compte d’équipe, et le dit",
      );
      await app.ev(`[...${derniere}.querySelectorAll('button')].find((b) => b.innerText.includes('Lui confier'))?.click(); 0`);
      verifier(await app.quand("location.href.includes('/routines') && [...document.querySelectorAll('main input')].some((i) => i.value === 'Note de veille')", 15000), "Automatisations s’ouvre sur la routine à relire");
      const routines = path.join(donnees, "routines", "routines.json");
      verifier(!existsSync(routines) || !readFileSync(routines, "utf8").includes("Note de veille"), "rien n’est planifié avant l’enregistrement");
      await app.aller("/chat?id=dm-principal");

      await ecrire("choix x");
      verifier(await app.quand(`${derniere}?.innerText.includes('Réponses affichées')`, 60000), "Claude Code → proposer_choix : l’outil répond sans erreur");
      verifier(
        await app.quand(
          `[...${derniere}.querySelectorAll('[role=group] button')].map((b) => b.innerText.trim() + (b.disabled ? ':grisé' : '')).join('|') === 'Chaque vendredi|Avant un rendez-vous|Quand je cite un concurrent|Envoyer:grisé'`,
        ),
        "les réponses proposées sous sa réponse, à cocher puis envoyer (rien de coché : « Envoyer » grisé)",
      );
      verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
      await app.fermer();
      app = null;

      /* ─── Sur un VPS : un vrai serveur KLYRA local, le même outil ───── */
      const vps = path.join(TMP, "vps");
      const vpsHome = path.join(vps, "home");
      mkdirSync(path.join(vpsHome, ".local", "bin"), { recursive: true });
      mkdirSync(path.join(vpsHome, ".claude"), { recursive: true });
      symlinkSync(CLAUDE, path.join(vpsHome, ".local", "bin", "claude"));
      // Connecté pour le serveur (etat « pret ») ; les appels partent au faux fournisseur par la clé d'API.
      writeFileSync(path.join(vpsHome, ".claude", ".credentials.json"), "{}");
      const port = 20000 + Math.floor(Math.random() * 20000);
      const SERVEUR = path.resolve(import.meta.dirname, "..", "serveur", "klyra-serveur.mjs");
      const envServeur = {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k))),
        HOME: vpsHome,
        KLYRA_SERVEUR_DONNEES: path.join(vps, "donnees"),
        KLYRA_SERVEUR_PORT: String(port),
        KLYRA_SERVEUR_HOTE: "127.0.0.1",
        KLYRA_SERVEUR_NOM: "Klyra-VPS",
        ANTHROPIC_BASE_URL: fournisseur.url,
        ANTHROPIC_API_KEY: "sk-faux-essai",
      };
      const serveur = spawn(process.execPath, [SERVEUR], { env: envServeur, stdio: "ignore" });
      try {
        const adresse = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 40 && !(await fetch(`${adresse}/`).then(() => true, () => false)); i++) await attendre(250);
        const code = execFileSync(process.execPath, [SERVEUR, "appairer"], { env: envServeur }).toString().trim();
        const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(code)}`;
        // Sans Claude Code sur ce PC : seul le VPS peut faire répondre les agents et passer l'épreuve.
        app = await lancerApp({ port: 9341, env });
        const bouton = `document.querySelector('nav button[aria-haspopup="menu"][aria-label*="Serveur : "]')`;
        const ligneServeurs = `document.querySelector('[role="menu"][aria-label="Compte"] [aria-haspopup="menu"]')`;
        const ouvrir = async () => {
          if ((await app.ev(`${bouton}?.getAttribute('aria-expanded')`)) !== "true") await app.ev(`${bouton}.click()`);
          await app.quand(`document.querySelector('[role="menu"][aria-label="Compte"]')`);
          if ((await app.ev(`${ligneServeurs}?.getAttribute('aria-expanded')`)) !== "true") await app.ev(`${ligneServeurs}.click()`);
          return app.quand(`document.querySelector('[role="menu"][aria-label="Serveurs"]')`);
        };
        await ouvrir();
        await app.cliquer("Ajouter un serveur");
        await app.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`);
        await app.saisir('input[aria-label="Lien d’invitation"]', lien);
        await app.cliquer("Rejoindre");
        verifier(await app.quand(`document.querySelector('main')?.innerText.includes("Klyra-VPS")`), "VPS : Klyra-VPS rejoint par le lien");
        await app.aller("/chat?id=dm-principal");
        await ouvrir();
        await app.quand(`[...document.querySelectorAll('[role="menuitemradio"]')].some((b) => b.innerText.includes("Répond"))`);
        await app.ev(`[...document.querySelectorAll('[role="menuitemradio"]')].find((x) => x.innerText.split("\\n")[0].trim() === "Klyra-VPS")?.click(); 0`);
        const hote = new URL(adresse).host;
        verifier(await app.quand(`new URLSearchParams(location.search).get("id") === ${JSON.stringify(`dm-principal@${hote}`)}`), "VPS : la conversation de l’assistant sur Klyra-VPS");
        await app.touche("Escape", "Escape", 27);

        const avant = fournisseur.requetes.length;
        await ecrire("atelier zoe");
        verifier(await app.quand(`${derniere}?.innerText.includes('L’assistant écrit sa carte')`, 60000), "VPS : la carte s’écrit pendant que l’assistant remplit l’outil");
        verifier(await app.quand(`${derniere}?.innerText.includes('Atelier · nouvel agent') && ${derniere}.innerText.includes('Zoe')`, 60000), "VPS : proposer_agent, servi par le VPS, montre la carte dans le fil");
        verifier(await app.quand(`${derniere}?.innerText.includes('fin OK')`, 60000), "VPS : l’outil répond sans erreur");
        verifier(
          fournisseur.requetes.slice(avant).some((q) => q.resultats.some((r) => !r.erreur && r.texte.includes("Carte de Zoe à jour : 2/5 piliers"))),
          "VPS : l’assistant reçoit où en est la carte, calculé sur le VPS",
        );
        verifier((await app.ev(`${derniere}?.innerText ?? ''`)).includes("Nina fait déjà une partie de ce travail"), "VPS : ses voisins, les agents envoyés au VPS");

        const essaisAvant = fournisseur.requetes.length;
        await app.cliquer("Lancer l’épreuve", derniere);
        verifier(
          await app.quand(`['normal','floue','hors-metier'].every((t) => ['ok','ko'].includes(${derniere}?.querySelector('[data-cas="' + t + '"]')?.dataset.verdict))`, 90000),
          "VPS : l’épreuve tourne sur le serveur (ce PC n’a pas Claude Code)",
        );
        verifier(fournisseur.requetes.slice(essaisAvant).filter((q) => q.systeme.includes("C'est un essai avant ta création")).length === 3, "VPS : trois essais de la fiche");
        verifier((await app.ev(`${derniere}?.querySelector('[data-cas="hors-metier"]')?.dataset.verdict`)) === "ko", "VPS : hors de son métier, à corriger");
        await app.cliquer("Ajouter à sa fiche et rejouer", derniere);
        verifier(await app.quand(`${derniere}?.querySelector('[data-cas="hors-metier"]')?.dataset.verdict === 'ok'`, 60000), "VPS : la phrase ajoutée, l’essai rejoué sur le serveur réussit");
        verifier((await app.ev(`${derniere}?.innerText ?? ''`)).includes("sur le compte Claude du VPS"), "VPS : la carte dit que l’épreuve a tourné sur le VPS");
        const journalPc = path.join(donnees, "consommation.jsonl");
        verifier(existsSync(journalPc) && readFileSync(journalPc, "utf8").includes("Claude Code"), "VPS : ce que l’épreuve a consommé est inscrit dans le journal de ce PC");
        await app.cliquer("Créer l’agent", derniere);
        verifier(await ficheEcrite("zoe"), "VPS : Zoe est créée, sa fiche sur ce PC (la source des agents)");
        verifier(readFileSync(path.join(agents, "zoe.md"), "utf8").includes("- Le code et les bugs : je passe la main."), "VPS : sa fiche garde la phrase ajoutée");
        verifier(app.erreurs.length === 0, `VPS : aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
      } finally {
        serveur.kill();
      }
    } finally {
      fournisseur.fermer();
    }
  }
} catch (e) {
  verifier(false, `exception : ${e instanceof Error ? e.stack : e}`);
} finally {
  if (app) await app.fermer();
  // Un Claude Code qui se ferme peut encore écrire ses journaux : le ménage réessaie, puis renonce sans échouer.
  try {
    rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (e) {
    console.log(`(ménage incomplet : ${e.code ?? e.message})`);
  }
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nL’atelier passe.");
process.exit(echecs.length ? 1 : 0);
