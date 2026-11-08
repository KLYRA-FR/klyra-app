/** Opération de mise en service : index local, état agrégé, arrêt propre et réserve disque. */
import { openSync, closeSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, statfsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ouvrirCerveau } from "../serveur/cerveau.mjs";
import { connecterDigitalOs, scannerDossier, etatDossier } from "../serveur/cerveau-dossiers.mjs";
const [donneesArg, racineArg, etatArg] = process.argv.slice(2);
if (!donneesArg || !racineArg || !etatArg) throw new Error("Usage : node --experimental-sqlite scripts/indexer-digital-os.mjs <donnees> <DIGITAL-OS> <etat.json>");
const donnees = path.resolve(donneesArg), racine = path.resolve(racineArg), fichierEtat = path.resolve(etatArg);
mkdirSync(path.join(donnees, "cerveau"), { recursive: true, mode: 0o700 });
mkdirSync(path.dirname(fichierEtat), { recursive: true, mode: 0o700 });
const verrou = path.join(donnees, "cerveau", "indexation.lock");
if (existsSync(verrou)) {
  const ancien = JSON.parse(readFileSync(verrou, "utf8"));
  let vivant = true; try { process.kill(ancien.pid, 0); } catch (e) { if (e.code === "ESRCH") vivant = false; }
  if (vivant) throw new Error("Une indexation possède déjà le verrou de cette mémoire.");
  unlinkSync(verrou);
}
const reserve = 8 * 1024 ** 3;
const libre = () => { const s = statfsSync(donnees); return s.bavail * s.bsize; };
if (libre() < reserve) throw new Error("Moins de 8 Gio libres : indexation non lancée.");
const fd = openSync(verrou, "wx", 0o600);
writeFileSync(fd, JSON.stringify({ pid: process.pid, racine, debut: new Date().toISOString() })); closeSync(fd);
let cerveau, arret = false, raison = "", timer;
const debut = new Date().toISOString();
const demanderArret = () => { arret = true; raison ||= "Arrêt demandé"; };
process.on("SIGTERM", demanderArret); process.on("SIGINT", demanderArret);
function publier(phase) {
  const espaceLibre = libre();
  if (espaceLibre < reserve) { arret = true; raison = "Réserve disque de 8 Gio atteinte"; }
  const db = path.join(donnees, "cerveau", "connaissances.sqlite");
  const taille = [db, db + "-wal"].reduce((n, f) => n + (existsSync(f) ? statSync(f).size : 0), 0);
  const etat = { phase, pid: process.pid, debut, mesureLe: new Date().toISOString(), espaceLibre, reserveOctets: reserve, tailleBaseOctets: taille, raison, source: cerveau ? etatDossier(cerveau) : null };
  const tmp = fichierEtat + ".tmp"; writeFileSync(tmp, JSON.stringify(etat, null, 2), { mode: 0o600 }); renameSync(tmp, fichierEtat);
}
try {
  cerveau = ouvrirCerveau(donnees);
  await connecterDigitalOs(cerveau, racine);
  publier("indexation");
  timer = setInterval(() => { try { publier("indexation"); } catch { arret = true; raison = "Publication de l’état impossible"; } }, 2000);
  await scannerDossier(cerveau, { arrete: () => arret });
  publier(arret ? "interrompu" : etatDossier(cerveau)?.etat === "termine" ? "termine" : "partiel");
  console.log(JSON.stringify({ phase: arret ? "interrompu" : etatDossier(cerveau)?.etat, fichiers: etatDossier(cerveau)?.fichiers, erreurs: etatDossier(cerveau)?.erreurs, raison }));
} catch (e) {
  raison = e instanceof Error ? e.message : "Échec de l’indexation";
  try { publier("erreur"); } catch { /* L'erreur initiale est conservée dans le journal, sans contenu source. */ }
  console.error(raison); process.exitCode = 1;
} finally {
  clearInterval(timer); cerveau?.fermer();
  if (existsSync(verrou) && JSON.parse(readFileSync(verrou, "utf8")).pid === process.pid) unlinkSync(verrou);
}
