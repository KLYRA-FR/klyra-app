import type { CodeErreurDictee } from "@/lib/bridge";
import type { Moteur, PontDictee, Rappels } from "./moteur";
import { TRAME, versPcm16 } from "./segmenteur";

/** Une trame de silence : la dernière, qui valide le segment en cours. */
const SILENCE = new Uint8Array(TRAME * 2);
/** Après la validation finale, le texte définitif arrive vite ; au-delà, on garde le provisoire. */
const ATTENTE_FIN_MS = 4000;

/**
 * ElevenLabs Scribe v2 Realtime : l'audio part en flux (par le process
 * principal, qui garde la clé), le texte provisoire revient pendant qu'on
 * parle, le définitif à chaque blanc. Les trames d'avant l'ouverture de la
 * session attendent : rien n'est perdu au démarrage.
 */
export class MoteurElevenLabs implements Moteur {
  readonly nom = "elevenlabs";
  private id: string | null = null;
  private enAttente: Uint8Array[] = [];
  private ouverture: Promise<boolean>;
  private dernierPartiel = "";
  private finDuSegment: (() => void) | null = null;
  private fini = false;
  private arreterEcoute: () => void;

  constructor(
    private pont: PontDictee,
    private rappels: Rappels,
  ) {
    this.arreterEcoute = pont.onEvenement((id, e) => {
      if (id !== this.id || this.fini) return;
      if (e.type === "partiel") {
        if (e.texte === this.dernierPartiel) return;
        this.dernierPartiel = e.texte;
        rappels.partiel(e.texte);
      } else if (e.type === "definitif") {
        this.dernierPartiel = "";
        if (e.texte.trim()) rappels.definitif(e.texte);
        this.finDuSegment?.();
      } else if (e.type === "erreur") {
        this.fermer();
        rappels.erreur(e.code, e.message);
      }
    });
    this.ouverture = pont.ouvrir().then((r) => {
      if (this.fini) {
        if (r.ok) void pont.fermer(r.data);
        return false;
      }
      if (!r.ok) {
        this.fermer();
        rappels.erreur(r.code as CodeErreurDictee, r.message);
        return false;
      }
      this.id = r.data;
      for (const pcm of this.enAttente) pont.envoyer(r.data, pcm, false);
      this.enAttente = [];
      return true;
    });
  }

  trame(trame: Float32Array) {
    if (this.fini) return;
    const pcm = versPcm16(trame);
    if (this.id) this.pont.envoyer(this.id, pcm, false);
    else this.enAttente.push(pcm);
  }

  async terminer() {
    if (!(await this.ouverture) || !this.id || this.fini) return;
    // Rien de provisoire en suspens : tout est déjà définitif.
    if (this.dernierPartiel.trim()) {
      const arrive = new Promise<void>((ok) => (this.finDuSegment = ok));
      this.pont.envoyer(this.id, SILENCE, true);
      await Promise.race([arrive, new Promise((ok) => setTimeout(ok, ATTENTE_FIN_MS))]);
      // Pas de réponse à temps : le dernier provisoire devient définitif, rien n'est perdu.
      if (this.dernierPartiel.trim() && !this.fini) this.rappels.definitif(this.dernierPartiel);
    }
    this.fermer();
  }

  annuler() {
    this.fermer();
  }

  /** Le texte provisoire en suspens (gardé si la connexion tombe). */
  get provisoire(): string {
    return this.dernierPartiel;
  }

  private fermer() {
    if (this.fini) return;
    this.fini = true;
    this.arreterEcoute();
    if (this.id) void this.pont.fermer(this.id);
  }
}
