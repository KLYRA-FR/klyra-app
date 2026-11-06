/* Veilleuse v2 — le contenu de la page.
   Vrai (klyra-app à 5b57953) : noms, rôles, teintes et dessins des agents, libellés d'étapes et d'accès.
   Fictif : le serveur de l'atelier, Mme Perrault, tous les tickets et toutes les conversations. */

  /* AGENT_PASTELS, src/data/agent-palettes.ts */
  const PASTELS = {
    "bleu-k1": { haut: "#c7ddff", bas: "#ebf3fe", accent: "#769edf", encre: "#4468a2" },
    "bleu-k2": { haut: "#b7e3ff", bas: "#e6f5fe", accent: "#55a7d9", encre: "#1c6f9d" },
    "bleu-k3": { haut: "#b0e7ef", bas: "#e1f7fa", accent: "#47afbd", encre: "#037683" },
    violet: { haut: "#dbd6ff", bas: "#f2f0fe", accent: "#9e91da", encre: "#695c9e" },
    rose: { haut: "#f5cdf1", bas: "#fdecfa", accent: "#c484bf", encre: "#8a5086" },
    rouge: { haut: "#ffcfcc", bas: "#ffeeec", accent: "#dd817f", encre: "#9f4c4d" },
    orange: { haut: "#ffd0c5", bas: "#feefea", accent: "#dc8372", encre: "#9e4f41" },
    "orange-k2": { haut: "#fbd4b8", bas: "#feefe4", accent: "#cd8f62", encre: "#915a31" },
    jaune: { haut: "#f3eec1", bas: "#f5f3e2", accent: "#aba15c", encre: "#756a2a" },
    ocre: { haut: "#f0dab4", bas: "#fbf1e1", accent: "#bd995a", encre: "#846328" },
    vert: { haut: "#b1ebd4", bas: "#e1f9ee", accent: "#47b592", encre: "#067c5e" },
    "vert-k2": { haut: "#cde6bb", bas: "#ecf7e4", accent: "#85ad68", encre: "#527537" },
  };

  const AGENTS = [
    { id: "principal", nom: "Assistant", tag: "Ton assistant", teinte: "bleu-k1", quoi: "Il confie à chaque agent la partie qui le concerne, il suit, et il te rend le résultat vérifié." },
    { id: "designer", nom: "Iris", tag: "Design", teinte: "violet", quoi: "Parcours et maquettes." },
    { id: "dev", nom: "Hugo", tag: "Développement", teinte: "bleu-k2", quoi: "Sites, apps, correctifs." },
    { id: "qa", nom: "Agathe", tag: "Relecture", teinte: "vert", quoi: "Textes, parcours, code." },
    { id: "commercial", nom: "Thomas", tag: "Ventes", teinte: "orange", quoi: "Devis, propositions, relances." },
    { id: "val", nom: "Val", tag: "Mails", teinte: "bleu-k3", quoi: "Boîte mail, relation client." },
    { id: "growth", nom: "Sacha", tag: "Croissance", teinte: "jaune", quoi: "Prospection, acquisition." },
    { id: "stratege", nom: "Mathilde", tag: "Stratégie", teinte: "ocre", quoi: "Positionnement, offre, plan." },
    { id: "redacteur", nom: "Olivier", tag: "Rédaction", teinte: "rouge", quoi: "Posts, pages, newsletters." },
    { id: "motion", nom: "Jules", tag: "Animation", teinte: "rose", quoi: "Vidéos, animations." },
    { id: "prompty", nom: "Lou", tag: "Consignes", teinte: "orange-k2", quoi: "Prompts, fiches d'agents." },
    { id: "diego-discord-ops", nom: "Diego", tag: "Organisation", teinte: "vert-k2", quoi: "Déploiements, sauvegardes." },
  ];

  /* Les quatre conversations de la démo du hero : textes d'Olivier. */
  const DEMOS = [
    {
      sel: "Page web",
      moi: "La page d'accueil est confuse, et le bouton ne se voit pas.",
      rep: "Iris propose la page. Hugo la construit, Agathe la relit, et je te rends le résultat.",
      taches: [["designer", "Propose la page"], ["dev", "Construit la page"], ["qa", "Relit avant toi"]],
    },
    {
      sel: "Devis à relancer",
      moi: "Relance les devis qui sont restés sans réponse.",
      rep: "Thomas reprend les devis sans réponse. Il prépare les relances, et je te les apporte.",
      taches: [["commercial", "Repère les devis sans réponse"], ["commercial", "Met de côté ceux déjà conclus"], ["commercial", "Écrit chaque relance"], ["commercial", "Te les prépare"]],
    },
    {
      sel: "Boîte support",
      moi: "Trie les mails du support et prépare les réponses.",
      rep: "Val ouvre la boîte et prépare les réponses. Je te les apporte, avec ce qui bloque.",
      taches: [["val", "Lit les mails arrivés"], ["val", "Range les demandes"], ["val", "Écrit les réponses"], ["val", "Signale ce qui bloque"]],
    },
    {
      sel: "La newsletter",
      moi: "Prépare la newsletter du mois.",
      rep: "Mathilde choisit le sujet, Olivier écrit. Je te rends le texte.",
      taches: [["stratege", "Choisit le sujet"], ["stratege", "Pose le plan"], ["redacteur", "Écrit le texte"], ["redacteur", "Te le remet"]],
    },
  ];

  /* Le tableau : 13 tickets, 5 colonnes réelles de l'app (src/lib/tickets.ts). Les relances arrivent en À valider. */
  const TICKETS = [
    { etape: "a-faire", agent: "stratege", titre: "Plan de la campagne d'avril", projet: "Marketing", heure: "Lundi" },
    { etape: "en-cours", agent: "growth", titre: "Veille des prix : 18 fournisseurs", projet: "Achats", heure: "Depuis ce matin", prog: [11, 18] },
    { etape: "bloque", agent: "motion", titre: "Animation de la page abonnements", projet: "Site", heure: "Hier", raison: "Attend ta validation de la maquette" },
    { etape: "a-valider", agent: "designer", titre: "Maquette de la page abonnements", projet: "Site", heure: "Hier", detail: "3 écrans, 2 options de grille" },
    { etape: "a-valider", agent: "dev", titre: "Mettre la page en ligne", projet: "Site", heure: "Ce matin", detail: "Relue par Agathe" },
    { etape: "a-valider", agent: "val", titre: "Réponse à Mme Perrault", projet: "Support", heure: "Ce matin", detail: "Commande 48213 retrouvée" },
    { etape: "a-valider", agent: "commercial", titre: "Envoyer les 11 relances", projet: "Devis", heure: "Ce matin", detail: "11 brouillons, 3 devis mis de côté", pr: 1 },
    { etape: "termine", agent: "qa", titre: "Relecture de la page abonnements", projet: "Site", heure: "Ce matin" },
    { etape: "termine", agent: "diego-discord-ops", titre: "Sauvegarde du serveur", projet: "Serveur", heure: "Cette nuit" },
    { etape: "termine", agent: "redacteur", titre: "Article du mois", projet: "Marketing", heure: "Hier" },
    { etape: "termine", agent: "stratege", titre: "Brief de la newsletter d'avril", projet: "Marketing", heure: "Hier" },
    { etape: "termine", agent: "prompty", titre: "Modèle de résumé client", projet: "Support", heure: "Hier" },
    { etape: "termine", agent: "val", titre: "Tri du support : 37 mails, 6 brouillons", projet: "Support", heure: "Hier" },
  ];

  const COLONNES = [
    { id: "a-faire", nom: "À faire" },
    { id: "en-cours", nom: "En cours" },
    { id: "bloque", nom: "Bloqué" },
    { id: "a-valider", nom: "À valider" },
    { id: "termine", nom: "Terminé" },
  ];

  const compte = (id) => TICKETS.filter((t) => t.etape === id).length;

  export { PASTELS, AGENTS, DEMOS, TICKETS, COLONNES, compte };
