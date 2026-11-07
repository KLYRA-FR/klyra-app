import fs from "node:fs/promises";
import path from "node:path";
import { appliquerChoixPriseEnMain, debutPriseEnMain, validerPriseEnMain, type PriseEnMain } from "./prise-en-main-modele.ts";

/** Un fichier par poste, écrit en série et atomiquement. Aucune migration de conversations. */
export class StockagePriseEnMain {
  private courant: PriseEnMain | null = null;
  private file: Promise<unknown> = Promise.resolve();
  private readonly fichier: string;
  private readonly nouveau: () => boolean;
  constructor(fichier: string, nouveau: () => boolean) { this.fichier = fichier; this.nouveau = nouveau; }

  private async charger(): Promise<PriseEnMain> {
    if (this.courant) return this.courant;
    try {
      this.courant = validerPriseEnMain(JSON.parse(await fs.readFile(this.fichier, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Impossible de lire ta prise en main. Tes données ont été conservées ; réessaie.");
      await this.garder(debutPriseEnMain(this.nouveau()));
    }
    return this.courant!;
  }

  private async garder(etat: PriseEnMain): Promise<void> {
    await fs.mkdir(path.dirname(this.fichier), { recursive: true });
    const temporaire = `${this.fichier}.${process.pid}.tmp`;
    await fs.writeFile(temporaire, `${JSON.stringify(etat, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaire, this.fichier);
    this.courant = etat;
  }

  private serialiser<T>(faire: () => Promise<T>): Promise<T> {
    const suite = this.file.then(faire, faire);
    this.file = suite.catch(() => {});
    return suite;
  }

  lire(): Promise<PriseEnMain> {
    return this.serialiser(async () => structuredClone(await this.charger()));
  }

  ecrire(choix: unknown): Promise<PriseEnMain> {
    return this.serialiser(async () => {
      const suivant = appliquerChoixPriseEnMain(await this.charger(), choix);
      await this.garder(suivant);
      return structuredClone(suivant);
    });
  }
}
