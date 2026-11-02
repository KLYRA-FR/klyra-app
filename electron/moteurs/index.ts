import { claude } from "./claude";
import { creerRegistre } from "./registre";

/** Les moteurs que l'app lance sur ce poste. Sans choix, l'agent travaille avec Claude Code. */
export const moteurs = creerRegistre([claude], "claude");
