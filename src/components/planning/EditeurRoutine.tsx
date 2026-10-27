"use client";

import { useState, type FormEvent } from "react";
import { Input, Select, Textarea } from "klyra-ui";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { cn } from "@/lib/cn";
import { libelleFrequence, NOMS_JOURS, prochainPassage } from "@/lib/planning";
import { useProjects, useRoles } from "@/lib/workspace";
import type { Frequence, Routine } from "@/types/domain";

const TYPES: { id: Frequence["type"]; nom: string }[] = [
  { id: "manuel", nom: "À la demande" },
  { id: "heure", nom: "Toutes les heures" },
  { id: "jour", nom: "Chaque jour" },
  { id: "jours-ouvres", nom: "Jours ouvrés" },
  { id: "semaine", nom: "Chaque semaine" },
  { id: "mois", nom: "Chaque mois" },
];

const dateLongue = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Une tâche vide, ou préremplie (suggestions). */
export function nouvelleRoutine(partiel: Partial<Routine> = {}): Routine {
  const frequence: Frequence = partiel.frequence ?? { type: "jour", heure: "09:00" };
  return {
    id: crypto.randomUUID(),
    nom: "",
    roleId: "principal",
    consigne: "",
    projectId: null,
    active: true,
    creeLe: new Date().toISOString(),
    historique: [],
    ...partiel,
    frequence,
    prochaine: prochainPassage(frequence, new Date()).toISOString(),
  };
}

/** Créer ou modifier une tâche planifiée : qui, quoi, quand, où. */
export function EditeurRoutine({
  initiale,
  onEnregistrer,
  onAnnuler,
}: {
  initiale: Routine;
  onEnregistrer: (routine: Routine) => void;
  onAnnuler: () => void;
}) {
  const roles = useRoles();
  const projects = useProjects();
  const [r, setR] = useState(initiale);
  const [essai, setEssai] = useState(false);
  const f = r.frequence;
  const heure = "heure" in f ? f.heure : "09:00";
  const jour = "jour" in f ? f.jour : 1;

  const changerType = (type: Frequence["type"]) => {
    const frequence: Frequence =
      type === "heure" || type === "manuel"
        ? { type }
        : type === "semaine"
          ? { type, jour: f.type === "semaine" ? f.jour : 1, heure }
          : type === "mois"
            ? { type, jour: f.type === "mois" ? f.jour : 1, heure }
            : { type, heure };
    setR({ ...r, frequence });
  };
  const changerHeure = (h: string) => {
    if (f.type !== "heure" && f.type !== "manuel") setR({ ...r, frequence: { ...f, heure: h } });
  };
  const changerJour = (j: number) => {
    if (f.type === "semaine" || f.type === "mois") setR({ ...r, frequence: { ...f, jour: j } });
  };

  const erreurs = {
    nom: r.nom.trim() ? undefined : "Donne-lui un nom.",
    consigne: r.consigne.trim() ? undefined : "Écris ce que l’agent doit faire.",
  };
  const prochaine = prochainPassage(f, new Date());

  const enregistrer = (e: FormEvent) => {
    e.preventDefault();
    setEssai(true);
    if (erreurs.nom || erreurs.consigne) return;
    onEnregistrer({ ...r, nom: r.nom.trim(), consigne: r.consigne.trim(), prochaine: prochaine.toISOString() });
  };

  return (
    <form onSubmit={enregistrer} className="klyra-carte-flottante @container flex flex-col gap-5 rounded-lg p-5">
      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <Champ label="Nom" erreur={essai ? erreurs.nom : undefined}>
          <Input
            size="sm"
            value={r.nom}
            placeholder="Revue des mails du matin"
            onChange={(e) => setR({ ...r, nom: e.target.value })}
            className={CHAMP}
          />
        </Champ>
        <Champ label="Agent">
          <Select
            size="sm"
            value={r.roleId}
            options={roles.map((role) => ({ value: role.id, label: `${role.name} · ${role.tag}` }))}
            onChange={(e) => setR({ ...r, roleId: e.target.value })}
            className={CHAMP}
          />
        </Champ>
        <Champ
          label="Consigne"
          erreur={essai ? erreurs.consigne : undefined}
          aide="Ce qu’il reçoit à chaque passage, comme un message que tu lui écrirais."
          className="@2xl:col-span-2"
        >
          <Textarea
            size="sm"
            autoGrow
            value={r.consigne}
            placeholder="Trie les mails arrivés depuis hier et prépare-moi un récap de dix lignes."
            onChange={(e) => setR({ ...r, consigne: e.target.value })}
            className={cn(CHAMP, "min-h-[88px]")}
          />
        </Champ>
      </div>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-ui-s font-medium text-texte-principal">Quand</legend>
        <div role="radiogroup" aria-label="Fréquence" className="flex flex-wrap gap-0.5 self-start rounded-sm bg-fond-surface-grise p-0.5">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={f.type === t.id}
              onClick={() => changerType(t.id)}
              className={cn(
                "h-8 cursor-pointer rounded-2xs border-0 px-3 text-ui-xs font-medium transition-colors duration-[220ms] ease-sortie",
                f.type === t.id ? "bg-fond-surface text-texte-principal shadow-ombre-xs" : "bg-transparent text-texte-secondaire hover:text-texte-principal",
              )}
            >
              {t.nom}
            </button>
          ))}
        </div>

        {f.type === "semaine" && (
          <div role="radiogroup" aria-label="Jour de la semaine" className="flex flex-wrap gap-1.5">
            {NOMS_JOURS.map((nom, i) => (
              <button
                key={nom}
                type="button"
                role="radio"
                aria-checked={jour === i + 1}
                onClick={() => changerJour(i + 1)}
                className={cn(
                  "h-8 cursor-pointer rounded-sm border px-3 text-ui-xs font-medium capitalize transition-colors duration-[120ms]",
                  jour === i + 1
                    ? "klyra-surface-sombre border-transparent text-texte-inverse"
                    : "border-bordure-subtile bg-fond-surface text-texte-secondaire hover:border-bordure-forte",
                )}
              >
                {nom.slice(0, 3)}.
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4">
          {f.type === "mois" && (
            <Champ label="Jour du mois" className="w-[140px]">
              <Select
                size="sm"
                value={String(jour)}
                options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "1er" : String(i + 1) }))}
                onChange={(e) => changerJour(Number(e.target.value))}
                className={CHAMP}
              />
            </Champ>
          )}
          {f.type !== "heure" && f.type !== "manuel" && (
            <Champ label="Heure" className="w-[140px]">
              <Input size="sm" type="time" value={heure} onChange={(e) => changerHeure(e.target.value)} className={CHAMP} />
            </Champ>
          )}
          <Champ label="Où ça part" className="min-w-[240px] flex-1">
            <Select
              size="sm"
              value={r.projectId ?? ""}
              options={[
                { value: "", label: "Conversation directe avec l’agent" },
                ...projects.map((p) => ({ value: p.id, label: `Projet ${p.name}` })),
              ]}
              onChange={(e) => setR({ ...r, projectId: e.target.value || null })}
              className={CHAMP}
            />
          </Champ>
        </div>
        <p className="m-0 text-ui-xs text-texte-tertiaire">
          {f.type === "manuel"
            ? "Elle ne part que quand tu la lances, depuis son canevas."
            : `${libelleFrequence(f)} · prochain passage ${dateLongue.format(prochaine)}. Elle part tant que l’app est ouverte ; une heure manquée est rattrapée à l’ouverture.`}
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <BoutonPrincipal type="submit">Enregistrer</BoutonPrincipal>
        <Bouton variant="blanc" taille="md" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
