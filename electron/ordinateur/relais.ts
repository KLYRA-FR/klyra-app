import { chmod } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";

/**
 * Computer Use : le relais entre les agents et le pilote (cua-driver), repris
 * d'OpenBot (`cua-driver-action-tap.ts`). Chaque agent lance son propre
 * `cua-driver mcp --socket <relais>`, qui parle au démon par ce relais.
 *
 * Il ne décide rien : il transmet chaque octet tel quel, dans les deux sens.
 * Il change une seule chose au retour. À la réponse d'un appel d'outil, il
 * ajoute une copie JSON de son `structuredContent` en texte, parce que
 * certains fournisseurs ne montrent au modèle que le texte, et que le texte du
 * pilote est un résumé sans les identifiants (window_id, snapshot_id,
 * element_token) qui servent à agir.
 *
 * Protocole du démon : une requête JSON par ligne (`{"method":"call","name","args"}`),
 * une réponse par ligne, dans l'ordre (`{"ok":true,"result":{content,structuredContent}}`).
 */

const ETIQUETTE = "structuredContent en JSON, copié par KLYRA pour les clients qui ne montrent que le texte :";
const MAX_COPIE = 65_536;
const NOTE_ELEMENT = "Pour agir sur un élément, envoie ce pid, ce window_id et ce snapshot_id avec l'element_index que montre l'arbre du texte ci-dessus.";
/** Une ligne de requête plus longue n'est pas lue (elle est quand même transmise). */
const MAX_REQUETE = 1_048_576;
/** Une réponse plus longue passe telle quelle, au lieu d'être gardée entière en mémoire. */
const MAX_REPONSE = 33_554_432;
const TEXTE_REPETE = 256;
const BASE64_MIN = 1_024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === "object" && v !== null && !Array.isArray(v);

/** La réponse d'un appel d'outil, avec la copie JSON en plus ; null si rien à ajouter. */
export function ajouterCopieJson(ligne: string): string | null {
  let grandEntier = false;
  let lu: unknown;
  try {
    lu = JSON.parse(ligne, (_cle, v: unknown) => {
      // Un identifiant plus grand que 2^53 serait arrondi en le réécrivant : on laisse la ligne telle quelle.
      if (typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v)) grandEntier = true;
      return v;
    });
  } catch {
    return null;
  }
  if (grandEntier || !estObjet(lu) || lu.ok !== true) return null;
  const resultat = lu.result;
  if (!estObjet(resultat) || !Array.isArray(resultat.content) || !estObjet(resultat.structuredContent)) return null;
  const textes = resultat.content.flatMap((c) => (estObjet(c) && c.type === "text" && typeof c.text === "string" ? [c.text] : []));
  if (textes.some((t) => t.startsWith(ETIQUETTE))) return null;
  const copie = copieCompacte(resultat.structuredContent, textes);
  if (Object.keys(copie).length === 0) return null;
  return JSON.stringify({ ...lu, result: { ...resultat, content: [...resultat.content, { type: "text", text: texteCopie(copie) }] } });
}

function copieCompacte(structure: Objet, textes: string[]): Objet {
  const elements = structure.elements;
  const avecElements = Array.isArray(elements);
  // L'arbre des éléments est déjà dans le texte : on ne garde que de quoi les viser.
  const champs = Object.entries(structure)
    .filter(([cle]) => !(avecElements && (cle === "elements" || cle === "_note")))
    .map(([cle, v]) => [cle, typeof v === "string" && v.length >= TEXTE_REPETE && textes.some((t) => t.includes(v)) ? "[le même texte est dans le résultat ci-dessus]" : v]);
  const adresse: Objet = {};
  if (avecElements && elements.length > 0) {
    if (typeof structure.snapshot_id === "string") adresse.element_address = NOTE_ELEMENT;
    else {
      const jetons: Record<string, string> = {};
      for (const e of elements) if (estObjet(e) && typeof e.element_index === "number" && typeof e.element_token === "string") jetons[String(e.element_index)] = e.element_token;
      if (Object.keys(jetons).length > 0) adresse.element_tokens = jetons;
    }
  }
  return { ...Object.fromEntries(champs), ...adresse };
}

function texteCopie(copie: Objet): string {
  const json = JSON.stringify(copie, (_cle, v: unknown) =>
    typeof v === "string" && v.length >= BASE64_MIN && ((v.startsWith("data:") && v.includes(";base64,")) || BASE64.test(v.replace(/\r?\n/g, "")))
      ? `[${v.length} caractères de données base64]`
      : v,
  );
  if (json.length <= MAX_COPIE) return `${ETIQUETTE}\n${json}`;
  return `${ETIQUETTE}\n${json.slice(0, MAX_COPIE)}\n[Copie coupée à ${MAX_COPIE} caractères sur ${json.length}. Demande moins à l'outil : get_window_state prend query et max_elements.]`;
}

/** Le relais : écoute sur son adresse, et ouvre une connexion au démon par agent. */
export class Relais {
  private serveur: Server | null = null;
  private connexions = new Set<Socket>();
  adresse: string | null = null;

  async ecouter(demon: string, adresse: string): Promise<void> {
    if (this.serveur) return;
    const serveur = createServer((agent) => this.relier(agent, demon));
    this.serveur = serveur;
    await new Promise<void>((resoudre, rejeter) => {
      serveur.once("error", rejeter);
      serveur.listen(adresse, () => {
        serveur.removeListener("error", rejeter);
        resoudre();
      });
    }).catch((e: unknown) => {
      this.serveur = null;
      throw e;
    });
    serveur.on("error", () => undefined);
    // Le relais pilote tout le bureau : lui seul et cet utilisateur peuvent l'ouvrir.
    if (process.platform !== "win32") await chmod(adresse, 0o600).catch(() => undefined);
    this.adresse = adresse;
  }

  async fermer(): Promise<void> {
    const serveur = this.serveur;
    this.serveur = null;
    this.adresse = null;
    for (const s of this.connexions) s.destroy();
    this.connexions.clear();
    if (serveur) await new Promise<void>((r) => serveur.close(() => r()));
  }

  private relier(agent: Socket, adresse: string): void {
    const demon = connect(adresse);
    this.connexions.add(agent);
    this.connexions.add(demon);
    const fin = () => {
      this.connexions.delete(agent);
      this.connexions.delete(demon);
      agent.destroy();
      demon.destroy();
    };
    agent.on("error", fin);
    demon.on("error", fin);
    agent.on("close", fin);
    demon.on("close", fin);

    /* Chaque ligne de requête annonce une ligne de réponse, dans l'ordre : true si c'est un appel d'outil. */
    const attendues: boolean[] = [];
    let enCours = "";
    let sauter = false;
    agent.on("data", (morceau: Buffer) => {
      demon.write(morceau);
      enCours += morceau.toString("utf8");
      let fl = enCours.indexOf("\n");
      while (fl >= 0) {
        const ligne = enCours.slice(0, fl);
        enCours = enCours.slice(fl + 1);
        attendues.push(!sauter && estAppel(ligne));
        sauter = false;
        fl = enCours.indexOf("\n");
      }
      if (enCours.length > MAX_REQUETE) {
        enCours = "";
        sauter = true;
      }
    });

    /* Au retour : une réponse d'appel est gardée jusqu'à sa fin de ligne, puis complétée ; le reste passe tel quel. */
    let ligne: "passer" | "garder" | null = null;
    let gardee: Buffer[] = [];
    let taille = 0;
    const lacher = (entiere: boolean) => {
      if (taille === 0) return;
      const brute = Buffer.concat(gardee, taille);
      gardee = [];
      taille = 0;
      agent.write(entiere ? avecCopie(brute) : brute);
    };
    demon.on("data", (morceau: Buffer) => {
      let debut = 0;
      while (debut < morceau.length) {
        if (ligne === null) ligne = attendues.shift() ? "garder" : "passer";
        const fl = morceau.indexOf(0x0a, debut);
        const fin = fl < 0 ? morceau.length : fl + 1;
        const piece = morceau.subarray(debut, fin);
        debut = fin;
        if (ligne === "passer") agent.write(piece);
        else {
          gardee.push(piece);
          taille += piece.length;
          if (taille > MAX_REPONSE) {
            lacher(false);
            ligne = "passer";
          }
        }
        if (fl >= 0) {
          if (ligne === "garder") lacher(true);
          ligne = null;
        }
      }
    });
    demon.on("end", () => lacher(false));
  }
}

function estAppel(ligne: string): boolean {
  try {
    const lu: unknown = JSON.parse(ligne);
    return estObjet(lu) && lu.method === "call" && typeof lu.name === "string";
  } catch {
    return false;
  }
}

function avecCopie(ligne: Buffer): Buffer {
  if (!ligne.includes('"structuredContent"')) return ligne;
  const texte = ligne.toString("utf8", 0, ligne[ligne.length - 1] === 0x0a ? ligne.length - 1 : ligne.length);
  const reecrite = ajouterCopieJson(texte);
  return reecrite === null ? ligne : Buffer.from(`${reecrite}\n`, "utf8");
}
