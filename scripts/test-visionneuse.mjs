/**
 * Visionneuse d'un projet, dans la vraie app : Markdown mis en forme (tableau,
 * liens, ancres, retour, bascule Source), CSV, xlsx, xls, docx, image, JSON,
 * code, PDF et binaire sans aperçu, liens piégés ou qui sortent du projet.
 * Profil, HOME et projet jetables ; aucun agent ne tourne.
 * Prérequis : pnpm build && pnpm build:electron.
 *   xvfb-run -a node scripts/test-visionneuse.mjs
 * KLYRA_CAPTURES=<dossier> : une capture de chaque vue (preuve visuelle).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-visionneuse-"));
const DONNEES = path.join(TMP, "donnees");
const MAISON = path.join(TMP, "maison");
const PROJET = path.join(TMP, "DIGITAL-OS");
const FIXTURES = path.join(import.meta.dirname, "fixtures", "apercu");
const CAPTURES = process.env.KLYRA_CAPTURES ? path.resolve(process.env.KLYRA_CAPTURES) : null;
const q = JSON.stringify;
const { echecs, verifier } = verificateur();

const ecrire = (relatif, contenu) => {
  mkdirSync(path.dirname(path.join(PROJET, relatif)), { recursive: true });
  writeFileSync(path.join(PROJET, relatif), contenu);
};

/* Un tableau de bord dans la forme de celui de DIGITAL-OS (contenu fictif). */
ecrire(
  "00_CONTROL/DASHBOARD.md",
  `# Tableau de bord

Généré le 2026-10-30. Voir [les règles](FILING-RULES.md#nommage) et [la suite](#actifs-et-en-revue).

## Clients

| Client | Statut | Projets en cours |
|:---|:---:|---:|
| [CL-0001 — ACCLARO](../30_CLIENTS/CL-0001-acclaro/CLIENT.md) | **active** | 1 |
| [CL-0002 — Air Cloud](../30_CLIENTS/CL-0002-air-cloud/CLIENT.md) | active | 9 |
| CL-0013 — Fictif | ~~closed~~ | 0 |

- [CL-0001 — ACCLARO](../30_CLIENTS/CL-0001-acclaro/CLIENT.md) — active ; 1 projet(s) en cours
- [x] Index reconstruit
- [ ] Revue à faire

> [!NOTE]
> Les fiches locales font foi.

Site : [klyra.fr](https://klyra.fr) · contact : <corentin@example.test>

Pièges : [Sortir](../../secret-hors-projet.md) [script](javascript:window.__piege=1) [données](data:text/html;base64,PHNjcmlwdD4=) [disque](file:///etc/passwd)<script>window.__piege=2</script><img src=x onerror="window.__piege=3">

![Logo](../assets/logo.png)

\`\`\`bash
pnpm index
\`\`\`

${Array.from({ length: 60 }, (_, i) => `Ligne de remplissage ${i + 1}.`).join("\n\n")}

## Actifs et en revue

- [PRJ-2026-001 — Site](../30_CLIENTS/CL-0001-acclaro/CLIENT.md#projets) — active

${Array.from({ length: 40 }, (_, i) => `Suite ${i + 1}.`).join("\n\n")}
`,
);
ecrire("00_CONTROL/FILING-RULES.md", "# Règles\n\n## Nommage\n\nTexte.\n");
ecrire("30_CLIENTS/CL-0001-acclaro/CLIENT.md", "# ACCLARO\n\nRetour au [tableau de bord](../../00_CONTROL/DASHBOARD.md).\n\n## Projets\n\n- PRJ-2026-001\n");
ecrire("00_CONTROL/CLIENT-INDEX.csv", "﻿client_id,name,status,project_count\r\nCL-0001,ACCLARO,active,1\r\nCL-0002,\"Air Cloud, filiale\",active,9\r\n");
ecrire("assets/logo.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
ecrire("docs/classeur.xlsx", readFileSync(path.join(FIXTURES, "classeur.xlsx")));
ecrire("docs/ancien.xls", readFileSync(path.join(FIXTURES, "ancien.xls")));
ecrire("docs/compte-rendu.docx", readFileSync(path.join(FIXTURES, "compte-rendu.docx")));
ecrire("docs/rapport.pdf", "%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");
ecrire("docs/police.woff2", Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0]));
ecrire("src/app.ts", "export const a = 1;\nexport const b = 2;\n");
ecrire("config.json", JSON.stringify({ nom: "klyra", valeurs: Array.from({ length: 30 }, (_, i) => ({ id: i, actif: i % 2 === 0 })) }));
writeFileSync(path.join(TMP, "secret-hors-projet.md"), "SECRET HORS PROJET");

const date = "2026-10-30T13:32:00Z";
mkdirSync(DONNEES, { recursive: true });
mkdirSync(path.join(MAISON, ".claude", "agents"), { recursive: true });
writeFileSync(
  path.join(DONNEES, "conversations.json"),
  q({
    version: 1,
    currentUser: { id: "moi", name: "Essai", title: "KLYRA", initial: "E" },
    chats: [],
    messages: [],
    projects: [{ id: "digital-os", name: "DIGITAL-OS", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder: PROJET, files: [], updatedAt: date }],
    taches: [],
    routines: [],
    evenements: [],
    workflows: [],
    executions: [],
    artefacts: [],
    categories: [],
  }),
);
writeFileSync(path.join(DONNEES, "mes-agents.json"), q({ version: 1, depart: "reprise", assistant: { nom: "Principal", teinte: null }, agents: {} }));

const app = await lancerApp({ env: { HOME: MAISON, KLYRA_USER_DATA: DONNEES, PATH: "/usr/bin:/bin" }, port: 9361 });
const V = '[role="dialog"][aria-label]';
const vue = (selecteur) => `document.querySelector(${q(V)})?.querySelector(${q(selecteur)})`;
const tous = (selecteur) => `[...(document.querySelector(${q(V)})?.querySelectorAll(${q(selecteur)}) ?? [])]`;
const titreVisionneuse = () => app.ev(`document.querySelector(${q(V)})?.getAttribute('aria-label') ?? null`);
let numero = 0;
async function capture(nom) {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await attendre(300);
  const { data } = await app.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(CAPTURES, `${String(++numero).padStart(2, "0")}-${nom}.png`), Buffer.from(data, "base64"));
}
async function ouvrir(chemin) {
  await app.ev(`window.dispatchEvent(new CustomEvent("klyra:fichier", { detail: { projectId: "digital-os", chemin: ${q(chemin)} } }))`);
  return app.quand(`document.querySelector(${q(V)})?.getAttribute('aria-label') === ${q(path.basename(chemin))} && !document.querySelector(${q(V)}).innerText.includes("Lecture…")`);
}

try {
  await app.aller("/projet?id=digital-os");

  /* ─── Markdown, ouvert depuis l'arbre comme le ferait Corentin ─── */
  verifier(await app.quand(`[...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "00_CONTROL")`), "l’arbre du projet s’affiche");
  await app.cliquer("00_CONTROL");
  await app.quand(`[...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "DASHBOARD.md")`);
  await app.cliquer("DASHBOARD.md");
  verifier(await app.quand(`${vue('[data-vue="apercu"] h1')}?.innerText === "Tableau de bord"`), "DASHBOARD.md s’ouvre en aperçu formaté (titre h1)");
  const tableau = await app.ev(`(() => { const t = ${vue('[data-vue="apercu"] table')}; return t && { entete: [...t.querySelectorAll("th")].map((c) => c.innerText.trim()), lignes: t.querySelectorAll("tbody tr").length, alignDroite: getComputedStyle(t.querySelector("tbody td:nth-child(3)")).textAlign, liens: t.querySelectorAll('a[data-lien="fichier"]').length, barre: !!t.querySelector("del") }; })()`);
  verifier(tableau?.entete.join("|") === "Client|Statut|Projets en cours" && tableau.lignes === 3, `le tableau GFM est un vrai tableau (${q(tableau)})`);
  verifier(tableau?.alignDroite === "right" && tableau.liens === 2 && tableau.barre, "alignements, liens et barré dans les cellules");
  verifier(!(await app.ev(`${vue('[data-vue="apercu"]')}.innerText.includes("|---")`)), "aucune ligne de tirets du tableau ne reste à l’écran");
  verifier(await app.ev(`${tous('[data-vue="apercu"] li')}.some((li) => li.innerText.includes("Index reconstruit") && li.querySelector("svg"))`), "case cochée : le check KLYRA");
  verifier(await app.ev(`${vue('[role="note"]')}?.innerText.startsWith("Note")`), "alerte [!NOTE] en encadré");
  verifier(await app.quand(`${vue('[data-vue="apercu"] img[alt="Logo"]')}?.src.startsWith("data:image/png")`), "image relative du projet affichée");
  verifier(await app.ev(`${vue('[data-vue="apercu"] pre')}?.innerText.includes("pnpm index")`), "bloc de code");
  await capture("markdown-apercu");

  /* ─── Liens piégés : du texte, rien d'exécuté ─── */
  const ignores = await app.ev(`${tous("[data-lien-ignore]")}.map((e) => e.innerText)`);
  verifier(q(ignores) === q(["Sortir", "script", "données", "disque"]), `liens hors projet, javascript:, data:, file: ignorés (${q(ignores)})`);
  verifier(await app.ev(`${tous("[data-lien-ignore]")}.every((e) => !e.closest("a"))`), "un lien ignoré n’est pas un lien");
  verifier(await app.ev(`window.__piege === undefined && !${vue('[data-vue="apercu"] script')} && !${vue('[data-vue="apercu"] img[onerror]')} && !${vue('[data-vue="apercu"]')}.innerHTML.includes("onerror")`), "HTML brut nettoyé : ni script ni gestionnaire exécuté");
  await app.ev(`window.__ouverts = []; window.open = (url) => { window.__ouverts.push(url); return null; }`);
  const adresse = await app.ev("location.href");
  await app.ev(`${tous("[data-lien-ignore]")}[0].click()`);
  await attendre(300);
  verifier((await titreVisionneuse()) === "DASHBOARD.md" && q(await app.ev("window.__ouverts")) === "[]", "clic sur « Sortir » : rien ne s’ouvre, on reste sur le document");
  const garde = await app.ev(`window.klyra.projets.lireFichier(${q(PROJET)}, "../secret-hors-projet.md")`);
  verifier(garde?.ok === false && /pas dans le projet/.test(garde.message), "le process principal refuse aussi le chemin hors du projet");

  /* ─── Liens externes : hors de l'app ─── */
  await app.ev(`${tous('a[data-lien="externe"]')}.find((a) => a.innerText === "klyra.fr").click()`);
  await app.ev(`${tous('a[data-lien="externe"]')}.find((a) => a.innerText.includes("corentin@")).click()`);
  await attendre(300);
  verifier(q(await app.ev("window.__ouverts")) === q(["https://klyra.fr/", "mailto:corentin@example.test"]), "http(s) et mailto s’ouvrent hors de l’app");
  verifier((await app.ev("location.href")) === adresse && (await titreVisionneuse()) === "DASHBOARD.md", "la page de l’app n’a pas bougé");

  /* ─── Ancre dans le document ─── */
  await app.ev(`${tous("a")}.find((a) => a.innerText === "la suite").click()`);
  await attendre(400);
  const ecart = await app.ev(`(() => { const h = ${vue('[data-ancre="actifs-et-en-revue"]')}; const c = h.closest(".overflow-auto"); return Math.round(h.getBoundingClientRect().top - c.getBoundingClientRect().top); })()`);
  verifier(Math.abs(ecart) < 40, `lien #ancre : le titre vient en haut (écart ${ecart} px)`);

  /* ─── Lien relatif vers un autre fichier du projet, puis retour ─── */
  await app.ev(`${tous('table a[data-lien="fichier"]')}[0].click()`);
  verifier(await app.quand(`${vue('[data-vue="apercu"] h1')}?.innerText === "ACCLARO"`), "lien relatif : CLIENT.md s’ouvre dans la visionneuse");
  verifier((await titreVisionneuse()) === "CLIENT.md", "en-tête : CLIENT.md");
  await capture("markdown-lien-suivi");
  verifier(await app.ev(`!!${vue('button[aria-label="Revenir à DASHBOARD.md"]')}`), "bouton « Revenir à DASHBOARD.md »");
  await app.ev(`${vue('button[aria-label="Revenir à DASHBOARD.md"]')}.click()`);
  verifier(await app.quand(`${vue('[data-vue="apercu"] h1')}?.innerText === "Tableau de bord"`), "retour au tableau de bord");
  await app.ev(`${tous("a")}.find((a) => a.innerText === "les règles").click()`);
  verifier(await app.quand(`${vue('[data-vue="apercu"] h1')}?.innerText === "Règles"`), "lien fichier.md#ancre : FILING-RULES.md s’ouvre");

  /* ─── Bascule Aperçu / Source ─── */
  await ouvrir("00_CONTROL/DASHBOARD.md");
  await app.cliquer("Source", `document.querySelector(${q(V)})`);
  const source = await app.ev(`(() => { const t = ${vue('[data-vue="source"]')}; return t && { premiere: t.querySelector("tr td:nth-child(2)").innerText, numero: t.querySelector("tr td").innerText, lignes: t.querySelectorAll("tr").length }; })()`);
  verifier(source?.premiere === "# Tableau de bord" && source.numero === "1" && source.lignes > 100, `Source : la vue numérotée d’avant (${q(source)})`);
  await capture("markdown-source");
  await app.cliquer("Aperçu", `document.querySelector(${q(V)})`);
  verifier(await app.quand(`!!${vue('[data-vue="apercu"] table')}`), "retour à l’aperçu");

  /* ─── CSV ─── */
  verifier(await ouvrir("00_CONTROL/CLIENT-INDEX.csv"), "CLIENT-INDEX.csv s’ouvre");
  const csv = await app.ev(`(() => { const g = ${vue("[data-grille]")}; return g && { entete: [...g.querySelectorAll("thead th")].map((c) => c.innerText.trim()), lignes: [...g.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.innerText)) }; })()`);
  verifier(csv?.entete.join("|") === "|client_id|name|status|project_count", `CSV : en-tête reconnu, sans BOM (${q(csv?.entete)})`);
  verifier(csv?.lignes.length === 2 && csv.lignes[1][1] === "Air Cloud, filiale", "CSV : champs entre guillemets");
  await capture("csv");

  /* ─── xlsx : feuilles visibles et onglets ─── */
  verifier(await ouvrir("docs/classeur.xlsx"), "classeur.xlsx s’ouvre");
  const onglets = await app.ev(`${tous('[role="tablist"][aria-label="Feuilles du classeur"] [role="tab"]')}.map((o) => o.innerText.trim())`);
  verifier(q(onglets) === q(["Clients", "Feuille 2 — été"]), `onglets des feuilles visibles (${q(onglets)})`);
  const cellules = await app.ev(`${tous("[data-grille] td")}.map((c) => c.innerText.replace(/[\\u00a0\\u202f]/g, " "))`);
  verifier(["ACCLARO", "20/09/2026", "12,5 %", "1 234,50"].every((v) => cellules.includes(v)), "xlsx : textes, dates, pourcentages, montants");
  verifier(await app.ev(`${tous("[data-grille] thead th")}.map((c) => c.innerText).slice(1, 4).join("") === "ABC"`), "colonnes A, B, C");
  await capture("xlsx");
  await app.cliquer("Feuille 2 — été", `document.querySelector(${q(V)})`);
  verifier(await app.quand(`${tous("[data-grille] td")}.some((c) => c.innerText === "Deuxième feuille")`), "on passe d’une feuille à l’autre");

  /* ─── xls ─── */
  verifier(await ouvrir("docs/ancien.xls"), "ancien.xls s’ouvre");
  verifier(await app.quand(`${tous("[data-grille] td")}.some((c) => c.innerText === "Œuvre — 日本")`), "xls : grille lue (accents, UTF-16)");
  await capture("xls");

  /* ─── docx ─── */
  verifier(await ouvrir("docs/compte-rendu.docx"), "compte-rendu.docx s’ouvre");
  verifier(await app.quand(`${vue('[data-vue="apercu"] h1')}?.innerText === "Contexte"`), "docx : titres");
  verifier(await app.ev(`${tous('a[data-lien="externe"]')}.some((a) => a.innerText === "lien externe") && !${tous("a")}.some((a) => a.innerText === "ne pas suivre")`), "docx : lien externe gardé, lien javascript: retiré");
  verifier(await app.ev(`!!${vue('[data-vue="apercu"] table')}`), "docx : tableau");
  await capture("docx");

  /* ─── Image : inchangée ─── */
  verifier(await ouvrir("assets/logo.png"), "logo.png s’ouvre");
  verifier(await app.quand(`${vue('img[alt="logo.png"]')}?.src.startsWith("data:image/png") && document.querySelector(${q(V)}).innerText.includes("1 × 1 px")`), "image : affichée avec ses dimensions");

  /* ─── Code, JSON ─── */
  verifier(await ouvrir("src/app.ts"), "app.ts s’ouvre");
  verifier(await app.ev(`!!${vue('[data-vue="source"]')} && !${vue('[aria-label="Affichage du fichier"]')}`), "code : numéros de ligne, pas de bascule");
  verifier(await ouvrir("config.json"), "config.json s’ouvre");
  const json = await app.ev(`${tous('[data-vue="source"] tr')}.length`);
  await app.cliquer("Source", `document.querySelector(${q(V)})`);
  const jsonSource = await app.ev(`${tous('[data-vue="source"] tr')}.length`);
  verifier(json > 30 && jsonSource === 1, `JSON minifié : indenté (${json} lignes), source d’une ligne (${jsonSource})`);

  /* ─── Sans aperçu ─── */
  for (const fichier of ["docs/rapport.pdf", "docs/police.woff2"]) {
    verifier(await ouvrir(fichier), `${fichier} s’ouvre`);
    verifier(await app.ev(`document.querySelector(${q(V)}).innerText.includes("Pas d’aperçu pour ce type de fichier.") && ${tous("button")}.filter((b) => b.innerText === "Ouvrir avec l’app par défaut").length === 2`), `${path.basename(fichier)} : pas d’aperçu, « Ouvrir avec l’app par défaut »`);
  }
  await capture("sans-apercu");

  verifier(!app.erreurs.length, `aucune exception dans la page${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
} finally {
  await app.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s)` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
