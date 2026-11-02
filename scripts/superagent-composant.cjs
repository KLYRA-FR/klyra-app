/**
 * Le composant isolé des tests super-agent (`scripts/test-superagent.cjs`) : un process à part qui
 * ouvre le journal jetable, attend un départ commun (courses réelles entre process) ou s'arrête
 * brutalement (SIGKILL) à un point précis. Il ne touche qu'aux chemins qu'on lui passe.
 * Aussi : les effets factices (fichier, état) partagés avec le test.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script Node en CommonJS */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const dist = (module) => require(path.join(__dirname, "..", "dist-electron", "superagent", module));

const sha = (texte) => `sha256:${crypto.createHash("sha256").update(texte, "utf8").digest("hex")}`;
const nomEffet = (op) => `${op.idempotency_key.replace(/[^a-z0-9-]/gi, "_")}.effet`;

/** Effet factice : un fichier par clé d'idempotence (création exclusive), chaque appel noté dans `appels.log`. */
function effetFichier(dossier) {
  return {
    async appliquer(op) {
      fs.appendFileSync(path.join(dossier, "appels.log"), `${op.operation_id}\n`);
      fs.writeFileSync(path.join(dossier, nomEffet(op)), op.desired_effect, { flag: "wx" });
      return { receipt_ref: `fichier:${nomEffet(op)}` };
    },
    async constater(op) {
      const fichier = path.join(dossier, nomEffet(op));
      if (!fs.existsSync(fichier)) return { constat: "absent", preuve_ref: `dossier-relu:${nomEffet(op)}:absent` };
      return { constat: "present", preuve_ref: `fichier:${nomEffet(op)}#${sha(fs.readFileSync(fichier, "utf8"))}` };
    },
  };
}

/**
 * Effet factice d'écriture d'un état (comme un `etat.md` de DIGITAL-OS) : fichier temporaire, fsync,
 * renommage. On le constate par empreinte : celle attendue → présent ; celle d'avant → absent ;
 * une autre → une révision plus récente existe, on ne l'écrase pas (invérifiable).
 */
function effetEtat(contenu) {
  return {
    async appliquer(op) {
      const { chemin } = JSON.parse(op.desired_effect);
      fs.appendFileSync(`${chemin}.appels.log`, `${op.operation_id}\n`);
      const fd = fs.openSync(`${chemin}.tmp`, "w");
      fs.writeSync(fd, contenu);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(`${chemin}.tmp`, chemin);
      return { receipt_ref: `etat:${chemin}` };
    },
    async constater(op) {
      const { chemin, hash_avant, hash_attendu } = JSON.parse(op.desired_effect);
      const lu = sha(fs.readFileSync(chemin, "utf8"));
      if (lu === hash_attendu) return { constat: "present", preuve_ref: `etat:${path.basename(chemin)}#${lu}` };
      if (lu === hash_avant) return { constat: "absent", preuve_ref: `etat-relu:${path.basename(chemin)}#${lu}` };
      return { constat: "inverifiable", preuve_ref: null };
    },
  };
}

/** Attend l'instant de départ commun, sans tenir le processeur. */
function attendre(depart) {
  const veille = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < depart) Atomics.wait(veille, 0, 0, 1);
}

/** Accusé du composant : écrit et synchronisé avant tout arrêt brutal (la sortie standard peut être perdue). */
function accuser(fichier, donnees) {
  const fd = fs.openSync(fichier, "a");
  fs.writeSync(fd, `${JSON.stringify(donnees)}\n`);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}

const arretBrutal = () => process.kill(process.pid, "SIGKILL");

async function principal() {
  const [commande, chemin, brut] = process.argv.slice(2);
  const p = JSON.parse(brut);
  const { ouvrirStockage } = dist("stockage.js");
  const db = ouvrirStockage(chemin);
  const { admettre } = dist("filtre.js");
  const { revendiquer } = dist("occupation.js");
  const { demarrer, lireOperation } = dist("operations.js");
  const { ouvrirLot, fermerLot } = dist("lots.js");

  if (commande === "decider") {
    attendre(p.depart);
    const lot = ouvrirLot(db, { router_id: p.router_id, project_id: p.project_id, policy_version: p.policy_version });
    if (lot.etat !== "ouvert") {
      process.stdout.write(JSON.stringify({ etat: lot.etat, decision_id: lot.decision_id ?? null }));
      db.close();
      return;
    }
    const { classerEvenement } = dist("decision.js");
    const decisions = lot.evenements.map((e) => {
      const classe = classerEvenement(db, e.event_id);
      return {
        event_id: e.event_id,
        disposition: classe.disposition,
        work_id: classe.work_id,
        owner_epoch_attendu: classe.owner_epoch_attendu,
        motif: classe.motif,
      };
    });
    const ferme = fermerLot(db, { decision_id: lot.decision_id, decisions, authorization_ref: p.authorization_ref });
    process.stdout.write(JSON.stringify({ etat: "ouvert", decision_id: lot.decision_id, operations: ferme.operations.length }));
    db.close();
    return;
  }

  if (commande === "admettre" || commande === "revendiquer" || commande === "demarrer") {
    attendre(p.depart);
    const debut = Date.now();
    const resultat =
      commande === "admettre" ? admettre(db, p.entree, p.politique)
      : commande === "revendiquer" ? revendiquer(db, { work_id: p.work_id, agent_id: p.agent_id, epoch_attendu: p.epoch_attendu })
      : demarrer(db, { operation_id: p.operation_id, agent_id: p.agent_id });
    process.stdout.write(JSON.stringify({ debut, resultat }));
    db.close();
    return;
  }

  if (commande !== "arret") throw new Error(`Commande inconnue : ${commande}`);
  switch (p.scenario) {
    case "apres-insertion": {
      accuser(p.accuses, admettre(db, p.entree, p.politique));
      return arretBrutal();
    }
    case "apres-intention": {
      const lot = ouvrirLot(db, { router_id: p.router_id, project_id: p.project_id, policy_version: p.policy_version });
      const decisions = lot.evenements.map((e) => ({ event_id: e.event_id, disposition: "agir", work_id: p.work_id, owner_epoch_attendu: p.owner_epoch }));
      accuser(p.accuses, fermerLot(db, { decision_id: lot.decision_id, decisions, authorization_ref: p.authorization_ref }));
      return arretBrutal();
    }
    case "apres-depart": {
      accuser(p.accuses, demarrer(db, { operation_id: p.operation_id, agent_id: p.agent_id }));
      return arretBrutal();
    }
    case "apres-effet": {
      demarrer(db, { operation_id: p.operation_id, agent_id: p.agent_id });
      accuser(p.accuses, await effetFichier(p.effets).appliquer(lireOperation(db, p.operation_id)));
      return arretBrutal();
    }
    case "pendant-etat": {
      // Arrêt au milieu de l'écriture : la moitié du nouvel état dans le temporaire, pas de renommage.
      demarrer(db, { operation_id: p.operation_id, agent_id: p.agent_id });
      const { chemin: etat } = JSON.parse(lireOperation(db, p.operation_id).desired_effect);
      fs.appendFileSync(`${etat}.appels.log`, `${p.operation_id}\n`);
      const fd = fs.openSync(`${etat}.tmp`, "w");
      fs.writeSync(fd, p.contenu.slice(0, Math.floor(p.contenu.length / 2)));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      accuser(p.accuses, { tmp: `${etat}.tmp` });
      return arretBrutal();
    }
    case "apres-etat": {
      demarrer(db, { operation_id: p.operation_id, agent_id: p.agent_id });
      accuser(p.accuses, await effetEtat(p.contenu).appliquer(lireOperation(db, p.operation_id)));
      return arretBrutal();
    }
    default:
      throw new Error(`Scénario inconnu : ${p.scenario}`);
  }
}

if (require.main === module) {
  principal().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exit(2);
  });
}

module.exports = { effetFichier, effetEtat, sha };
