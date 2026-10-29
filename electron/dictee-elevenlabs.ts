import { randomUUID } from "node:crypto";
import { net } from "electron";
import { ErreurDictee, TERMES } from "./dictee-commun";

/**
 * Le moteur de dictée en ligne : ElevenLabs Scribe v2 Realtime. L'audio part
 * en flux par WebSocket ; le texte provisoire revient pendant qu'on parle, le
 * définitif à chaque blanc. Tout ce qui est propre à ElevenLabs est ici : pour
 * changer de service, on remplace ce module (electron/dictee.ts l'appelle).
 * La clé ne sert qu'à obtenir un jeton à usage unique (15 min) par dictée.
 */

const API = "https://api.elevenlabs.io";
const WS = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
/** Un blanc d'une seconde clôt un segment : assez pour une virgule, pas pour un point. */
const BLANC_SECONDES = "1.0";

/** Ce qu'une session renvoie à l'interface. */
export type EvenementDictee =
  | { type: "partiel"; texte: string }
  | { type: "definitif"; texte: string }
  | { type: "erreur"; code: ErreurDictee["code"]; message: string }
  | { type: "fin" };

const sessions = new Map<string, WebSocket>();

/** Un jeton à usage unique, valable 15 minutes. Sert aussi à vérifier une clé (rien n'est facturé). */
export async function jeton(cle: string): Promise<string> {
  let reponse: Response;
  try {
    reponse = await net.fetch(`${API}/v1/single-use-token/realtime_scribe`, { method: "POST", headers: { "xi-api-key": cle } });
  } catch {
    throw new ErreurDictee("reseau", "ElevenLabs est injoignable : vérifie la connexion.");
  }
  if (reponse.status === 401 || reponse.status === 403) throw new ErreurDictee("cle", "Clé ElevenLabs refusée : vérifie-la dans les Réglages.");
  if (reponse.status === 429) throw new ErreurDictee("quota", "ElevenLabs limite les demandes pour l’instant.");
  if (!reponse.ok) throw new ErreurDictee("service", `ElevenLabs a refusé la dictée (${reponse.status}).`);
  const corps = (await reponse.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof corps?.token !== "string") throw new ErreurDictee("service", "ElevenLabs n’a pas donné de jeton.");
  return corps.token;
}

/** Les erreurs de Scribe, en clair. */
function erreurScribe(type: string, detail: string): { code: ErreurDictee["code"]; message: string } {
  if (type === "auth_error") return { code: "cle", message: "Clé ElevenLabs refusée : vérifie-la dans les Réglages." };
  if (type === "quota_exceeded") return { code: "quota", message: "Quota ElevenLabs épuisé pour ce mois." };
  if (type === "rate_limited" || type === "commit_throttled" || type === "queue_overflow" || type === "resource_exhausted") {
    return { code: "quota", message: "ElevenLabs est saturé pour l’instant." };
  }
  if (type === "unaccepted_terms") return { code: "cle", message: "Accepte les conditions d’ElevenLabs sur elevenlabs.io, puis réessaie." };
  return { code: "service", message: `ElevenLabs : ${detail || type}.` };
}

/**
 * Ouvre une dictée : rend son identifiant une fois la session ouverte. Le
 * texte revient par `signaler`, au fil de la parole.
 */
export async function ouvrirSession(cle: string, signaler: (id: string, e: EvenementDictee) => void): Promise<string> {
  const parametres = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    token: await jeton(cle),
    audio_format: "pcm_16000",
    language_code: "fr",
    commit_strategy: "vad",
    vad_silence_threshold_secs: BLANC_SECONDES,
  });
  // Sans eux, « KLYRA » s'écrit « Clira » (un léger supplément par heure chez ElevenLabs).
  for (const terme of TERMES) parametres.append("keyterms", terme);
  const ws = new WebSocket(`${WS}?${parametres}`);
  const id = randomUUID();
  const emettre = (e: EvenementDictee) => signaler(id, e);
  let ouverte = false;
  let finie = false;
  const finir = () => {
    if (finie) return;
    finie = true;
    sessions.delete(id);
    emettre({ type: "fin" });
  };

  return new Promise((ok, ko) => {
    const delai = setTimeout(() => {
      ws.close();
      ko(new ErreurDictee("reseau", "ElevenLabs ne répond pas."));
    }, 10_000);
    ws.onmessage = (e) => {
      let m: { message_type?: string; text?: unknown; error?: unknown };
      try {
        m = JSON.parse(String(e.data)) as typeof m;
      } catch {
        return;
      }
      const texte = typeof m.text === "string" ? m.text : "";
      if (m.message_type === "session_started") {
        ouverte = true;
        clearTimeout(delai);
        sessions.set(id, ws);
        ok(id);
      } else if (m.message_type === "partial_transcript") emettre({ type: "partiel", texte });
      else if (m.message_type === "committed_transcript") emettre({ type: "definitif", texte });
      else if (m.message_type && m.message_type !== "warning" && "error" in m) {
        const erreur = erreurScribe(m.message_type, typeof m.error === "string" ? m.error : "");
        if (!ouverte) {
          clearTimeout(delai);
          ko(new ErreurDictee(erreur.code, erreur.message));
        } else emettre({ type: "erreur", ...erreur });
      }
    };
    ws.onerror = () => {
      if (!ouverte) {
        clearTimeout(delai);
        ko(new ErreurDictee("reseau", "ElevenLabs est injoignable : vérifie la connexion."));
      }
    };
    ws.onclose = (e) => {
      if (!ouverte) {
        // Refusée avant de commencer (jeton, paramètres) : la raison vient avec la fermeture.
        clearTimeout(delai);
        ko(new ErreurDictee(e.code === 1006 ? "reseau" : "service", e.reason ? `ElevenLabs : ${e.reason}.` : "ElevenLabs a fermé la dictée."));
        return;
      }
      // Une coupure qu'on n'a pas demandée : le réseau, le plus souvent.
      if (!finie && e.code !== 1000) emettre({ type: "erreur", code: "reseau", message: "Connexion à ElevenLabs perdue." });
      finir();
    };
  });
}

/** Un morceau d'audio (PCM 16 bits, 16 kHz) ; `valider` clôt le segment en cours. */
export function envoyerAudio(id: string, pcm: Uint8Array, valider: boolean) {
  const ws = sessions.get(id);
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: Buffer.from(pcm).toString("base64"), commit: valider, sample_rate: 16_000 }));
}

export function fermerSession(id: string) {
  sessions.get(id)?.close(1000);
  sessions.delete(id);
}

/** À la fermeture de l'app. */
export function fermerSessions() {
  for (const ws of sessions.values()) ws.close(1000);
  sessions.clear();
}
