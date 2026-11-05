import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ComptesClaude, environnementCompte } from "./comptes-claude.ts";

const original = {
  installe: true, chemin: "claude", version: "2.1.318", connecte: true, methode: "claude.ai",
  email: "agents@example.test", organisation: "Studio fictif", abonnement: "max", verifieLe: 1,
};
const fixture = path.resolve("scripts/faux-comptes-claude.cjs");

async function contexte(t: TestContext) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "klyra-comptes-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  let poste = { ...original };
  const env: NodeJS.ProcessEnv = { ...process.env, KLYRA_FAUX_EMAIL: "second@example.test" };
  const appels: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const actionsPoste: string[] = [];
  const options = {
    home: tmp, dossier: path.join(tmp, "comptes"), binaire: () => "claude-fictif", environnement: () => env,
    poste: {
      lire: async () => { actionsPoste.push("lire"); return { ...poste }; },
      connecter: async () => { actionsPoste.push("connexion"); poste = { ...original }; return poste; },
      deconnecter: async () => { actionsPoste.push("deconnexion"); poste = { ...poste, connecte: false }; return poste; },
    },
    executer: async (_bin: string, args: string[], environnement: NodeJS.ProcessEnv) => {
      appels.push({ args, env: environnement });
      return new Promise<{ code: number | null; sortie: string }>((resolve, reject) => {
        execFile(process.execPath, [fixture, ...args], { env: environnement, cwd: tmp }, (error, stdout) => {
          if (error && typeof error.code !== "number") reject(error);
          else resolve({ code: error?.code ?? 0, sortie: stdout });
        });
      });
    },
  };
  return { options, env, appels, actionsPoste, comptes: new ComptesClaude(options), poste: () => poste };
}

test("ajouter deux comptes, en vérifier et déconnecter un, redémarrer : les autres restent", async (t) => {
  const c = await contexte(t);
  assert.deepEqual((await c.comptes.lister()).map((x) => x.email), [original.email]);
  const second = await c.comptes.connecter();
  c.env.KLYRA_FAUX_EMAIL = "troisieme@example.test";
  const troisieme = await c.comptes.connecter();
  assert.notEqual(second.id, troisieme.id);
  assert.equal((await c.comptes.lister()).filter((x) => x.connecte).length, 3);
  const avant = c.appels.length;
  await c.comptes.lire(second.id);
  assert.ok(c.appels.slice(avant).every((x) => path.basename(x.env.CLAUDE_CONFIG_DIR!) === second.id));
  await c.comptes.deconnecter(second.id);
  const apres = await new ComptesClaude(c.options).lister();
  assert.equal(apres.find((x) => x.id === second.id)?.connecte, false);
  assert.equal(apres.find((x) => x.id === troisieme.id)?.connecte, true);
  assert.deepEqual(c.poste(), original);
  assert.ok(c.actionsPoste.every((x) => x === "lire"));
  assert.ok(c.appels.every((x) => x.env.CLAUDE_CONFIG_DIR === x.env.CLAUDE_SECURESTORAGE_CONFIG_DIR));
  assert.equal(JSON.stringify(apres).includes("connexion-test"), false);
  await c.comptes.deconnecter("poste");
  assert.equal((await c.comptes.lire(troisieme.id)).connecte, true);
  assert.equal(c.actionsPoste.at(-1), "deconnexion");
});

test("une nouvelle connexion ne reprend aucune authentification du terminal", () => {
  const parent = {
    PATH: "chemin", CLAUDE_CONFIG_DIR: "poste", CLAUDE_SECURESTORAGE_CONFIG_DIR: "poste",
    Claude_Config_Dir: "poste", claude_securestorage_config_dir: "poste",
    ANTHROPIC_API_KEY: "fictif", ANTHROPIC_AUTH_TOKEN: "fictif", CLAUDE_CODE_OAUTH_TOKEN: "fictif",
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "10", CLAUDE_CODE_SESSION_ACCESS_TOKEN: "fictif",
    CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_FOUNDRY: "1",
  };
  assert.deepEqual(environnementCompte(parent, "nouveau"), { PATH: "chemin", CLAUDE_CONFIG_DIR: "nouveau", CLAUDE_SECURESTORAGE_CONFIG_DIR: "nouveau" });
  assert.equal(parent.CLAUDE_CONFIG_DIR, "poste");
});

test("reconnecter un compte connecté et traverser les dossiers sont refusés avant toute mutation", async (t) => {
  const c = await contexte(t);
  await assert.rejects(c.comptes.connecter("poste"), /déjà connecté/);
  const second = await c.comptes.connecter();
  await assert.rejects(c.comptes.connecter(second.id), /déjà connecté/);
  const avant = c.appels.length;
  await assert.rejects(c.comptes.deconnecter("../../.claude"), /invalide/);
  await assert.rejects(c.comptes.connecter(""), /invalide/);
  assert.equal(c.appels.length, avant);
  assert.deepEqual(c.poste(), original);
});

test("connexion refusée : ni succès inventé, ni sortie d'autorisation retournée, ni déconnexion du poste", async (t) => {
  const c = await contexte(t);
  Object.assign(c.env, { KLYRA_FAUX_ECHEC: "1" });
  await assert.rejects(c.comptes.connecter(), (e: Error) => {
    assert.match(e.message, /n’a pas abouti/);
    assert.equal(e.message.includes("URL autorisation"), false);
    return true;
  });
  assert.deepEqual(c.poste(), original);
  assert.equal((await c.comptes.lister()).filter((x) => x.connecte).length, 1);
  delete c.env.KLYRA_FAUX_ECHEC;
  const compte = (await c.comptes.lister()).find((x) => !x.poste)!;
  assert.equal((await c.comptes.connecter(compte.id)).connecte, true);
});

test("deux fenêtres ne peuvent lancer deux mutations en même temps", async (t) => {
  const c = await contexte(t);
  let debloquer!: () => void;
  let entre!: () => void;
  const arrive = new Promise<void>((r) => { entre = r; });
  const verrou = new Promise<void>((r) => { debloquer = r; });
  const comptes = new ComptesClaude({ ...c.options, executer: async (bin, args, env) => {
    if (args[1] === "login") { entre(); await verrou; }
    return c.options.executer(bin, args, env);
  } });
  const connexion = comptes.connecter();
  await arrive;
  await assert.rejects(comptes.deconnecter("poste"), /déjà en cours/);
  debloquer();
  await connexion;
  assert.deepEqual(c.poste(), original);
});

test("un compte symlinké vers un autre dossier n'est jamais utilisé", { skip: process.platform === "win32" }, async (t) => {
  const c = await contexte(t);
  await mkdir(c.options.dossier);
  const id = "11111111-1111-4111-8111-111111111111";
  await symlink(c.options.home, path.join(c.options.dossier, id), "dir");
  await assert.rejects(c.comptes.deconnecter(id), /pas isolé/);
  assert.equal(c.appels.length, 0);
  assert.equal((await c.comptes.lister()).length, 1);
});

test("les données persistées restent dans le dossier propre du compte", async (t) => {
  const c = await contexte(t);
  const second = await c.comptes.connecter();
  const brut = await readFile(path.join(c.options.dossier, second.id, "connexion-test.json"), "utf8");
  assert.equal(JSON.parse(brut).email, "second@example.test");
  assert.equal((await c.comptes.lire("poste")).email, original.email);
});

test("un profil illisible laisse visibles et utilisables les autres comptes", async (t) => {
  const c = await contexte(t);
  const second = await c.comptes.connecter();
  await writeFile(path.join(c.options.dossier, second.id, "connexion-test.json"), "JSON invalide");
  const liste = await c.comptes.lister();
  assert.equal(liste[0].email, original.email);
  assert.equal(liste[0].connecte, true);
  assert.match(liste[1].erreur!, /Impossible de vérifier/);
  assert.equal((await c.comptes.connecter()).connecte, true);
  assert.deepEqual(c.poste(), original);
});

test("un binaire disparu signale un échec sans laisser le verrou de connexion pris", async (t) => {
  const c = await contexte(t);
  const comptes = new ComptesClaude({ ...c.options, executer: undefined, binaire: () => path.join(c.options.home, "claude-introuvable") });
  await assert.rejects(comptes.connecter(), /Impossible de lancer Claude Code/);
  await assert.rejects(comptes.connecter(), /Impossible de lancer Claude Code/);
  assert.deepEqual(c.poste(), original);
});

// Vérification facultative du vrai CLI : uniquement `--version` et `auth status` dans un dossier vide.
// Aucun login/logout, aucune lecture du contenu de credentials, aucun appel à un modèle.
test("le vrai Claude Code voit un dossier neuf comme déconnecté", { skip: !process.env.KLYRA_TEST_VRAI_CLAUDE }, async (t) => {
  const c = await contexte(t);
  const id = "11111111-1111-4111-8111-111111111111";
  await mkdir(path.join(c.options.dossier, id), { recursive: true });
  const comptes = new ComptesClaude({ ...c.options, executer: undefined, binaire: () => process.env.KLYRA_TEST_VRAI_CLAUDE! });
  const profil = await comptes.lire(id);
  assert.equal(profil.connecte, false);
  assert.equal(profil.email, null);
  assert.ok(profil.version);
});
