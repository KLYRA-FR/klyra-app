import type { Moteur, PontDictee, Rappels } from "./moteur";
import { Segmenteur, versPcm16, versWav } from "./segmenteur";

/**
 * Whisper sur l'ordinateur : le segment en cours est transcrit régulièrement
 * (texte provisoire), puis une dernière fois quand un blanc le clôt (texte
 * définitif). Un seul calcul à la fois : on ne demande un provisoire que si
 * Whisper est libre, et pas plus souvent que le temps qu'il a mis la dernière
 * fois, pour qu'un définitif n'attende jamais longtemps.
 */
export class MoteurLocal implements Moteur {
  readonly nom = "local";
  private segmenteur = new Segmenteur();
  private file: Promise<void> = Promise.resolve();
  private definitifsEnAttente = 0;
  private partielEnCours = false;
  private prochainPartiel = 0;
  /** Change à chaque segment clos : un provisoire en retard est ignoré. */
  private generation = 0;
  private annule = false;

  constructor(
    private pont: PontDictee,
    private rappels: Rappels,
    /** Le texte qui précède, pour que Whisper continue la phrase juste. */
    private contexte: () => string,
  ) {}

  trame(trame: Float32Array) {
    if (this.annule) return;
    const action = this.segmenteur.ajouter(trame);
    if (action === "definitif") this.clore();
    else if (action === "partiel") this.provisoire();
  }

  async terminer() {
    if (this.segmenteur.aDeLaParole) this.clore();
    await this.file;
  }

  annuler() {
    this.annule = true;
  }

  private async transcrire(audio: Float32Array): Promise<string | null> {
    const r = await this.pont.transcrire(versWav(versPcm16(audio)), this.contexte());
    if (this.annule) return null;
    if (!r.ok) {
      this.annule = true;
      this.rappels.erreur("local", r.message);
      return null;
    }
    return r.data;
  }

  private provisoire() {
    if (this.partielEnCours || this.definitifsEnAttente || performance.now() < this.prochainPartiel) return;
    this.partielEnCours = true;
    const generation = this.generation;
    const debut = performance.now();
    void this.transcrire(this.segmenteur.segment()).then((texte) => {
      this.partielEnCours = false;
      this.prochainPartiel = performance.now() + (performance.now() - debut);
      if (texte !== null && generation === this.generation) this.rappels.partiel(texte);
    });
  }

  private clore() {
    const audio = this.segmenteur.couper();
    this.generation++;
    this.definitifsEnAttente++;
    this.file = this.file.then(async () => {
      const texte = await this.transcrire(audio);
      this.definitifsEnAttente--;
      if (texte !== null) this.rappels.definitif(texte);
    });
  }
}
