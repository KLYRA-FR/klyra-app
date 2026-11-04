/**
 * Les moteurs du VPS, vus par Réglages du serveur › Fournisseurs : Claude Code (posé par lancer.sh) et
 * Codex pour ChatGPT (installé depuis l'app, comme sur le PC). Mêmes formes que l'app (`MoteurPoste`,
 * `CompteMoteur`, `ModeleMoteur`, cf. electron/moteurs/types.ts).
 *
 * Installer ou mettre à jour prend du temps : la demande lance un travail et répond tout de suite ;
 * l'app relit `travail` (étape, octets reçus, erreur) jusqu'à la fin.
 */
import { commande, derniereVersionNpm, estGere, installerDepuisNpm } from "./installation.mjs";

/**
 * @param {{ home: string, claude: { trouver: () => string | null, etat: () => string, methode: () => string | null, env: () => Record<string, string>, utilisation?: () => object | null },
 *   codex: ReturnType<typeof import("./codex.mjs").creerCodex> }} options
 */
export function creerMoteurs(options) {
  const { home, claude, codex } = options;
  const travaux = new Map();
  let versionClaude = null;

  const CATALOGUE = [
    { id: "claude", nom: "Claude Code", fournisseur: "Claude", paquet: "@anthropic-ai/claude-code", trouver: claude.trouver, installable: false },
    { id: "codex", nom: "Codex", fournisseur: "ChatGPT", paquet: "@openai/codex", trouver: codex.trouver, installable: true },
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

  const modeles = (id) => (connu(id).id === "codex" ? codex.modeles() : Promise.resolve([]));
  /** Les limites de l'abonnement : Codex les relit dans le compte ; Claude Code, la dernière reçue d'une session (sans requête). */
  const utilisation = async (id, actualiser) => (connu(id).id === "codex" ? codex.utilisation(actualiser === true) : (claude.utilisation?.() ?? null));
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
    if (connu(id).id !== "codex") {
      throw new Error("Claude Code se connecte depuis le VPS : relance la commande d’installation avec « connecter-claude ».");
    }
    return codex.connecter(mode === "code" ? "code" : "navigateur");
  }

  const relayerRetour = (id, chemin) => {
    if (connu(id).id !== "codex") throw new Error("Pas de connexion par le navigateur pour ce fournisseur.");
    return codex.relayerRetour(chemin);
  };

  const connecterAvecCle = (id, cle) => {
    if (connu(id).id !== "codex") throw new Error("Claude Code ne se connecte pas avec une clé ici.");
    return codex.connecterAvecCle(cle);
  };
  const deconnecter = (id) => {
    if (connu(id).id !== "codex") throw new Error("Claude Code se déconnecte depuis le VPS.");
    return codex.deconnecter();
  };

  return { liste, compte, modeles, utilisation, versionDisponible, lancerTravail, connecter, relayerRetour, etatConnexion: codex.etatConnexion, connecterAvecCle, deconnecter };
}
