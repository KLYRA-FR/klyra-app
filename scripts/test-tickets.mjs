/**
 * La page Tickets dans l'export Electron, sur un profil jetable : aucun agent ne
 * tourne, Claude reste hors d'atteinte. Vérifie :
 * - chaque fil dans sa colonne, y compris un fil d'avant les tickets (à valider)
 *   et un fil resté « en cours » à la fermeture (bloqué, réponse interrompue) ;
 * - la raison de blocage, la progression TodoWrite, le nombre « à valider » du rail ;
 * - « À moi » montre les rappels de ce poste ;
 * - Terminé : les 7 derniers jours, puis tous sur demande ;
 * - « Valider et fermer » range le fil dans Terminé et l'écrit sur le disque, avec sa date ;
 * - « Remettre à faire », dans les réglages d'une carte, la ramène dans À faire ;
 * - « Confier à un agent » ouvre un fil avec le rappel pour brief, marque le rappel
 *   « Confié à … », met une pastille sur l'onglet du fil bloqué, et fermer le fil coche le rappel ;
 * - le planning des agents liste les tickets ouverts.
 * Prérequis : pnpm build && pnpm build:electron.
 *   xvfb-run -a node scripts/test-tickets.mjs          (sous Linux sans bac à sable : -- --no-sandbox)
 * KLYRA_CAPTURE=chemin.png enregistre une capture de la page.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const fixes = ["/usr/local/bin/claude", "/opt/homebrew/bin/claude", "/usr/bin/claude", "/bin/claude"].filter(existsSync);
if (fixes.length) throw new Error(`Test refusé : Claude reste accessible à ${fixes.join(", ")}`);

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-tickets-"));
const DONNEES = path.join(TMP, "userdata");
const MAISON = path.join(TMP, "home");
const FICHIER = path.join(DONNEES, "conversations.json");
const PLANNING = path.join(MAISON, ".klyra", "planning", "planning.md");
for (const d of [DONNEES, MAISON, path.join(TMP, "durand")]) mkdirSync(d, { recursive: true });

const il = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString();
const jour = (decalage) => {
  const d = new Date(Date.now() + decalage * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fil = (id, titre, f, autre = {}) => ({
  id,
  kind: "direct",
  projectId: null,
  title: titre,
  roleIds: [f.roleId ?? "principal"],
  updatedAt: il(1),
  sessions: {},
  luJusqua: null,
  ...autre,
  fil: { roleId: "principal", statut: "ouvert", creeLe: il(3), lancePar: null, ...f },
});
const reponse = (chatId) => ({ id: `r-${chatId}`, chatId, author: { kind: "role", roleId: "principal" }, createdAt: il(1), statut: "fait", parts: [{ type: "text", text: "Fait." }] });

writeFileSync(
  FICHIER,
  JSON.stringify({
    version: 1,
    chats: [
      { id: "dm-principal", kind: "direct", projectId: null, title: "Principal", roleIds: ["principal"], updatedAt: il(1), sessions: {}, luJusqua: null },
      fil("klyra-fil-ancien01", "Fil d’avant les tickets", {}),
      fil("klyra-fil-afaire01", "Préparer le brief Durand", { etape: "a-faire" }),
      fil("klyra-fil-bloque01", "Maquette de l’accueil", { etape: "bloque", raison: "attend l’accès Figma", priorite: 2, echeance: jour(-1), projetId: "durand", lancePar: { roleId: "principal", chatId: "dm-principal" } }),
      fil("klyra-fil-valide01", "Rapport hebdo", { etape: "a-valider" }, {
        taches: [
          { texte: "Lire les chiffres", statut: "fait" },
          { texte: "Écrire", statut: "fait" },
          { texte: "Relire", statut: "fait" },
          { texte: "Mettre en page", statut: "en-cours" },
          { texte: "Envoyer", statut: "a-faire" },
        ],
      }),
      fil("klyra-fil-coupe01", "Réponse coupée", { etape: "en-cours" }),
      fil("klyra-fil-ferme01", "Fil fermé hier", { statut: "archive", etape: "a-valider", fermeLe: il(1) }),
      fil("klyra-fil-vieux01", "Fil fermé il y a longtemps", { statut: "archive", etape: "a-valider", fermeLe: il(20) }),
    ],
    messages: [reponse("klyra-fil-ancien01"), reponse("klyra-fil-valide01")],
    projects: [{ id: "durand", name: "Atelier Durand", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "Projet fictif", previewUrl: "", folder: path.join(TMP, "durand"), files: [], updatedAt: il(2) }],
    routines: [],
    taches: [{ id: "rappel-1", titre: "Relancer le devis", notes: "", liste: "perso", date: jour(0), heure: null, fin: null, priorite: 1, signalee: false, faite: false, faiteLe: null, projectId: null, creeLe: il(2), notifiee: false }],
    evenements: [],
    categories: [{ id: "perso", nom: "Perso", teinte: "bleu-k2", icone: "home-01" }],
    artefacts: [],
    workflows: [],
    executions: [],
  }),
);
writeFileSync(path.join(DONNEES, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Principal", teinte: null }, agents: {} }));

const env = { HOME: MAISON, KLYRA_USER_DATA: DONNEES, PATH: "/usr/bin:/bin", TZ: "Europe/Paris", DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(TMP, "aucun-bus")}` };
const app = await lancerApp({ env, port: 9361 });
try {
  await app.aller("/tickets");
  verifier(await app.quand("document.querySelector('section[aria-label=\"À valider\"]')"), "la page Tickets s’ouvre");
  const colonne = (titre) => app.ev(`document.querySelector('section[aria-label=${JSON.stringify(titre)}]')?.innerText ?? ''`);

  const aFaire = await colonne("À faire");
  verifier(aFaire.includes("Préparer le brief Durand"), "À faire : le fil créé sans message");
  const bloque = await colonne("Bloqué");
  verifier(bloque.includes("Maquette de l’accueil") && bloque.includes("attend l’accès Figma"), "Bloqué : le fil et sa raison");
  verifier(bloque.includes("Atelier Durand") && bloque.includes("Hier") && bloque.includes("lancé par"), "Bloqué : projet, échéance dépassée, lanceur");
  verifier(bloque.includes("Réponse coupée") && bloque.includes("Réponse interrompue"), "un fil resté « en cours » à la fermeture passe bloqué");
  const aValider = await colonne("À valider");
  verifier(aValider.includes("Rapport hebdo") && aValider.includes("3/5"), "À valider : le fil et sa progression TodoWrite");
  verifier(aValider.includes("Fil d’avant les tickets"), "un fil d’avant les tickets, déjà répondu, arrive à valider");
  verifier(!(await colonne("En cours")).includes("Rapport"), "En cours : vide sans agent au travail");
  // Le titre d'un rappel est dans son champ (on le modifie sur place) : on lit les valeurs.
  const aMoi = await app.ev(`[...document.querySelectorAll('section[aria-label="À moi"] textarea')].map((t) => t.value).join("\\n")`);
  verifier(aMoi.includes("Relancer le devis"), "À moi : le rappel de ce poste");
  const rail = await app.ev(`document.querySelector('nav[aria-label="Navigation principale"] a[href="/tickets"]')?.innerText ?? ''`);
  verifier(/2\s*à valider/.test(rail), `le rail compte 2 tickets à valider (${JSON.stringify(rail)})`);

  let termine = await colonne("Terminé");
  verifier(termine.includes("Fil fermé hier") && !termine.includes("il y a longtemps"), "Terminé : les 7 derniers jours seulement");
  verifier(await app.cliquer("Tous les fils fermés (2)"), "Terminé : le lien vers tous les fils fermés");
  await attendre(300);
  verifier((await colonne("Terminé")).includes("il y a longtemps"), "Terminé : tous les fils fermés sur demande");

  if (process.env.KLYRA_CAPTURE) {
    const { data } = await app.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.env.KLYRA_CAPTURE, Buffer.from(data, "base64"));
  }

  verifier(await app.cliquer("Valider et fermer", "document.querySelector('[data-ticket=\"klyra-fil-valide01\"]')"), "« Valider et fermer » sur le rapport hebdo");
  await attendre(300);
  termine = await colonne("Terminé");
  verifier(termine.includes("Rapport hebdo") && !(await colonne("À valider")).includes("Rapport hebdo"), "le rapport passe dans Terminé");
  const reglages = `document.querySelector('[aria-label="Réglages du ticket Maquette de l’accueil"]')`;
  verifier(await app.ev(`(() => { const b = ${reglages}; if (!b) return false; b.click(); return true; })()`), "le « … » d’une carte déplie ses réglages");
  await attendre(200);
  verifier(await app.cliquer("Remettre à faire", "document.querySelector('[data-ticket=\"klyra-fil-bloque01\"]')"), "« Remettre à faire » sur la maquette bloquée");
  await attendre(300);
  verifier((await colonne("À faire")).includes("Maquette de l’accueil") && !(await colonne("Bloqué")).includes("Maquette"), "la maquette revient dans À faire, sans sa raison");
  let ecrit = null;
  for (let i = 0; i < 20 && !ecrit; i++) {
    await attendre(250);
    const f = JSON.parse(readFileSync(FICHIER, "utf8")).chats.find((c) => c.id === "klyra-fil-valide01")?.fil;
    if (f?.statut === "archive") ecrit = f;
  }
  verifier(!!ecrit?.fermeLe && Date.now() - Date.parse(ecrit.fermeLe) < 60_000, "fermé sur le disque, avec sa date de fermeture");
  const surDisque = JSON.parse(readFileSync(FICHIER, "utf8")).chats.find((c) => c.id === "klyra-fil-ancien01")?.fil;
  verifier(surDisque?.etape === "a-valider", "l’étape donnée au chargement est écrite");

  /* Confier le rappel : Claude est hors d'atteinte, la réponse finit en erreur et le fil passe bloqué. */
  verifier(await app.ev(`(() => { const b = document.querySelector('section[aria-label="À moi"] [data-confier="rappel-1"]'); if (!b) return false; b.click(); return true; })()`), "le bouton « Confier à un agent » du rappel");
  verifier(await app.quand(`document.querySelector('[role="menu"][aria-label^="Confier"] [role="menuitem"]')`), "le menu liste Mes agents");
  verifier(await app.cliquer("Principal", `document.querySelector('[role="menu"][aria-label^="Confier"]')`), "confié à Principal");
  let filConfie = null;
  for (let i = 0; i < 20 && !filConfie; i++) {
    await attendre(250);
    filConfie = JSON.parse(readFileSync(FICHIER, "utf8")).chats.find((c) => c.fil?.rappel?.id === "rappel-1") ?? null;
  }
  verifier(filConfie?.title === "Relancer le devis" && filConfie.fil.rappel.source === "local" && filConfie.fil.priorite === 1 && !filConfie.fil.lancePar, "un fil s’ouvre, au titre et à la priorité du rappel, lancé par toi");
  const brief = JSON.parse(readFileSync(FICHIER, "utf8")).messages.find((m) => m.chatId === filConfie?.id && m.author.kind === "user");
  verifier(!!brief && JSON.stringify(brief.parts).includes("Je te confie ce rappel : « Relancer le devis »"), "le brief du fil reprend le rappel");
  verifier(await app.quand(`document.querySelector('section[aria-label="À moi"] [data-confie="rappel-1"]')?.innerText === "Confié à Principal"`), "le rappel est marqué « Confié à Principal »");
  verifier(await app.quand(`!document.querySelector('section[aria-label="À moi"] [data-confier="rappel-1"]')`), "un rappel confié n’a plus le bouton");
  verifier(await app.quand(`[...document.querySelectorAll('section[aria-label="Bloqué"] [data-ticket]')].some((c) => c.innerText.includes("Relancer le devis"))`, 20000), "sans Claude, le fil du rappel passe bloqué");

  await app.aller(`/chat?id=${filConfie.id}`);
  verifier(await app.quand(`document.querySelector('[role="tablist"][aria-label="Chat et fils"] [aria-label="Bloqué"]')`), "l’onglet du fil bloqué porte sa pastille");
  verifier(await app.quand(`document.querySelector('[role="tablist"][aria-label="Chat et fils"] [aria-label="À valider"]')`), "l’onglet d’un fil à valider porte la sienne");
  verifier(await app.ev(`(() => { const b = document.querySelector('[aria-label="Fermer le fil Relancer le devis"]'); if (!b) return false; b.click(); return true; })()`), "fermer l’onglet du fil");
  let coche = false;
  for (let i = 0; i < 20 && !coche; i++) {
    await attendre(250);
    coche = JSON.parse(readFileSync(FICHIER, "utf8")).taches.find((r) => r.id === "rappel-1")?.faite === true;
  }
  verifier(coche, "fermer le fil coche le rappel");

  // Le planning se réécrit une seconde après le dernier changement.
  let planning = "";
  for (let i = 0; i < 24 && !(planning.includes("Tickets ouverts") && !planning.includes("Rapport hebdo (klyra-fil-valide01)")); i++) {
    await attendre(250);
    planning = existsSync(PLANNING) ? readFileSync(PLANNING, "utf8") : "";
  }
  verifier(planning.includes("## Tickets ouverts") && planning.includes("Maquette de l’accueil (klyra-fil-bloque01) · Principal · à faire"), "planning.md liste les tickets ouverts");
  verifier(!planning.includes("Rapport hebdo (klyra-fil-valide01)"), "planning.md : le fil fermé n’y est plus");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
} finally {
  await app.fermer();
  rmSync(TMP, { recursive: true, force: true });
}
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nTickets : tout est bon.");
