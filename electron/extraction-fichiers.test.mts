import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { extraireContenu, extraireFichier, texteIndexable } from "./extraction-fichiers.ts";

const FIXTURES = path.join(import.meta.dirname, "..", "scripts", "fixtures", "extraction");
const fixture = (nom: string) => readFileSync(path.join(FIXTURES, nom));

test("PDF de Chromium (polices composites, ToUnicode) : le texte des deux pages, accents compris", () => {
  const e = extraireContenu("chromium.pdf", fixture("chromium.pdf"))!;
  assert.equal(e.nature, "pdf");
  assert.equal(e.complet, true);
  assert.match(e.texte, /^Compte rendu Acme\n/);
  assert.match(e.texte, /contact : Jeanne Lefèvre\. Budget validé à 12 500 €/);
  assert.match(e.texte, /Étape 1 : maquettes « été »/);
  assert.match(e.texte, /\n\nDeuxième page : décisions sur l’œuvre\.$/);
});

test("PDF de LibreOffice et de reportlab (ASCII85 puis Flate)", () => {
  assert.match(extraireContenu("lo.pdf", fixture("lo.pdf"))!.texte, /Le projet Orion démarre lundi\. Responsable : Zoé Martin\.\nCoût estimé : 3 400 € — à confirmer\./);
  assert.equal(extraireContenu("reportlab.pdf", fixture("reportlab.pdf"))!.texte, "Note de réunion : le client Acme valide le devis.\nProchaine étape : maquette.\n\nPage deux, fin.");
});

test("PDF protégé : rien n'est lu, et la note le dit", () => {
  const e = extraireContenu("protege.pdf", fixture("protege.pdf"))!;
  assert.equal(e.texte, "");
  assert.match(e.note ?? "", /protégé/);
});

/** Un PDF minimal dont la police (avec sa table ToUnicode en plages) est rangée dans un flux d'objets. */
function pdfAvecFluxObjets(): Buffer {
  const cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfrange <0001> <0003> <0041> <0010> <0011> [<00E9> <0153>] endbfrange 1 beginbfchar <0020> <0020> endbfchar endcmap end end";
  const contenu = "BT /F1 12 Tf 72 720 Td <000100020003> Tj 0 -14 Td [<0010> -300 <0011>] TJ ET";
  const objStmCorps = "4 0 5 60 ";
  const obj4 = "<< /Type /Font /Subtype /Type0 /BaseFont /X /ToUnicode 6 0 R >>";
  const obj5 = "<< /Font << /F1 4 0 R >> >>";
  const flux = Buffer.from(objStmCorps.padEnd(10) + obj4.padEnd(60) + obj5);
  const z = deflateSync(flux), zc = deflateSync(Buffer.from(contenu)), zm = deflateSync(Buffer.from(cmap));
  const parts: (string | Buffer)[] = [
    "%PDF-1.7\n",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 /Resources 5 0 R >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /Contents 7 0 R >> endobj\n",
    `8 0 obj << /Type /ObjStm /N 2 /First 10 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, z, "\nendstream\nendobj\n",
    `6 0 obj << /Filter /FlateDecode /Length ${zm.length} >>\nstream\n`, zm, "\nendstream\nendobj\n",
    `7 0 obj << /Filter /FlateDecode /Length ${zc.length} >>\nstream\n`, zc, "\nendstream\nendobj\n",
    "trailer << /Root 1 0 R >>\n%%EOF\n",
  ];
  return Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : p)));
}

test("PDF 1.5+ : police dans un flux d'objets, ressources héritées, plages ToUnicode, espace par TJ", () => {
  const e = extraireContenu("objets.pdf", pdfAvecFluxObjets())!;
  assert.equal(e.texte, "ABC\né œ");
});

test("PDF scanné (aucun texte) : vide, avec la raison", () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n", "latin1");
  const e = extraireContenu("scan.pdf", pdf)!;
  assert.equal(e.texte, "");
  assert.match(e.note ?? "", /sans texte lisible/);
});

test("images : dimensions, EXIF (description, auteur, mots Windows), textes d'un PNG", () => {
  const jpg = extraireContenu("photo.jpg", fixture("photo.jpg"))!;
  assert.equal(jpg.texte, "Dimensions : 32 × 24 px\nDescription : Maquette page accueil Acme\nAuteur : Zoe Martin\nMots-clés : acme;maquette");
  const png = extraireContenu("schema.png", fixture("schema.png"))!;
  assert.equal(png.texte, "Dimensions : 32 × 24 px\nTitle : Schéma d’architecture\nDescription : Flux des données entre le PC et le VPS");
  assert.match(texteIndexable("schema.png", png), /^Image « schema\.png » : ce que le fichier dit de lui, pas une description du contenu\./);
});

test("sons : étiquettes ID3 (avec commentaire), WAV (durée, INFO), FLAC (durée, commentaires Vorbis)", () => {
  const cadre = (id: string, corps: Buffer) => { const t = Buffer.alloc(10); t.write(id, 0, "latin1"); t.writeUInt32BE(corps.length, 4); return Buffer.concat([t, corps]); };
  const texte = (s: string) => Buffer.concat([Buffer.from([3]), Buffer.from(s, "utf8")]);
  const cadres = Buffer.concat([cadre("TIT2", texte("Réunion d’équipe")), cadre("TPE1", texte("KLYRA")), cadre("COMM", Buffer.concat([Buffer.from([3]), Buffer.from("fra"), Buffer.from([0]), Buffer.from("Décision : livrer vendredi", "utf8")]))]);
  const tete = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  const n = cadres.length; tete[6] = (n >> 21) & 127; tete[7] = (n >> 14) & 127; tete[8] = (n >> 7) & 127; tete[9] = n & 127;
  assert.equal(extraireContenu("note.mp3", Buffer.concat([tete, cadres, Buffer.alloc(64)]))!.texte, "Titre : Réunion d’équipe\nArtiste : KLYRA\nCommentaire : Décision : livrer vendredi");

  const chunk = (id: string, corps: Buffer) => { const t = Buffer.alloc(8); t.write(id, 0, "latin1"); t.writeUInt32LE(corps.length, 4); return Buffer.concat([t, corps, corps.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const fmt = Buffer.alloc(16); fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(16000, 4); fmt.writeUInt32LE(32000, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
  const info = Buffer.concat([Buffer.from("INFO"), chunk("INAM", Buffer.from("Point du lundi\0"))]);
  const corps = Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", fmt), chunk("LIST", info), chunk("data", Buffer.alloc(32000 * 75))]);
  const riff = Buffer.alloc(8); riff.write("RIFF"); riff.writeUInt32LE(corps.length, 4);
  assert.equal(extraireContenu("point.wav", Buffer.concat([riff, corps]))!.texte, "Titre : Point du lundi\nDurée : 1 min 15 s");

  const info44 = Buffer.alloc(34); info44.writeUInt32BE((44100 << 12) | (1 << 9) | (15 << 4), 10); info44.writeUInt32BE(44100 * 30, 14);
  const vendeur = Buffer.from("ref"), commentaires = [Buffer.from("TITLE=Interview client"), Buffer.from("COMMENT=Besoin : un tableau de bord")];
  const vc = Buffer.concat([Buffer.from([vendeur.length, 0, 0, 0]), vendeur, Buffer.from([commentaires.length, 0, 0, 0]), ...commentaires.flatMap((c) => [Buffer.from([c.length, 0, 0, 0]), c])]);
  const bloc = (type: number, d: Buffer, dernier = false) => Buffer.concat([Buffer.from([(dernier ? 128 : 0) | type, (d.length >> 16) & 255, (d.length >> 8) & 255, d.length & 255]), d]);
  assert.equal(extraireContenu("interview.flac", Buffer.concat([Buffer.from("fLaC"), bloc(0, info44), bloc(4, vc, true)]))!.texte, "Durée : 30 s\nTitre : Interview client\nCommentaire : Besoin : un tableau de bord");
});

test("un format inconnu n'est pas extrait ; un fichier abîmé ne lève pas d'erreur ; le disque est relu s'il change", () => {
  assert.equal(extraireContenu("x.docx", Buffer.from("PK")), null);
  assert.equal(extraireContenu("x.pdf", Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page /Contents 9 0 R >>"))?.texte, "");
  const dossier = mkdtempSync(path.join(os.tmpdir(), "extraction-"));
  try {
    mkdirSync(dossier, { recursive: true });
    const f = path.join(dossier, "doc.pdf");
    writeFileSync(f, fixture("reportlab.pdf"));
    assert.match(extraireFichier(f)!.texte, /client Acme/);
    writeFileSync(f, fixture("lo.pdf"));
    assert.match(extraireFichier(f)!.texte, /projet Orion/);
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});
