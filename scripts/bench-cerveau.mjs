/** Mesure locale sur données synthétiques ; aucune facture ni économie de tokens n'est simulée. */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Cerveau } from "../serveur/cerveau.mjs";
const tmp = mkdtempSync(path.join(os.tmpdir(), "cerveau-bench-"));
const c = new Cerveau(new DatabaseSync(path.join(tmp, "essai.sqlite")));
const proprietaire = { agentId: null, projetId: null, proprietaire: true };
try {
  const debut = performance.now(), nombre = 10_000;
  for (let i = 0; i < nombre; i++) {
    const contenu = `# Document synthétique ${i}\nRéférence unique dossier-${i}.\n` + ("Procédure de démonstration : conserver les décisions, les sources et le contexte, sans injecter tout le dossier dans un prompt.\n").repeat(8);
    c.garder({ id: `synthese-${i}`, titre: `Document synthétique ${i}`, contenu, projetId: null, liens: [], source: null, creeLe: "", modifieLe: "" });
  }
  const indexationMs = performance.now() - debut, temps = [];
  let resultat;
  for (let i = 0; i < 40; i++) { const d = performance.now(); resultat = c.chercher(i % 2 ? "procedure" : "dossier-9876", proprietaire, 4096); temps.push(performance.now() - d); }
  temps.sort((a, b) => a - b);
  const selective = c.chercher("dossier-9876", proprietaire, 4096);
  const lecture = c.lire(selective.elements.map((p) => p.id), proprietaire, 4096);
  const page = c.lister(proprietaire);
  const rapport = { nature: "Corpus entièrement synthétique, aucune donnée de la personne", runtime: process.version, nombreDocuments: nombre, ...c.etat(proprietaire), indexationMs: Math.round(indexationMs), rechercheMedianeMs: Number(temps[20].toFixed(2)), rechercheP95Ms: Number(temps[38].toFixed(2)), rechercheGeneriqueOctets: resultat.octets, rechercheSelectiveOctets: selective.octets, lectureSelectiveOctets: lecture.octets, budgetParAppelOctets: 4096, notesChargeesPourLeGraphe: page.notes.length, pageGrapheOctets: Buffer.byteLength(JSON.stringify(page)), appelsModele: 0, limite: "Ne mesure pas les tokens facturés par un fournisseur. Test de 10 000 petits textes, pas d’un corpus multimédia ni de millions de documents." };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(rapport, null, 2));
  console.log(JSON.stringify(rapport));
} finally { c.fermer(); rmSync(tmp, { recursive: true, force: true }); }
