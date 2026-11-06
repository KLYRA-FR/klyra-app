import assert from "node:assert/strict";
import test from "node:test";
import { envoyerJoints, ErreurJoint, JOINT_TAILLE_MAX, nomJoint, remplacerJoints, type AccesJoints } from "./joints-vps.ts";

const PC = "C:\\Users\\queuc\\AppData\\Roaming\\KLYRA\\collages\\capture-2026-11-06-101500-ab12.png";
const VPS = "/home/klyra/serveur/donnees/joints/dm-camille/0123456789abcdef-capture-2026-11-06-101500-ab12.png";

function acces(fichiers: Record<string, number>, reponse: (nom: string) => { status: number; json: unknown }) {
  const envoyes: string[] = [];
  const a: AccesJoints = {
    taille: (c) => fichiers[c] ?? null,
    lire: async () => new Uint8Array([1, 2, 3]),
    envoyer: async (nom) => {
      envoyes.push(nom);
      return reponse(nom);
    },
  };
  return { a, envoyes };
}

test("le nom envoyé : sans dossier du PC, sans caractère gênant", () => {
  assert.equal(nomJoint(PC), "capture-2026-11-06-101500-ab12.png");
  assert.equal(nomJoint("/tmp/Facture (mars) é.pdf"), "Facture _mars_ é.pdf");
  assert.equal(nomJoint("..\\..\\.env"), "env");
  assert.equal(nomJoint(""), "fichier");
  assert.equal(nomJoint(`${"a".repeat(200)}.png`).endsWith(".png"), true);
});

test("le message porte les chemins du VPS, et rien d'autre ne change", () => {
  const prompt = `Message de Corentin\nRegarde ce fichier.\n\n[Fichiers joints, à lire]\n- ${PC}\n- /home/klyra/projet/a.txt`;
  const sortie = remplacerJoints(prompt, [[PC, VPS]]);
  assert.equal(sortie, `Message de Corentin\nRegarde ce fichier.\n\n[Fichiers joints, à lire]\n- ${VPS}\n- /home/klyra/projet/a.txt`);
  assert.equal(remplacerJoints(prompt, []), prompt);
});

test("seuls les fichiers de ce PC partent ; un chemin du VPS reste tel quel", async () => {
  const { a, envoyes } = acces({ [PC]: 1000 }, () => ({ status: 200, json: { chemin: VPS } }));
  assert.deepEqual(await envoyerJoints([PC, PC, "/home/klyra/projet/a.txt"], a), [[PC, VPS]]);
  assert.deepEqual(envoyes, ["capture-2026-11-06-101500-ab12.png"], "une seule fois");
});

test("un échec dit pourquoi, sans laisser partir un chemin qui ne mène nulle part", async () => {
  const unFichier = { [PC]: 10 };
  await assert.rejects(envoyerJoints([PC], acces({ [PC]: JOINT_TAILLE_MAX + 1 }, () => ({ status: 200, json: { chemin: VPS } })).a), (e) => e instanceof ErreurJoint && /dépasse 20 Mo/.test(e.message));
  const onze = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`/pc/f${i}.png`, 10]));
  await assert.rejects(envoyerJoints(Object.keys(onze), acces(onze, () => ({ status: 200, json: { chemin: VPS } })).a), /10 fichiers joints au plus/);
  await assert.rejects(envoyerJoints([PC], acces(unFichier, () => ({ status: 404, json: null })).a), /relance la commande d’installation/);
  await assert.rejects(envoyerJoints([PC], acces(unFichier, () => ({ status: 401, json: null })).a), /n’est plus relié/);
  await assert.rejects(envoyerJoints([PC], acces(unFichier, () => ({ status: 413, json: { message: "Fichier de plus de 20 Mo." } })).a), /plus de 20 Mo/);
  const panne: AccesJoints = { ...acces(unFichier, () => ({ status: 200, json: null })).a, envoyer: async () => Promise.reject(new Error("réseau")) };
  await assert.rejects(envoyerJoints([PC], panne), /le serveur ne répond pas/);
});
