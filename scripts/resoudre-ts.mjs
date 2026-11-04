/**
 * Les modules Electron s'importent sans extension (Next et tsc).
 * Node, lancé avec --experimental-strip-types, ne la rajoute pas : ce chargeur
 * essaie le fichier `.ts` quand le spécificateur relatif est introuvable.
 *   node --experimental-strip-types --import ./scripts/resoudre-ts.mjs …
 */
import { register } from "node:module";

register("./resoudre-ts-crochet.mjs", import.meta.url);
