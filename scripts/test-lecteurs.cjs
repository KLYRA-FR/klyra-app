/**
 * Visionneuse : lecture des classeurs (xlsx, xls) et documents Word (docx) sur
 * l'ordinateur, et `lireFichier` (types, plafonds, chemin confiné au projet).
 * Node seul, sans Electron :
 *   pnpm build:electron && node scripts/test-lecteurs.cjs
 * Fichiers d'essai dans scripts/fixtures/apercu/, faits par openpyxl (xlsx),
 * xlwt (xls, BIFF8) et python-docx (docx) : des fichiers écrits par d'autres
 * outils que ces lecteurs.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script Node en CommonJS */
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { deflateRawSync } = require("node:zlib");
const { lireXlsx } = require("../dist-electron/apercu/xlsx.js");
const { lireXls } = require("../dist-electron/apercu/xls.js");
const { lireDocx } = require("../dist-electron/apercu/docx.js");
const { formaterNombre } = require("../dist-electron/apercu/classeur.js");
const { ErreurApercu } = require("../dist-electron/apercu/zip.js");
const { arbreDossier, lireFichier } = require("../dist-electron/projets.js");

const FIXTURES = path.join(__dirname, "fixtures", "apercu");
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
/** Les espaces insécables du français deviennent des espaces simples, pour comparer. */
const t = (cellule) => (cellule ? cellule.texte.replace(/[  ]/g, " ") : null);
const refuse = (fn, motif) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof ErreurApercu && (!motif || motif.test(e.message));
  }
};

/* ─── xlsx ─── */
const xlsx = lireXlsx(readFileSync(path.join(FIXTURES, "classeur.xlsx")));
verifier(xlsx.map((f) => f.nom).join("|") === "Clients|Feuille 2 — été", `xlsx : feuilles visibles seulement (${xlsx.map((f) => f.nom).join(", ")})`);
const [clients, deuxieme] = xlsx;
verifier(t(clients.lignes[0][0]) === "Client" && t(clients.lignes[0][5]) === "Montant", "xlsx : en-têtes (chaînes partagées)");
verifier(t(clients.lignes[1][3]) === "20/09/2026" && clients.lignes[1][3].nombre === true, "xlsx : date au format jj/mm/aaaa, alignée comme un nombre");
verifier(t(clients.lignes[1][4]) === "12,5 %" && t(clients.lignes[2][4]) === "30,0 %", "xlsx : pourcentages 0.0%");
verifier(t(clients.lignes[1][5]) === "1 234,50", `xlsx : #,##0.00 → ${t(clients.lignes[1][5])}`);
verifier(t(clients.lignes[1][2]) === "1" && clients.lignes[3][2] === null, "xlsx : entier, formule sans résultat enregistré laissée vide");
verifier(clients.lignes.length === 6 && clients.lignes[4].every((c) => c === null) && t(clients.lignes[5][0]) === "Ligne après un vide", "xlsx : ligne vide gardée à sa place");
verifier(t(deuxieme.lignes[1][1]) === "Deuxième feuille" && t(deuxieme.lignes[2][2]) === "VRAI" && deuxieme.lignes[0].every((c) => c === null), "xlsx : deuxième feuille, booléen, cellules à partir de B2");

/* ─── xls (BIFF8) ─── */
const xls = lireXls(readFileSync(path.join(FIXTURES, "ancien.xls")));
verifier(xls.map((f) => f.nom).join("|") === "Devis|Notes", "xls : deux feuilles");
const devis = xls[0];
verifier(t(devis.lignes[0][1]) === "Quantité" && t(devis.lignes[2][0]) === "Œuvre — 日本", "xls : chaînes partagées (accents, UTF-16)");
verifier(t(devis.lignes[1][1]) === "3" && t(devis.lignes[1][2]) === "42,5" && t(devis.lignes[2][2]) === "1234567,25", "xls : nombres (RK, NUMBER)");
verifier(t(devis.lignes[3][1]) === "31/10/2026" && t(devis.lignes[3][2]) === "VRAI", "xls : date et booléen");
// ~40 Ko de chaînes UTF-16 : la table SST (8 Ko par enregistrement) continue sur des CONTINUE, chaînes coupées comprises.
verifier(
  xls[1].lignes.length === 300 && xls[1].lignes.every((l, i) => t(l[0]) === `Note ${i + 1} — un texte assez long pour remplir plusieurs enregistrements`),
  "xls : 300 chaînes longues, table SST sur plusieurs enregistrements CONTINUE",
);

/* ─── docx ─── */
const docx = lireDocx(readFileSync(path.join(FIXTURES, "compte-rendu.docx")));
const types = docx.map((b) => b.type).join(",");
verifier(types === "paragraphe,titre,paragraphe,paragraphe,titre,liste,liste,liste,liste,tableau", `docx : blocs (${types})`);
verifier(docx[0].style === "titre" && docx[1].niveau === 1 && docx[4].niveau === 2, "docx : titre du document, titres 1 et 2");
const phrase = docx[2].morceaux;
verifier(phrase.some((m) => m.texte === "gras" && m.gras) && phrase.some((m) => m.texte === "italique" && m.italique), "docx : gras et italique");
verifier(phrase.some((m) => m.texte === "lien externe" && m.lien === "https://klyra.fr"), "docx : lien externe gardé");
verifier(docx[3].morceaux.every((m) => !m.lien), "docx : lien javascript: retiré, son texte reste");
verifier(docx[5].marque === null && docx[7].marque === "1." && docx[8].marque === "2.", "docx : puces et numéros");
verifier(docx[9].lignes.length === 2 && docx[9].lignes[1][2].morceaux[0].texte === "42 €", "docx : tableau");

/* ─── Formats de nombre ─── */
verifier(formaterNombre(0.1 + 0.2, null) === "0,3", "nombre standard sans bruit de virgule flottante");
verifier(formaterNombre(1.5, "[h]:mm:ss") === "36:00:00", "durée [h]:mm:ss");
verifier(formaterNombre(0, "dd/mm/yyyy", true) === "01/01/1904", "calendrier 1904");
verifier(formaterNombre(45961.5, "dd/mm/yyyy hh:mm") === "31/10/2025 12:00", "date et heure");
verifier(formaterNombre(1234.5, '#,##0.00 "€"').replace(/[  ]/g, " ") === "1 234,50 €", "monnaie");
verifier(formaterNombre(42, "General") === "42" && formaterNombre(42, "Standard") === "42", "format standard (anglais ou français)");

/* ─── Fichiers abîmés : un refus clair, jamais une exception brute ─── */
verifier(refuse(() => lireXlsx(Buffer.from("pas un zip"))), "octets quelconques en .xlsx → refus");
verifier(refuse(() => lireDocx(readFileSync(path.join(FIXTURES, "compte-rendu.docx")).subarray(0, 4000))), "docx tronqué → refus");
verifier(refuse(() => lireXls(readFileSync(path.join(FIXTURES, "ancien.xls")).subarray(0, 3000))), "xls tronqué → refus");
verifier(refuse(() => lireXls(Buffer.alloc(2048))), "xls vide → refus");

/** Une archive zip d'une seule entrée, dont l'en-tête peut mentir sur la taille. */
function zip(nom, contenu, tailleAnnoncee) {
  const donnees = deflateRawSync(contenu);
  const n = Buffer.from(nom);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(donnees.length, 18);
  local.writeUInt32LE(tailleAnnoncee ?? contenu.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(donnees.length, 20);
  central.writeUInt32LE(tailleAnnoncee ?? contenu.length, 24);
  central.writeUInt16LE(n.length, 28);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(46 + n.length, 12);
  fin.writeUInt32LE(30 + n.length + donnees.length, 16);
  return Buffer.concat([local, n, donnees, central, n, fin]);
}
// 64 Mo de zéros (quelques dizaines de Ko compressés), annoncés comme 1 Ko : la décompression s'arrête au plafond.
const bombe = zip("xl/workbook.xml", Buffer.alloc(64 * 1024 * 1024), 1024);
verifier(bombe.length < 200 * 1024 && refuse(() => lireXlsx(bombe), /lourd|abîmé/), `bombe zip (${Math.round(bombe.length / 1024)} Ko) → refus au plafond`);

/* ─── lireFichier : ce que la visionneuse reçoit ─── */
(async () => {
  const projet = mkdtempSync(path.join(os.tmpdir(), "klyra-lecteurs-"));
  try {
    mkdirSync(path.join(projet, "docs"));
    writeFileSync(path.join(projet, "docs", "note.md"), "# Note\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    writeFileSync(path.join(projet, "docs", "classeur.xlsx"), readFileSync(path.join(FIXTURES, "classeur.xlsx")));
    writeFileSync(path.join(projet, "docs", "ancien.xls"), readFileSync(path.join(FIXTURES, "ancien.xls")));
    writeFileSync(path.join(projet, "docs", "compte-rendu.docx"), readFileSync(path.join(FIXTURES, "compte-rendu.docx")));
    writeFileSync(path.join(projet, "docs", "faux.xlsx"), "ceci n'est pas un classeur");
    writeFileSync(path.join(projet, "docs", "gros.xlsx"), Buffer.alloc(1.6 * 1024 * 1024));
    writeFileSync(path.join(projet, "docs", "texte.pdf"), "%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");
    writeFileSync(path.join(projet, "docs", "police.woff2"), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]));
    writeFileSync(path.join(path.dirname(projet), "secret-hors-projet.md"), "secret");

    const lire = (relatif) => lireFichier(projet, relatif).then((c) => c, (e) => ({ erreur: e.message }));
    const md = await lire("docs/note.md");
    verifier(md.type === "texte" && md.texte.startsWith("# Note"), "md → texte (mis en forme dans la visionneuse)");
    const c = await lire("docs/classeur.xlsx");
    verifier(c.type === "classeur" && c.feuilles.length === 2 && c.taille > 0, "xlsx → classeur");
    verifier((await lire("docs/ancien.xls")).type === "classeur", "xls → classeur");
    const d = await lire("docs/compte-rendu.docx");
    verifier(d.type === "document" && d.blocs.length === 10, "docx → document");
    const faux = await lire("docs/faux.xlsx");
    verifier(faux.type === "autre" && /illisible/.test(faux.raison), `faux xlsx → autre (${faux.raison})`);
    const gros = await lire("docs/gros.xlsx");
    verifier(gros.type === "autre" && gros.raison === "Fichier trop lourd pour l’aperçu.", "xlsx de plus de 1,5 Mo → la raison déjà prévue");
    const pdf = await lire("docs/texte.pdf");
    verifier(pdf.type === "autre" && pdf.raison === "Pas d’aperçu pour ce type de fichier.", "pdf (même sans octet nul) → pas d’aperçu");
    verifier((await lire("docs/police.woff2")).type === "autre", "binaire → pas d’aperçu");
    verifier(/pas dans le projet/.test((await lire("../secret-hors-projet.md")).erreur ?? ""), "chemin qui sort du projet → refusé");
    verifier(/pas dans le projet/.test((await lire("docs/../../secret-hors-projet.md")).erreur ?? ""), "chemin détourné par docs/../.. → refusé");
    verifier(/n’existe pas/.test((await lire("docs/absent.md")).erreur ?? ""), "fichier absent → message clair");
    verifier(/dossier/.test((await lire("docs")).erreur ?? ""), "dossier → message clair");
  } finally {
    rmSync(projet, { recursive: true, force: true });
    rmSync(path.join(path.dirname(projet), "secret-hors-projet.md"), { force: true });
  }

  /* ─── Arbre du projet : tous les éléments de chaque niveau, même au-delà de 4 000 nœuds ─── */
  const gros = mkdtempSync(path.join(os.tmpdir(), "klyra-arbre-"));
  try {
    // 00_CONTROL rempli de 60 dossiers × 80 fichiers (4 800 nœuds) : l'ancien parcours s'arrêtait avant 30_CLIENTS.
    for (let d = 0; d < 60; d++) {
      mkdirSync(path.join(gros, "00_CONTROL", `d${d}`), { recursive: true });
      for (let f = 0; f < 80; f++) writeFileSync(path.join(gros, "00_CONTROL", `d${d}`, `f${f}.md`), "");
    }
    for (const d of ["10_PERSONAL", "20_COMPANY", "30_CLIENTS/CL-0001", "40_KNOWLEDGE", "50_AGENT-OS", "90_ARCHIVES", "node_modules/x", ".git", ".claude"]) mkdirSync(path.join(gros, d), { recursive: true });
    writeFileSync(path.join(gros, "README.md"), "");
    writeFileSync(path.join(gros, "30_CLIENTS", "CL-0001", "CLIENT.md"), "");
    const racine = (await arbreDossier(gros)).map((n) => `${n.kind === "dossier" ? "/" : ""}${n.name}`);
    verifier(
      racine.join(" ") === "/.claude /00_CONTROL /10_PERSONAL /20_COMPANY /30_CLIENTS /40_KNOWLEDGE /50_AGENT-OS /90_ARCHIVES README.md",
      `arbre de 4 800+ nœuds : la racine montre tout, sans node_modules ni .git (${racine.join(" ")})`,
    );
    verifier((await arbreDossier(gros, "00_CONTROL")).length === 60, "un dossier se lit à son ouverture : ses 60 sous-dossiers");
    verifier((await arbreDossier(gros, "00_CONTROL/d59")).length === 80, "dernier sous-dossier : ses 80 fichiers");
    const client = await arbreDossier(gros, "30_CLIENTS/CL-0001");
    verifier(client.length === 1 && client[0].path === "30_CLIENTS/CL-0001/CLIENT.md" && client[0].kind === "fichier", "chemins relatifs à la racine du projet");
    verifier(await arbreDossier(gros, "../").then(() => false, (e) => /pas dans le projet/.test(e.message)), "arbre : un dossier hors du projet est refusé");
    // Le vrai DIGITAL-OS de ce serveur, en lecture seule, s'il est là.
    const dos = "/var/lib/openbot/DIGITAL-OS";
    const reel = await arbreDossier(dos).catch(() => null);
    if (reel) {
      const noms = reel.filter((n) => n.kind === "dossier").map((n) => n.name);
      const attendus = [".claude", "00_CONTROL", "10_PERSONAL", "20_COMPANY", "30_CLIENTS", "40_KNOWLEDGE", "50_AGENT-OS", "90_ARCHIVES"];
      verifier(attendus.every((a) => noms.includes(a)) && reel.some((n) => n.kind === "fichier"), `DIGITAL-OS : racine complète (${reel.map((n) => n.name).join(", ")})`);
    }
  } finally {
    rmSync(gros, { recursive: true, force: true });
  }

  console.log(echecs.length ? `\n${echecs.length} échec(s)` : "\nTout est bon.");
  process.exit(echecs.length ? 1 : 0);
})();
