import { evenementsEquipeEntre } from "@/lib/agenda-equipe";
import { cleJour, depuisCle, libelleJour } from "@/lib/dates";
import { libelleFrequence } from "@/lib/planning";
import type { Artefact, Categorie, Chat, Evenement, Project, Role, Routine, Tache } from "@/types/domain";
import type { Workflow } from "@/types/workflows";

/** Le calendrier donné aux agents : de la semaine passée aux deux mois qui viennent. */
const JOURS_AVANT = 7;
const JOURS_APRES = 60;
/** Les rappels faits restent visibles deux semaines, pour qu'un agent sache ce qui est réglé. */
const FAITS_JOURS = 14;

const PRIORITES = ["", " · priorité basse", " · priorité moyenne", " · priorité haute"];

const ligne = (...morceaux: (string | null | false | undefined)[]) => morceaux.filter(Boolean).join(" · ");
const note = (texte: string) => (texte.trim() ? `\n  ${texte.trim().replace(/\s+/g, " ").slice(0, 300)}` : "");

/**
 * Le planning de l'app (calendrier, rappels, routines) en Markdown, pour que les
 * agents le lisent : l'app l'écrit dans ~/.klyra/planning/planning.md à chaque
 * changement. Il ne quitte pas l'ordinateur.
 */
export function planningPourAgents(donnees: {
  evenements: Evenement[];
  taches: Tache[];
  categories: Categorie[];
  routines: Routine[];
  projects: Project[];
  roles: Role[];
  chats: Chat[];
  artefacts: Artefact[];
  workflows: Workflow[];
  /** Le prénom de la personne, pour le titre. */
  personne?: string;
}): string {
  const { evenements, taches, categories, routines, projects, roles, chats, artefacts, workflows, personne } = donnees;
  const maintenant = new Date();
  const debut = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - JOURS_AVANT);
  const fin = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + JOURS_APRES);
  const projet = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name : null);
  const agent = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  /* Calendrier : tes rendez-vous (les hebdomadaires répétés) et ceux de l'équipe, jour par jour. */
  const occurrences: Evenement[] = [...evenementsEquipeEntre(debut, fin)];
  for (const e of evenements) {
    if (!e.repete) {
      if (e.date >= cleJour(debut) && e.date < cleJour(fin)) occurrences.push(e);
      continue;
    }
    for (let d = depuisCle(e.date); d < fin; d.setDate(d.getDate() + 7)) {
      if (d >= debut) occurrences.push({ ...e, date: cleJour(d) });
    }
  }
  occurrences.sort((a, b) => (a.date + (a.debut ?? "")).localeCompare(b.date + (b.debut ?? "")));
  const calendrier = occurrences.map(
    (e) =>
      `- ${ligne(
        `${libelleJour(e.date)} (${e.date})`,
        e.debut ? `${e.debut}${e.fin ? `–${e.fin}` : ""}` : "toute la journée",
        `**${e.titre}**`,
        e.equipe && "rendez-vous d’équipe",
        e.repete && !e.equipe && "chaque semaine",
        projet(e.projectId) && `projet ${projet(e.projectId)}`,
      )}${note(e.notes)}`,
  );

  /* Rappels : à faire d'abord, par catégorie ; puis ce qui a été fait récemment. */
  const limiteFaits = Date.now() - FAITS_JOURS * 86_400_000;
  const rappel = (t: Tache) =>
    `- ${t.faite ? "[x]" : "[ ]"} ${ligne(
      `**${t.titre}**${PRIORITES[t.priorite]}`,
      t.signalee && "signalé",
      t.date && `échéance ${t.date}${t.fin ? ` au ${t.fin}` : ""}${t.heure ? ` à ${t.heure}` : ""}`,
      projet(t.projectId) && `projet ${projet(t.projectId)}`,
      t.faite && t.faiteLe && `fait le ${t.faiteLe.slice(0, 10)}`,
    )}${note(t.notes)}`;
  const parCategorie = categories.map((c) => {
    const liste = taches
      .filter((t) => t.liste === c.id && (!t.faite || (t.faiteLe && new Date(t.faiteLe).getTime() > limiteFaits)))
      .sort((a, b) => Number(a.faite) - Number(b.faite) || (a.date ?? "9").localeCompare(b.date ?? "9"));
    return liste.length ? `### ${c.nom}\n${liste.map(rappel).join("\n")}` : "";
  });

  /* Routines : ce qui se relance tout seul, et quand. */
  const lignesRoutines = routines.map(
    (r) =>
      `- ${ligne(
        `**${r.nom}**`,
        r.active ? "active" : "en pause",
        libelleFrequence(r.frequence),
        r.active && r.frequence.type !== "manuel" && `prochaine le ${r.prochaine.slice(0, 16).replace("T", " à ")}`,
        `confiée à ${agent(r.roleId)}`,
        projet(r.projectId) && `projet ${projet(r.projectId)}`,
      )}${note(r.consigne)}`,
  );

  /* Le reste de l'app : projets, conversations, artefacts, workflows. */
  const lignesProjets = projects.map(
    (p) => `- ${ligne(`**${p.name}**`, p.subtitle, `statut ${p.status}`, `dossier ${p.folder}`, p.previewUrl && `aperçu ${p.previewUrl}`)}${note(p.brief)}`,
  );
  const lignesChats = [...chats]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 40)
    .map((c) =>
      `- ${ligne(
        `**${c.title}**`,
        c.kind === "direct" ? `conversation directe avec ${agent(c.roleIds[0] ?? "principal")}` : `projet ${projet(c.projectId) ?? "?"}`,
        `dernier échange le ${c.updatedAt.slice(0, 16).replace("T", " à ")}`,
      )}`,
    );
  const lignesArtefacts = artefacts.map((a) => `- ${ligne(`**${a.titre}**`, a.url, projet(a.projectId) && `projet ${projet(a.projectId)}`)}${note(a.description)}`);
  const lignesWorkflows = workflows.map((w) => `- ${ligne(`**${w.titre}**`, projet(w.projectId) && `projet ${projet(w.projectId)}`, `modifié le ${w.majLe.slice(0, 10)}`)}`);

  return [
    `# ${personne ? `${personne} : ` : ""}son calendrier, ses rappels, ses routines et ses projets`,
    "",
    `Tout ce qu’il y a dans son app, mis à jour le ${maintenant.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}. Lecture seule : pour changer quelque chose, dis-lui quoi faire dans l’app.`,
    "",
    `## Calendrier (du ${cleJour(debut)} au ${cleJour(fin)})`,
    calendrier.length ? calendrier.join("\n") : "Aucun rendez-vous.",
    "",
    "## Rappels",
    parCategorie.filter(Boolean).join("\n\n") || "Aucun rappel.",
    "",
    "## Routines (tâches planifiées des agents)",
    lignesRoutines.length ? lignesRoutines.join("\n") : "Aucune routine.",
    "",
    "## Projets",
    lignesProjets.join("\n") || "Aucun projet.",
    "",
    "## Conversations (les 40 plus récentes)",
    lignesChats.join("\n") || "Aucune conversation.",
    "",
    "## Artefacts (pages publiées sur claude.ai)",
    lignesArtefacts.join("\n") || "Aucun artefact.",
    "",
    "## Workflows",
    lignesWorkflows.join("\n") || "Aucun workflow.",
    "",
  ].join("\n");
}
