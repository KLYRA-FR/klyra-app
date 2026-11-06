/**
 * L'atelier d'une équipe en grand, dans l'app de bureau (export statique), sur un profil et un
 * `~/.claude/agents` jetables, sans aucun appel à une IA (Claude Code est retiré du PATH de l'app) :
 * les réponses de l'assistant sont écrites d'avance dans la conversation, l'app est relancée entre
 * deux temps. Ce qui est vérifié :
 *  - dans le fil, un module compact qui s'ouvre en grand ; la conversation passe dans une colonne,
 *    ses cartes d'équipe repliées en une ligne ; Échap revient au fil ;
 *  - 1. ses tâches avec ses mots : une proposition de l'assistant bloque « Valider mes tâches » tant
 *    qu'elle n'est pas gardée ou retirée ; valider envoie ses tâches à l'assistant ;
 *  - 2. les regrouper : une tâche glissée au pointeur d'un groupe à l'autre, une autre gardée pour
 *    elle par son menu ; valider envoie les groupes ;
 *  - 3. son équipe : aucun prénom imposé (« Créer l'équipe » attend), un prénom suggéré ou écrit,
 *    une ligne proposée gardée, une autre laissée (hors de la fiche), ← / → d'un agent à l'autre ;
 *    les fiches écrites dans le dossier de l'app, sans mémoire, rien sur le poste.
 * Avec KLYRA_CAPTURES=<dossier>, une capture de chaque temps (pour relire à l'œil, pas une vérification).
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:atelier-equipe:app          (sous Linux : xvfb-run -a … -- --no-sandbox)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-atelier-equipe-"));
const lireJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const home = path.join(TMP, "home");
const poste = path.join(home, ".claude", "agents");
const donnees = path.join(TMP, "userdata");
const agents = path.join(donnees, "equipe");
mkdirSync(poste, { recursive: true });
mkdirSync(donnees, { recursive: true });
const env = { HOME: home, KLYRA_USER_DATA: donnees, PATH: "/usr/bin:/bin" };
const CAPTURES = process.env.KLYRA_CAPTURES;
const conversations = path.join(donnees, "conversations.json");

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
const part = (etapeId) => lireJson(conversations).messages.flatMap((m) => m.parts).find((p) => p.type === "atelier-equipe" && p.etapeId === etapeId);
const dernierDeMoi = () => lireJson(conversations).messages.filter((m) => m.chatId === "dm-principal" && m.author.kind === "user").at(-1);
const texteDe = (m) => (m?.parts ?? []).map((p) => p.text ?? "").join("");

const maintenant = Date.now();
let s = 0;
const le = () => new Date(maintenant - (120 - s++) * 1000).toISOString();
const cicco = (id, ps) => ({ id, chatId: "dm-principal", author: { kind: "role", roleId: "principal" }, createdAt: le(), statut: "fait", parts: ps });
const moi = (id, texte) => ({ id, chatId: "dm-principal", author: { kind: "user" }, createdAt: le(), parts: [{ type: "text", text: texte }] });
/** Ajoute des messages à la conversation (l'app est fermée). */
function ajouter(...messages) {
  const conv = lireJson(conversations);
  conv.messages = [...conv.messages, ...messages];
  writeFileSync(conversations, JSON.stringify(conv));
}

let app;
async function capture(nom) {
  if (!CAPTURES || !app) return;
  mkdirSync(CAPTURES, { recursive: true });
  const r = await app.send("Page.captureScreenshot", { format: "png" });
  if (r?.data) writeFileSync(path.join(CAPTURES, `${nom}.png`), Buffer.from(r.data, "base64"));
}
/** Un vrai geste du pointeur : appuyé sur un élément, glissé jusqu'à un autre, relâché. */
async function glisser(depuis, vers) {
  const centre = (sel) => app.ev(`(() => { const r = ${sel}?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 60) } : null; })()`);
  const a = await centre(depuis);
  const b = await centre(vers);
  if (!a || !b) return false;
  const souris = (type, p, boutons) => app.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: boutons, clickCount: type === "mouseMoved" ? 0 : 1 });
  await souris("mousePressed", a, 1);
  for (let i = 1; i <= 8; i++) {
    await souris("mouseMoved", { x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }, 1);
    await attendre(30);
  }
  await souris("mouseReleased", b, 0);
  return true;
}

const atelier = "document.querySelector('[data-atelier-equipe]')";
const ouvrirDepuisLeFil = async () => {
  await app.aller("/chat?id=dm-principal");
  await app.quand("document.querySelector('[data-carte-equipe]')");
  await app.cliquer("Ouvrir l’atelier", "document.querySelector('[data-carte-equipe]')");
  return app.quand(atelier);
};
const principal = (libelle) => `[...${atelier}.querySelectorAll('header button')].find((b) => b.innerText.trim() === ${JSON.stringify(libelle)})`;

try {
  /* Le premier lancement : nommer l'assistant. */
  app = await lancerApp({ port: 9343, env });
  await app.quand("document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')");
  await app.saisir("main form input", "Cicco");
  await app.touche("Enter", "Enter", 13);
  await app.quand("!document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')");
  await app.fermer();

  /* 1. Ses tâches, après deux questions. */
  const conv = lireJson(conversations);
  conv.chats = [...(conv.chats ?? []).filter((c) => c.id !== "dm-principal"), { id: "dm-principal", kind: "direct", projectId: null, title: "Cicco", roleIds: ["principal"], updatedAt: le(), sessions: {}, luJusqua: null }];
  conv.messages = [];
  writeFileSync(conversations, JSON.stringify(conv));
  ajouter(
    moi("m1", "J’aimerais une équipe d’agents."),
    cicco("m2", [{ type: "text", text: "Partons de ta semaine : qu’est-ce qui revient ?" }]),
    moi("m3", "Les mails des clients, le post du lundi, et caler puis préparer mes rendez-vous."),
    cicco("m4", [
      { type: "text", text: "J’ai posé tes tâches sur la table, avec tes mots. J’en ajoute une en pointillés." },
      {
        type: "atelier-equipe",
        etapeId: "toolu_t1",
        maj: {
          nom: "Mon équipe",
          taches: [
            { id: "mails", texte: "Répondre aux mails des clients" },
            { id: "post", texte: "Écrire le post LinkedIn du lundi" },
            { id: "caler", texte: "Caler les rendez-vous avec les prospects" },
            { id: "prep", texte: "Préparer mes rendez-vous" },
            { id: "devis", texte: "Relancer les devis sans réponse", origine: "assistant", pourquoi: "Tu parles de prospects : les relances vont souvent avec." },
            { id: "envoi", texte: "Envoyer les mails", pourElle: true },
          ],
        },
      },
    ]),
  );

  app = await lancerApp({ port: 9343, env });
  await app.aller("/chat?id=dm-principal");
  const moduleFil = "document.querySelector('[data-carte-equipe]')";
  verifier(await app.quand(`${moduleFil}?.dataset.etapeEquipe === 'taches' && ${moduleFil}.innerText.includes('Atelier · nouvelle équipe · Tes tâches')`), "dans le fil : le module de l’équipe, au temps de ses tâches");
  verifier((await app.ev(`${moduleFil}.innerText`)).includes("1 proposition à trancher"), "le module dit qu’une proposition attend");
  verifier(!(await app.ev(`${moduleFil}.innerText`)).includes("Léa"), "aucun agent ni prénom posé avant ses tâches");
  await capture("0-fil");
  verifier(await ouvrirDepuisLeFil(), "« Ouvrir l’atelier » : l’atelier en grand");
  await capture("1-taches");
  verifier((await app.ev(`${atelier}.querySelectorAll('[data-tache]').length`)) === 6, "ses six tâches sur la table");
  verifier((await app.ev(`${atelier}.querySelector('[data-tache="devis"]')?.hasAttribute('data-proposee')`)) === true, "la tâche ajoutée par l’assistant en pointillés");
  verifier((await app.ev(`${atelier}.querySelector('aside textarea') !== null && ${atelier}.querySelector('aside [data-carte-equipe]') === null`)) === true, "la conversation à droite, avec son composeur, la carte repliée en une ligne");
  verifier((await app.ev(`${principal("Valider mes tâches")}?.disabled`)) === true, "« Valider mes tâches » attend sa réponse à la proposition");
  await app.cliquer("Garder", `${atelier}.querySelector('[data-tache="devis"]')`);
  verifier(await surDisque(() => part("toolu_t1").choix?.taches?.devis === true), "la proposition gardée est notée sur la carte");
  verifier(await app.quand(`${principal("Valider mes tâches")}?.disabled === false`), "« Valider mes tâches » s’allume");
  await app.ev(`${principal("Valider mes tâches")}.click(); 0`);
  verifier(
    await surDisque(() => {
      const t = texteDe(dernierDeMoi());
      return t.startsWith("Mes tâches sont prêtes :") && t.includes("- Relancer les devis sans réponse") && t.includes("Je garde pour moi :\n- Envoyer les mails");
    }),
    "valider envoie ses tâches à l’assistant, avec ce qu’elle garde",
  );
  await app.ev("document.activeElement?.blur(); 0");
  await app.touche("Escape", "Escape", 27);
  verifier(await app.quand(`!${atelier} && document.querySelector('[data-carte-equipe]')`), "Échap revient à la conversation");
  verifier(app.erreurs.length === 0, `temps 1 : aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
  await app.fermer();
  app = null;

  /* 2. Les regrouper. */
  ajouter(
    cicco("m6", [
      { type: "text", text: "Je les regrouperais comme ça. Un agent par groupe, ou un seul pour tout ?" },
      {
        type: "atelier-equipe",
        etapeId: "toolu_g1",
        maj: {
          groupes: [
            { id: "textes", nom: "Les textes", pourquoi: "Même ton, même relecture." },
            { id: "rdv", nom: "Rendez-vous et prospects", pourquoi: "Ton agenda et tes prospects." },
          ],
          taches: [
            { id: "mails", groupe: "textes" },
            { id: "post", groupe: "textes" },
            { id: "caler", groupe: "rdv" },
            { id: "prep", groupe: "textes" },
            { id: "devis", groupe: "rdv" },
          ],
        },
      },
    ]),
  );
  app = await lancerApp({ port: 9343, env });
  verifier(await ouvrirDepuisLeFil(), "l’atelier s’ouvre sur le temps des groupes");
  verifier(await app.quand(`${atelier}.querySelectorAll('[data-zone]').length === 3`), "deux groupes proposés, et « Pour toi »");
  verifier((await app.ev(`${atelier}.querySelector('[data-zone="rdv"] [data-tache="devis"]') !== null`)) === true, "la proposition gardée au temps 1 est rangée comme les autres");
  verifier(await glisser(`${atelier}.querySelector('[data-tache="prep"]')`, `${atelier}.querySelector('[data-zone="rdv"]')`), "une tâche glissée au pointeur");
  verifier(await surDisque(() => part("toolu_g1").choix?.places?.prep === "rdv"), "« Préparer mes rendez-vous » passe dans « Rendez-vous et prospects »");
  verifier(await app.quand(`${atelier}.querySelector('[data-zone="rdv"] [data-tache="prep"]')`), "la table la montre dans son nouveau groupe");
  await app.ev(`${atelier}.querySelector('[data-tache="post"] button[aria-label="Que faire de cette tâche"]').click(); 0`);
  verifier(await app.quand("document.querySelector('[role=menu]')"), "le menu d’une tâche");
  await app.cliquer("Je la garde pour moi", "document.querySelector('[role=menu]')");
  verifier(await surDisque(() => part("toolu_g1").choix?.places?.post === "elle"), "le post du lundi gardé pour elle, par le menu");
  await capture("2-groupes");
  await app.ev(`${principal("Valider les groupes")}.click(); 0`);
  verifier(
    await surDisque(() => {
      const t = texteDe(dernierDeMoi());
      return t.startsWith("Mes groupes sont prêts") && t.includes("- Rendez-vous et prospects : Caler les rendez-vous avec les prospects ; Préparer mes rendez-vous ; Relancer les devis sans réponse") && t.includes("Je garde pour moi : Écrire le post LinkedIn du lundi ; Envoyer les mails");
    }),
    "valider envoie les groupes à l’assistant, tels qu’elle les a laissés",
  );
  verifier(app.erreurs.length === 0, `temps 2 : aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
  await app.fermer();
  app = null;

  /* 3. Son équipe. */
  ajouter(
    moi("m7b", "Deux agents."),
    cicco("m8", [
      { type: "text", text: "Voilà tes deux agents. Choisis-leur un prénom." },
      {
        type: "atelier-equipe",
        etapeId: "toolu_e1",
        maj: {
          membres: [
            {
              id: "redaction",
              groupe: "textes",
              prenoms: ["Léa", "Romy"],
              role: "Rédaction",
              mission: "Prépare tes réponses aux clients en brouillons à relire.",
              livrables: ["Un brouillon prêt à relire, dans un fichier"],
              limites: ["N’envoie jamais un mail lui-même"],
              methode: ["Tutoie, comme toi dans tes mails"],
              proposes: ["Tutoie, comme toi dans tes mails"],
            },
            {
              id: "agenda",
              groupe: "rdv",
              prenoms: ["Malo"],
              role: "Agenda et prospects",
              mission: "Cale et prépare tes rendez-vous, relance les devis.",
              limites: ["Ne confirme aucun rendez-vous sans toi"],
              verification: ["Aucun créneau en conflit avec ton agenda"],
              proposes: ["Aucun créneau en conflit avec ton agenda"],
            },
          ],
        },
      },
    ]),
  );
  app = await lancerApp({ port: 9343, env });
  await app.aller("/chat?id=dm-principal");
  verifier(await app.quand(`document.querySelector('[data-carte-equipe]')?.dataset.etapeEquipe === 'equipe'`), "dans le fil : le module montre les agents");
  await capture("3-fil");
  verifier(await ouvrirDepuisLeFil(), "l’atelier s’ouvre sur son équipe");
  verifier(await app.quand(`${atelier}.querySelectorAll('[data-membre]').length === 2`), "un agent par groupe, deux sur la table");
  const texte = await app.ev(`${atelier}.innerText`);
  verifier(texte.includes("Sans prénom") && texte.includes("2 attendent leur prénom"), "aucun prénom imposé : ils attendent le sien");
  verifier((await app.ev(`${principal("Créer l’équipe")}?.disabled`)) === true, "« Créer l’équipe » attend les prénoms");
  verifier((await app.ev(`${atelier}.querySelectorAll('[data-ligne-proposee]').length`)) === 1, "sa ligne proposée en pointillés, à garder ou retirer");
  verifier(texte.includes("Toi") && texte.includes("Écrire le post LinkedIn du lundi"), "ce qu’elle garde reste à elle, sur la table et dans « Qui s’en charge »");
  await app.cliquer("Léa", atelier);
  await app.cliquer("Garder", `${atelier}.querySelector('[data-ligne-proposee]')?.parentElement`);
  verifier(await surDisque(() => part("toolu_e1").choix?.prenoms?.redaction === "Léa" && part("toolu_e1").choix?.lignes?.redaction?.["Tutoie, comme toi dans tes mails"] === true), "prénom choisi et ligne gardée, notés sur la carte");
  await app.ev("document.activeElement?.blur(); 0");
  await app.touche("ArrowRight", "ArrowRight", 39);
  verifier(await app.quand(`${atelier}.querySelector('[data-membre="agenda"]')?.getAttribute('aria-pressed') === 'true'`), "→ passe à l’agent suivant");
  await app.saisir(`[data-atelier-equipe] input[aria-label^="Un autre prénom"]`, "Sacha");
  await app.ev(`document.querySelector('[data-atelier-equipe] input[aria-label^="Un autre prénom"]').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); 0`);
  verifier(await surDisque(() => part("toolu_e1").choix?.prenoms?.agenda === "Sacha"), "un prénom écrit à la main");
  verifier(await app.quand(`${principal("Créer l’équipe")}?.disabled === false`), "les prénoms choisis : « Créer l’équipe » s’allume");
  await capture("3-equipe");
  verifier(!existsSync(path.join(agents, "redaction.md")), "rien n’est écrit avant « Créer l’équipe »");
  await app.ev(`${principal("Créer l’équipe")}.click(); 0`);
  const ficheEcrite = (nom) => surDisque(() => /\n---\n[\s\S]*\n$/.test(readFileSync(path.join(agents, `${nom}.md`), "utf8")));
  verifier((await ficheEcrite("redaction")) && (await ficheEcrite("agenda")), "les deux fiches écrites dans le dossier de l’app");
  const lea = readFileSync(path.join(agents, "redaction.md"), "utf8");
  const sacha = readFileSync(path.join(agents, "agenda.md"), "utf8");
  verifier(/^displayName: Léa$/m.test(lea) && lea.includes("Tutoie, comme toi dans tes mails") && lea.includes("- Répondre aux mails des clients") && !/^memory:/m.test(lea), "Léa : son prénom, la ligne gardée, ses tâches pour « quand l’appeler », sans mémoire");
  verifier(/^displayName: Sacha$/m.test(sacha) && !sacha.includes("Aucun créneau en conflit") && sacha.includes("- Caler les rendez-vous avec les prospects"), "Sacha : la proposition laissée de côté n’entre pas dans sa fiche");
  verifier(!existsSync(path.join(poste, "redaction.md")), "rien n’est écrit sur le poste");
  verifier(await app.quand(`${atelier}.innerText.includes('Ton équipe est née')`), "« Ton équipe est née »");
  verifier(app.erreurs.length === 0, `temps 3 : aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
  await app.fermer();
  app = null;
} catch (e) {
  verifier(false, `exception : ${e instanceof Error ? e.stack : e}`);
} finally {
  if (app) await app.fermer().catch(() => undefined);
  rmSync(TMP, { recursive: true, force: true });
}
if (echecs.length) {
  console.error(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nAtelier d’une équipe en grand : tout est vérifié.");
