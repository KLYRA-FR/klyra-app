"use client";

import { useEffect, useState } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useAgents } from "@/lib/agents";
import { getBridge, unwrap, type Reponse } from "@/lib/bridge";
import { dansEspace } from "@/lib/lieux";
import { useReglagesAgents } from "@/lib/reglages-agents";
import { useWorkspace } from "@/lib/workspace";
import { definirSkill, figerChoix, skillRecue, type OrigineSkill } from "../../../electron/skills-par-agent";
import { Erreur, Groupe, Interrupteur, Ligne, SeulementBureau } from "./ui";

interface SkillVue {
  nom: string;
  description: string;
  origine: OrigineSkill;
  lieu: string;
}

/**
 * Réglages › Agents : un interrupteur par skill et par agent.
 * Le catalogue vient du process principal (poste, et projet de ce PC s’il y en a un).
 */
export function SkillsParAgent() {
  const { roles } = useAgents();
  const { state } = useWorkspace();
  const { lieu, reglages, erreur, changerSkills } = useReglagesAgents();
  const bridge = getBridge();
  const pontVps = bridge?.agents.vps;
  /* Les skills du serveur affiché, et les projets de ce serveur. */
  const pont = lieu && pontVps
    ? (dossier: string | null) => pontVps(lieu, "skills", { dossier }) as Promise<Reponse<{ poste: { nom: string; description: string }[]; projet: { nom: string; description: string }[] }>>
    : bridge?.reglages?.skillsDisponibles;
  const projets = state.projects.filter((p) => p.folder && dansEspace(p.lieu, lieu));
  const [projetId, setProjetId] = useState<string | null>(null);
  const projet = projets.find((p) => p.id === projetId) ?? projets[0] ?? null;
  const [agentId, setAgentId] = useState("principal");
  const agent = roles.some((r) => r.id === agentId) ? agentId : (roles[0]?.id ?? "principal");
  const [lu, setLu] = useState<{ dossier: string | null; poste: { nom: string; description: string }[]; projet: { nom: string; description: string }[]; reprise?: { fiches: string[]; skills: string[] } | null } | null>(null);
  const [echec, setEchec] = useState<string | null>(null);
  const [relecture, setRelecture] = useState(0);
  const [importEnCours, setImportEnCours] = useState(false);
  const [importPosteEnCours, setImportPosteEnCours] = useState(false);
  const [compte, setCompte] = useState<string | null>(null);
  /* Importer depuis un dossier ou depuis ~/.claude/skills, c'est sur ce PC. Sur un VPS : envoyer celles de ce PC. */
  const pontImport = lieu ? undefined : bridge?.reglages?.importerSkills;
  const pontPoste = lieu ? undefined : bridge?.reglages?.importerSkillsPoste;
  const envoyerDuPc = async () => {
    if (!lieu || !bridge?.agents.skillsDuPcVersVps) return;
    setEchec(null);
    setImportEnCours(true);
    try {
      const { ajoutees } = unwrap(await bridge.agents.skillsDuPcVersVps(lieu));
      setCompte(ajoutees.length ? `${ajoutees.length} skill${ajoutees.length > 1 ? "s" : ""} de ce PC envoyée${ajoutees.length > 1 ? "s" : ""} sur ce serveur.` : "Aucune skill allumée sur ce PC à envoyer.");
      setRelecture((n) => n + 1);
    } catch (e) {
      setEchec(e instanceof Error ? e.message : String(e));
    } finally {
      setImportEnCours(false);
    }
  };

  useEffect(() => {
    if (!pont) return;
    let actif = true;
    const dossier = projet?.folder ?? null;
    void pont(dossier)
      .then((reponse) => {
        if (!actif) return;
        setLu({ dossier, ...unwrap(reponse) });
        setEchec(null);
      })
      .catch((e: unknown) => {
        if (!actif) return;
        setLu({ dossier, poste: [], projet: [] });
        setEchec(e instanceof Error ? e.message : String(e));
      });
    return () => {
      actif = false;
    };
    // `pont` change à chaque rendu sur un VPS : on suit le serveur, pas la fonction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lieu, projet?.folder, relecture]);

  const annoncer = (resultat: { ajoutees: string[]; dejaLa: string[] } | null, vide: string) => {
    if (!resultat) return;
    const morceaux: string[] = [];
    if (resultat.ajoutees.length) morceaux.push(`${resultat.ajoutees.length} ajoutée${resultat.ajoutees.length > 1 ? "s" : ""}`);
    if (resultat.dejaLa.length) morceaux.push(`${resultat.dejaLa.length} déjà là`);
    setCompte(
      morceaux.length
        ? `${morceaux.join(", ")}. Une skill importée reste éteinte tant que tu ne l’allumes pas. Le poste n’est pas modifié.`
        : vide,
    );
    setRelecture((n) => n + 1);
  };

  const importer = async () => {
    if (!pontImport) return;
    setImportEnCours(true);
    setEchec(null);
    try {
      annoncer(unwrap(await pontImport()), "Aucune skill à importer dans ce dossier.");
    } catch (e: unknown) {
      setEchec(e instanceof Error ? e.message : String(e));
    } finally {
      setImportEnCours(false);
    }
  };

  const importerPoste = async () => {
    if (!pontPoste) return;
    setImportPosteEnCours(true);
    setEchec(null);
    try {
      annoncer(unwrap(await pontPoste()), "Aucune skill nouvelle dans ~/.claude/skills.");
    } catch (e: unknown) {
      setEchec(e instanceof Error ? e.message : String(e));
    } finally {
      setImportPosteEnCours(false);
    }
  };

  const dossier = projet?.folder ?? null;
  const catalogue = lu?.dossier === dossier ? lu : null;
  const lecture = !pont ? null : catalogue ? echec : "Lecture des skills…";
  const poste = catalogue?.poste ?? [];
  const lignes: SkillVue[] = [
    ...poste.map((s) => ({ ...s, origine: "poste" as const, lieu: "KLYRA" })),
    ...(catalogue?.projet ?? [])
      .filter((s) => !poste.some((p) => p.nom === s.nom))
      .map((s) => ({ ...s, origine: "projet" as const, lieu: projet?.name ?? "Projet" })),
  ];

  const changer = async (skill: SkillVue, recue: boolean) => {
    if (!reglages) return;
    const agents = roles.map((r) => r.id);
    const base = reglages.skillsParAgent.fige ? reglages.skillsParAgent : figerChoix(reglages.skillsParAgent, agents.length ? agents : ["principal"], poste.map((s) => s.nom));
    await changerSkills(definirSkill(base, agent, skill.nom, skill.origine, recue));
  };

  return (
    <Groupe
      titre="Skills de chaque agent"
      description="Un agent lancé par KLYRA ne reçoit que les skills allumées pour lui. Au lancement, KLYRA prépare pour Claude un dossier à part : les fiches de l’app et les skills de l’app, copiées une fois depuis le poste, puis lues ici. Celles qui sont déjà là restent allumées ; une skill personnelle nouvelle, ou un agent nouveau, ne les reçoit pas tant que tu ne l’allumes pas. Rien n’est retiré de ton poste. Une skill ajoutée ensuite dans ~/.claude/skills n’est pas reprise toute seule : « Importer depuis le poste » la reprend, éteinte. Le même nom est coupé aussi sur un serveur relié. Un agent appelé dans la session reçoit les skills de celui qui l’a lancé."
    >
      <Ligne
        id="skills-par-agent"
        libelle="Ce que reçoit chaque agent"
        description="Les skills d’un projet apparaissent quand un projet de ce PC est ouvert. Un même nom, dans l’app et dans le projet, n’a qu’un interrupteur."
        pile
      >
        {!pont ? (
          <SeulementBureau />
        ) : (
          <div className="flex w-full flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <ListeDeroulante
                variante="champ"
                libelle="Agent"
                value={agent}
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
                onChange={setAgentId}
                className="min-w-[180px]"
              />
              {projets.length > 1 && (
                <ListeDeroulante
                  variante="champ"
                  libelle="Projet"
                  value={projet?.id ?? ""}
                  options={projets.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={setProjetId}
                  className="min-w-[180px]"
                />
              )}
            </div>
            {lieu && bridge?.agents.skillsDuPcVersVps && (
              <div className="flex flex-wrap items-center gap-2">
                <Bouton type="button" variant="blanc" taille="compact" disabled={importEnCours} onClick={() => void envoyerDuPc()}>
                  {importEnCours ? "Envoi…" : "Envoyer les skills allumées de ce PC"}
                </Bouton>
                {compte && <span className="text-ui-xs text-texte-tertiaire">{compte}</span>}
              </div>
            )}
            {(pontImport || pontPoste) && (
              <div className="flex flex-wrap items-center gap-2">
                {pontPoste && (
                  <Bouton type="button" variant="blanc" taille="compact" disabled={importPosteEnCours || importEnCours} onClick={() => void importerPoste()}>
                    {importPosteEnCours ? "Import…" : "Importer depuis le poste"}
                  </Bouton>
                )}
                {pontImport && (
                  <Bouton type="button" variant="blanc" taille="compact" disabled={importEnCours || importPosteEnCours} onClick={() => void importer()}>
                    {importEnCours ? "Import…" : "Importer un dossier"}
                  </Bouton>
                )}
                {compte && <span className="text-ui-xs text-texte-tertiaire">{compte}</span>}
              </div>
            )}
            {catalogue?.reprise && (
              <span className="text-ui-xs text-texte-tertiaire">
                Reprises dans KLYRA, sans rien supprimer du poste : {catalogue.reprise.fiches.length} fiche{catalogue.reprise.fiches.length > 1 ? "s" : ""}, {catalogue.reprise.skills.length} skill{catalogue.reprise.skills.length > 1 ? "s" : ""}.
              </span>
            )}
            {lecture && <span className="text-ui-xs text-texte-tertiaire">{lecture}</span>}
            {erreur && <Erreur>{erreur}</Erreur>}
            {!lecture && lignes.length === 0 && (
              <span className="text-ui-xs text-texte-tertiaire">
                {projets.length === 0
                  ? "Aucune skill personnelle. Les skills d’un projet apparaissent ici quand un projet de ce PC est ouvert dans l’app."
                  : "Aucune skill personnelle, et aucune skill dans le projet choisi."}
              </span>
            )}
            {lignes.length > 0 && (
              <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
                {lignes.map((skill) => {
                  const actif = reglages ? skillRecue(reglages.skillsParAgent, agent, skill.nom, skill.origine) : true;
                  return (
                    <li key={`${skill.origine}:${skill.nom}`} className="flex items-center gap-3 py-2.5">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-ui-s font-medium text-texte-principal">
                          {skill.nom} <span className="font-normal text-texte-tertiaire">· {skill.lieu}</span>
                        </span>
                        <span className="truncate text-ui-xs text-texte-tertiaire">{skill.description || "Sans description."}</span>
                      </span>
                      <Interrupteur
                        actif={actif}
                        disabled={!reglages}
                        libelle={`${actif ? "Retirer" : "Donner"} ${skill.nom} à ${roles.find((r) => r.id === agent)?.name ?? "cet agent"}`}
                        onChange={(valeur) => void changer(skill, valeur)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Ligne>
    </Groupe>
  );
}
