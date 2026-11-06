/**
 * Les moteurs du VPS, vus par Réglages du serveur › Fournisseurs : Claude Code (posé par lancer.sh) et
 * Codex pour ChatGPT et Grok Build pour Grok (installés depuis l'app, comme sur le PC). Mêmes formes que l'app (`MoteurPoste`,
 * `CompteMoteur`, `ModeleMoteur`, cf. electron/moteurs/types.ts).
 *
 * Installer ou mettre à jour prend du temps : la demande lance un travail et répond tout de suite ;
 * l'app relit `travail` (étape, octets reçus, erreur) jusqu'à la fin.
 */
import path from "node:path";
import { ComptesClaude } from "./comptes-claude.mjs";
import { commande, derniereVersionNpm, estGere, installerDepuisNpm } from "./installation.mjs";

/**
 * `donnees` : les comptes Claude supplémentaires (un dossier de connexion chacun, `donnees/claude-comptes`, cf.
 * electron/comptes-claude.ts). Le compte des agents reste celui de `connecter-claude`.
 * @param {{ home: string, donnees?: string, claude: { trouver: () => string | null, etat: () => string, methode: () => string | null, env: () => Record<string, string>, utilisation?: () => object | null, surLimitesCompte?: (cb: (id: string, info: unknown) => void) => void },
 *   codex: ReturnType<typeof import("./codex.mjs").creerCodex>, grok?: ReturnType<typeof import("./grok.mjs").creerGrok> }} options
 */
export function creerMoteurs(options) {
  const { home, claude, codex, grok } = options;
  const travaux = new Map();
  let versionClaude = null;
  /* Après `compte` (plus bas) : il n'est appelé qu'au moment d'une lecture. */
  const comptesClaude = options.donnees
    ? new ComptesClaude({
        dossier: path.join(options.donnees, "claude-comptes"),
        home,
        binaire: claude.trouver,
        /* Pas de navigateur sur un VPS : Claude Code donne la page, l'app l'ouvre sur le PC et rapporte le code. */
        environnement: () => ({ ...process.env, HOME: home, BROWSER: "false", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" }),
        poste: {
          lire: () => compte("claude"),
          connecter: async () => { throw new Error("Le compte des agents de ce serveur se connecte sur le VPS, avec « connecter-claude »."); },
          deconnecter: async () => { throw new Error("Le compte des agents de ce serveur se change sur le VPS, avec « connecter-claude »."); },
          utilisation: async () => claude.utilisation?.() ?? null,
        },
      })
    : null;
  /* Une conversation qui travaille avec un compte supplémentaire : ses limites vont à l'anneau de ce compte. */
  if (comptesClaude) claude.surLimitesCompte?.((id, info) => void comptesClaude.noterLimites(id, info).catch(() => {}));

  const CATALOGUE = [
    { id: "claude", nom: "Claude Code", fournisseur: "Claude", paquet: "@anthropic-ai/claude-code", trouver: claude.trouver, installable: false },
    { id: "codex", nom: "Codex", fournisseur: "ChatGPT", paquet: "@openai/codex", trouver: codex.trouver, installable: true },
    ...(grok ? [{ id: "grok", nom: "Grok Build", fournisseur: "Grok", paquet: "@xai-official/grok", trouver: grok.trouver, installable: true }] : []),
  ];
  const connu = (id) => {
    const m = CATALOGUE.find((x) => x.id === id);
    if (!m) throw new Error(`Fournisseur inconnu : ${id}.`);
    return m;
  };

  function liste() {
    return CATALOGUE.map((m) => {
      const chemin = m.trouver();
      return { id: m.id, nom: m.nom, fournisseur: m.fournisseur, chemin, gere: estGere(home, chemin), installable: m.installable, travail: travaux.get(m.id) ?? null };
    });
  }

  async function lireVersionClaude(bin) {
    if (versionClaude?.bin === bin) return versionClaude.version;
    const r = await commande(bin, ["--version"], 20_000, { env: claude.env() });
    const version = /(\d+\.\d+\.\d+)/.exec(r.sortie)?.[1] ?? null;
    versionClaude = { bin, version };
    return version;
  }

  async function compte(id) {
    if (connu(id).id === "codex") return codex.compte();
    if (id === "grok") return grok.compte();
    const bin = claude.trouver();
    const etat = claude.etat();
    return {
      installe: !!bin,
      chemin: bin,
      version: bin ? await lireVersionClaude(bin) : null,
      connecte: etat === "pret",
      methode: etat === "pret" ? claude.methode() : null,
      email: null,
      organisation: null,
      abonnement: null,
      verifieLe: Date.now(),
    };
  }

  const modeles = (id) => (connu(id).id === "codex" ? codex.modeles() : id === "grok" ? grok.modeles() : Promise.resolve([]));
  /** Les limites de l'abonnement : Codex et Grok les relisent dans le compte ; Claude Code, la dernière reçue d'une session (sans requête). */
  const utilisation = async (id, actualiser, compteClaude) => {
    if (connu(id).id === "codex") return codex.utilisation(actualiser === true);
    if (id === "grok") return grok.utilisation(actualiser === true);
    /* Un compte supplémentaire : relu par une toute petite requête faite avec lui seul (au clic). */
    if (compteClaude && compteClaude !== "poste") return exigerComptes().utilisation(compteClaude, actualiser === true);
    return claude.utilisation?.() ?? null;
  };
  const exigerComptes = () => {
    if (!comptesClaude) throw new Error("Ce serveur ne gère pas plusieurs comptes Claude.");
    return comptesClaude;
  };
  /** Réglages du serveur › Fournisseurs › Claude : les comptes de ce serveur (le compte des agents, puis les autres). */
  const comptes = {
    lister: () => exigerComptes().lister(),
    verifier: (id) => exigerComptes().lire(String(id ?? "")),
    commencer: (id) => exigerComptes().commencerConnexion(id === undefined || id === null ? undefined : String(id)),
    terminer: (id, code) => exigerComptes().terminerConnexion(String(id ?? ""), code),
    deconnecter: (id) => exigerComptes().deconnecter(String(id ?? "")),
  };
  const versionDisponible = (id) => derniereVersionNpm(connu(id).paquet);

  /** Lance l'installation (Codex) ou la mise à jour ; un seul travail à la fois par moteur. */
  function lancerTravail(id, action) {
    const m = connu(id);
    const courant = travaux.get(id);
    if (courant && !courant.fini) throw new Error("Un travail est déjà en cours pour ce fournisseur.");
    if (action === "installer" && !m.installable) throw new Error(`Le serveur ne sait pas installer ${m.nom} : relance la commande d’installation sur le VPS.`);
    const travail = { action, etape: action === "installer" ? "telechargement" : "mise-a-jour", recu: 0, total: null, fini: false, erreur: null };
    travaux.set(id, travail);
    const progression = (p) => Object.assign(travail, p);
    const faire = async () => {
      if (id === "grok") {
        const bin = grok.trouver();
        if (action === "installer" || !bin || estGere(home, bin)) {
          await installerDepuisNpm({ home, moteur: "grok", paquet: m.paquet, executable: "grok", progression });
          grok.relancer();
          return;
        }
        grok.relancer();
        const r = await commande(bin, ["update"], 10 * 60_000, { env: { ...process.env, HOME: home } });
        grok.relancer();
        if (r.code !== 0) throw new Error(r.sortie.trim().split("\n").slice(-3).join(" ").slice(0, 400) || "La mise à jour de Grok a échoué.");
        return;
      }
      if (id === "codex") {
        const bin = codex.trouver();
        if (action === "installer" || !bin || estGere(home, bin)) {
          await installerDepuisNpm({ home, moteur: "codex", paquet: m.paquet, executable: "codex", progression });
          /* Le serveur ouvert garde l'ancien programme : le prochain appel lance le nouveau. */
          codex.fermer();
          return;
        }
        codex.fermer();
        const r = await commande(bin, ["update"], 10 * 60_000, { env: { ...process.env, HOME: home } });
        if (r.code !== 0) throw new Error(r.sortie.trim().split("\n").filter((l) => !/^WARNING/.test(l)).slice(-3).join(" ").slice(0, 400) || "La mise à jour de Codex a échoué.");
        return;
      }
      const bin = claude.trouver();
      if (!bin) throw new Error("Claude Code n’est pas installé sur ce VPS : relance la commande d’installation.");
      const r = await commande(bin, ["update"], 5 * 60_000, { env: claude.env() });
      versionClaude = null;
      if (r.code !== 0) throw new Error(r.sortie.trim().split("\n").slice(-3).join(" ").slice(0, 400) || "La mise à jour de Claude Code a échoué.");
    };
    faire()
      .catch((error) => (travail.erreur = error instanceof Error ? error.message : String(error)))
      .finally(() => (travail.fini = true));
    return travail;
  }

  /** `mode` : « navigateur » (la page d'OpenAI, dont l'app relaie le retour) ou « code » (code d'appareil). */
  function connecter(id, mode) {
    /* Grok : par code d'appareil seulement (lien + code), il n'y a pas de navigateur sur le VPS. */
    if (connu(id).id === "grok") return grok.connecter();
    if (id !== "codex") {
      throw new Error("Claude Code se connecte depuis le VPS : relance la commande d’installation avec « connecter-claude ».");
    }
    return codex.connecter(mode === "code" ? "code" : "navigateur");
  }

  const relayerRetour = (id, chemin) => {
    if (connu(id).id !== "codex") throw new Error("Pas de connexion par le navigateur pour ce fournisseur.");
    return codex.relayerRetour(chemin);
  };

  const connecterAvecCle = (id, cle) => {
    if (connu(id).id === "grok") return grok.connecterAvecCle(cle);
    if (id !== "codex") throw new Error("Claude Code ne se connecte pas avec une clé ici.");
    return codex.connecterAvecCle(cle);
  };
  const deconnecter = (id) => {
    if (connu(id).id === "grok") return grok.deconnecter();
    if (id !== "codex") throw new Error("Claude Code se déconnecte depuis le VPS.");
    return codex.deconnecter();
  };

  return { liste, compte, comptes, modeles, utilisation, versionDisponible, lancerTravail, connecter, relayerRetour, etatConnexion: (id) => (id === "grok" ? grok.etatConnexion() : codex.etatConnexion()), connecterAvecCle, deconnecter };
}
