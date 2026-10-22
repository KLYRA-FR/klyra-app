import type { Acces } from "@/lib/bridge";

/** Les trois niveaux d'accès des agents. */
export const NIVEAUX_ACCES: { id: Acces; nom: string; detail: string }[] = [
  {
    id: "demander",
    nom: "Me demander à chaque fois",
    detail: "L’agent lit seul. Pour modifier un fichier ou lancer une commande, il te demande.",
  },
  {
    id: "projet",
    nom: "Le projet en autonomie",
    detail: "Il modifie les fichiers du projet et lance les commandes de travail (pnpm, git en lecture, node…) seul. Il te demande pour le reste.",
  },
  {
    id: "tout",
    nom: "Tout accepter",
    detail: "Rien ne t’est demandé : chaque commande est acceptée d’office. Plus rapide, à réserver aux projets que tu maîtrises.",
  },
];
