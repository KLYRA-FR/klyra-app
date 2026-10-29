"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "klyra-ui";
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useConfirmation } from "@/components/ui/Modale";
import {
  addToRoster,
  getField,
  newAgentBody,
  parseAgentFile,
  parseBody,
  serializeAgentFile,
  setFields,
} from "@/lib/agent-file";
import { useAgents } from "@/lib/agents";
import { BridgeError } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { ROLE_TEINTES, type Role, type RoleTeinte } from "@/types/domain";
import { AgentVisuel, TEINTES } from "./AgentVisuel";

const NOM_VALIDE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const MODELES = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
  { value: "inherit", label: "Celui de la session" },
];

const MEMOIRES = [
  { value: "project", label: "Par projet" },
  { value: "user", label: "Partagée entre projets" },
  { value: "local", label: "Locale, non versionnée" },
  { value: "", label: "Aucune" },
];

/** Le bloc « Parler en équipe », repris d'une fiche de l'équipe. */
const BLOC_COMMUN = (() => {
  const section = parseBody(parseAgentFile(AGENT_TEMPLATES[0]?.content ?? "").body).sections.find((s) =>
    /^Parler en équipe/.test(s.title),
  );
  return section ? `## ${section.title}\n\n${section.body}` : "";
})();

type Etat = { kind: "edition" } | { kind: "enregistrement" } | { kind: "conflit" } | { kind: "erreur"; message: string };

/**
 * Modifier la fiche d'un agent, ou en créer une. Le fichier garde son
 * en-tête (clés inconnues comprises) ; le rôle court et la couleur sont
 * des réglages de l'app, gardés à part.
 */
export function AgentEditor({ role, onReprendre }: { role: Role | null; onReprendre: () => void }) {
  const router = useRouter();
  const { roles, save, create, reload } = useAgents();
  const [demander, fenetreConfirmation] = useConfirmation();
  const creation = role === null;
  // La version ouverte est figée : si le fichier change sur le disque pendant
  // l'édition, l'enregistrement le détecte au lieu d'écraser la modif.
  const [initial] = useState(() => {
    const parsed = parseAgentFile(role?.file?.content ?? "");
    return {
      parsed,
      id: role?.id ?? "",
      displayName: role?.name ?? "",
      tag: role?.tag ?? "",
      teinte: role?.teinte ?? ("bleu-k2" as RoleTeinte),
      model: getField(parsed.frontmatter, "model") ?? "opus",
      memory: getField(parsed.frontmatter, "memory") ?? "project",
      description: getField(parsed.frontmatter, "description") ?? "",
      body: role ? parsed.body.trim() : "",
      modifiedAt: role?.file?.modifiedAt ?? null,
    };
  });
  const changeSurDisque = !creation && role.file !== null && role.file.modifiedAt !== initial.modifiedAt;

  const [id, setId] = useState(initial.id);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [tag, setTag] = useState(initial.tag);
  const [teinte, setTeinte] = useState<RoleTeinte>(initial.teinte);
  const [model, setModel] = useState(initial.model);
  const [memory, setMemory] = useState(initial.memory);
  const [description, setDescription] = useState(initial.description);
  const [body, setBody] = useState(initial.body);
  const [bodyTouched, setBodyTouched] = useState(!creation);
  const [addToTeam, setAddToTeam] = useState(true);
  const [etat, setEtat] = useState<Etat>({ kind: "edition" });
  const [essai, setEssai] = useState(false);

  // À la création, le squelette suit le prénom et le rôle tant qu'on n'a pas écrit dedans.
  const corps = bodyTouched ? body : newAgentBody(displayName, tag, BLOC_COMMUN);

  const erreurs = {
    id: !creation
      ? undefined
      : !id
        ? "Choisis un identifiant."
        : !NOM_VALIDE.test(id)
          ? "Minuscules, chiffres et tirets seulement, sans espace ni accent."
          : roles.some((r) => r.id === id)
            ? "Cet identifiant est déjà pris."
            : undefined,
    displayName: displayName.trim() ? undefined : "Donne-lui un prénom.",
    tag: tag.trim() ? undefined : "Donne-lui un rôle court, affiché à côté de son prénom.",
    description: description.trim()
      ? undefined
      : "Écris quand l’appeler : c’est ce que Claude lit pour choisir l’agent.",
    body: corps.trim() ? undefined : "La fiche ne peut pas être vide.",
  };
  const valide = Object.values(erreurs).every((e) => !e);

  const contenu = () =>
    serializeAgentFile({
      frontmatter: setFields(initial.parsed.frontmatter, {
        name: creation ? id : undefined,
        displayName: displayName.trim(),
        description: description.trim().replace(/\s*\n\s*/g, " "),
        model,
        memory,
      }),
      body: corps,
    });

  const modifie =
    creation ||
    displayName !== initial.displayName ||
    tag !== initial.tag ||
    teinte !== initial.teinte ||
    model !== initial.model ||
    memory !== initial.memory ||
    description !== initial.description ||
    body !== initial.body;

  const enregistrer = async (forcer = false) => {
    setEssai(true);
    if (!valide) return;
    setEtat({ kind: "enregistrement" });
    try {
      const reglage = { tag: tag.trim(), teinte };
      if (creation) {
        await create(id, contenu(), reglage);
        if (addToTeam) {
          const label = `${displayName.trim()} (${tag.trim().toLowerCase()})`;
          for (const other of roles) {
            if (!other.file) continue;
            const next = addToRoster(other.file.content, label);
            if (next !== other.file.content) await save(other.id, next, { tag: other.tag, teinte: other.teinte }, other.file.modifiedAt);
          }
        }
      } else {
        await save(role.id, contenu(), reglage, forcer ? null : initial.modifiedAt);
      }
      router.push(`/equipe?agent=${creation ? id : role.id}`);
    } catch (e) {
      if (e instanceof BridgeError && e.code === "conflit") setEtat({ kind: "conflit" });
      else setEtat({ kind: "erreur", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const annuler = async () => {
    if (
      modifie &&
      !(await demander({
        titre: "Abandonner les modifications ?",
        texte: "Ce que tu as changé dans cette fiche ne sera pas enregistré.",
        confirmer: "Abandonner",
        annuler: "Continuer à modifier",
      }))
    )
      return;
    router.push(creation ? "/equipe" : `/equipe?agent=${role.id}`);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void enregistrer();
  };

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col">
      {fenetreConfirmation}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="@container mx-auto flex max-w-[960px] flex-col gap-6 px-8 pt-8 pb-10">
          <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
            <span className="font-semibold">{creation ? "Nouvel agent" : `Modifier ${role.name}`}</span>{" "}
            <span className="font-normal">{creation ? "de l’équipe" : "· sa fiche"}</span>
          </h1>
          {!creation && role.file && (
            <p className="klyra-mono -mt-3 mb-0 text-ui-xs text-texte-tertiaire">{role.file.path}</p>
          )}

          {/* Deux façons de modifier : soi-même ci-dessous, ou en le demandant à Lou. */}
          {!creation && (
            <div className="flex items-center gap-4 rounded-xl border border-bordure-subtile bg-fond-page p-4">
              <RoleAvatar roleId="prompty" size="lg" />
              <p className="m-0 flex-1 text-ui leading-[1.5] text-texte-secondaire">
                <span className="font-semibold text-texte-principal">Tu préfères ne pas toucher au texte ?</span> Dis en une
                phrase ce qui doit changer : Lou, l’agent qui écrit les consignes de l’équipe, réécrit la fiche. Tu compares
                l’avant et l’après, et tu valides.
              </p>
              <Bouton variant="sombre" taille="compact" onClick={() => router.push(`/equipe?agent=${role.id}&mode=lou`)}>
                Demander à Lou
              </Bouton>
            </div>
          )}

          {changeSurDisque && etat.kind !== "conflit" && (
            <p role="status" className="m-0 rounded-md border border-bordure-accent-survol bg-fond-teinte-bleue p-4 text-ui text-texte-principal">
              La fiche vient de changer sur le disque. À l’enregistrement, tu pourras reprendre cette version ou garder la tienne.
            </p>
          )}
          {etat.kind === "conflit" && (
            <div role="alert" className="flex flex-col gap-3 rounded-md border border-bordure-erreur bg-fond-surface p-4">
              <p className="m-0 text-ui text-texte-principal">
                <span className="font-semibold">La fiche a changé sur le disque depuis que tu l’as ouverte.</span> Quelqu’un
                (ou un agent) l’a modifiée entre-temps.
              </p>
              <div className="flex gap-2">
                <Bouton
                  variant="blanc"
                  taille="compact"
                  onClick={() => void reload().then(onReprendre)}
                >
                  Reprendre la version du disque
                </Bouton>
                <Bouton variant="discret" taille="compact" onClick={() => void enregistrer(true)}>
                  Écraser avec ma version
                </Bouton>
              </div>
            </div>
          )}
          {etat.kind === "erreur" && (
            <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-4 text-ui text-texte-erreur">
              L’enregistrement a échoué : {etat.message}
            </p>
          )}

          {/* Identité */}
          <section className="grid grid-cols-1 gap-6 rounded-xl border border-bordure-subtile bg-fond-surface p-5 @2xl:grid-cols-[1fr_220px]">
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
              <Champ
                label="Identifiant"
                erreur={essai ? erreurs.id : undefined}
                aide={
                  creation
                    ? "Le nom du fichier et du sous-agent (ex. « juriste »). Il ne pourra plus changer."
                    : "Ne change pas : Claude Code et les autres fiches l’utilisent."
                }
              >
                <Input
                  size="sm"
                  value={id}
                  readOnly={!creation}
                  onChange={(e) => setId(e.target.value.toLowerCase())}
                  className={cn(CHAMP, "klyra-mono", !creation && "bg-fond-page text-texte-tertiaire")}
                />
              </Champ>
              <Champ label="Prénom" erreur={essai ? erreurs.displayName : undefined}>
                <Input size="sm" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={CHAMP} />
              </Champ>
              <Champ
                label="Rôle court"
                erreur={essai ? erreurs.tag : undefined}
                aide="Affiché à côté du prénom dans les chats (« Dev », « Ventes »). Réglage de l’app."
              >
                <Input size="sm" value={tag} onChange={(e) => setTag(e.target.value)} className={CHAMP} />
              </Champ>
              <div className="grid grid-cols-2 gap-4">
                <Champ label="Modèle">
                  <ListeDeroulante options={MODELES} value={model} onChange={setModel} />
                </Champ>
                <Champ label="Mémoire">
                  <ListeDeroulante options={MEMOIRES} value={memory} onChange={setMemory} />
                </Champ>
              </div>
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0 @xl:col-span-2">
                <legend className="mb-2 text-ui-s font-medium text-texte-principal">Couleur de son illustration</legend>
                <div className="flex flex-wrap gap-2">
                  {ROLE_TEINTES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={teinte === t}
                      aria-label={t}
                      title={t}
                      onClick={() => setTeinte(t)}
                      className={cn(
                        "flex size-8 cursor-pointer items-center justify-center rounded-xs border bg-fond-surface p-0",
                        teinte === t ? "border-focus" : "border-bordure-subtile hover:border-bordure-forte",
                      )}
                    >
                      <span className="size-4 rounded-[3px]" style={{ background: TEINTES[t] }} />
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="overflow-hidden rounded-2xl border border-bordure-subtile bg-fond-page">
              <div className="h-[180px]">
                <AgentVisuel agentId={id || "nouveau"} teinte={teinte} />
              </div>
              <p className="m-0 border-t border-bordure-subtile bg-fond-surface px-3 py-2 text-ui-s">
                <span className="font-semibold">{displayName || "Prénom"}</span>{" "}
                <span className="text-texte-tertiaire">· {tag || "Rôle"}</span>
              </p>
            </div>
          </section>

          <Champ
            label="Quand l’appeler"
            erreur={essai ? erreurs.description : undefined}
            aide="La description lue par Claude pour choisir l’agent. Le motif de l’équipe : « Rôle — ce qu’il couvre. Appelle X dès que… »."
          >
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border border-bordure-champ bg-fond-surface px-3 py-2.5 font-[inherit] text-ui leading-[1.5] text-texte-principal outline-none focus:border-focus"
            />
          </Champ>

          <Champ
            label="Fiche"
            erreur={essai ? erreurs.body : undefined}
            aide="En Markdown : un titre « # Prénom — Rôle », une présentation, puis des sections « ## ». C’est la consigne complète de l’agent."
          >
            <textarea
              value={corps}
              onChange={(e) => {
                setBodyTouched(true);
                setBody(e.target.value);
              }}
              rows={28}
              spellCheck={false}
              className="klyra-mono w-full resize-y rounded-md border border-bordure-champ bg-fond-surface px-4 py-3 text-ui-s leading-[1.65] text-texte-principal outline-none focus:border-focus"
            />
          </Champ>

          {creation && (
            <label className="flex cursor-pointer items-start gap-3 text-ui text-texte-secondaire">
              <input
                type="checkbox"
                checked={addToTeam}
                onChange={(e) => setAddToTeam(e.target.checked)}
                className="mt-1 size-4 accent-[var(--color-bleu-k1-500)]"
              />
              <span>
                <span className="font-medium text-texte-principal">Le présenter au reste de l’équipe.</span> Son prénom
                s’ajoute à la liste du bloc « Parler en équipe » de chaque fiche, pour que les autres sachent le joindre.
              </span>
            </label>
          )}
        </div>
      </div>

      {/* Barre d'enregistrement, toujours visible. */}
      <div className="flex items-center gap-3 border-t border-bordure-subtile bg-fond-surface px-8 py-3">
        <span className="flex-1 text-ui-s text-texte-tertiaire">
          {etat.kind === "enregistrement"
            ? "Enregistrement…"
            : modifie
              ? creation
                ? `Crée ~/.claude/agents/${id || "identifiant"}.md`
                : "Modifications non enregistrées. L’ancienne version reste dans l’historique."
              : "Aucune modification."}
        </span>
        <Bouton variant="blanc" taille="md" onClick={annuler}>
          Annuler
        </Bouton>
        <BoutonPrincipal type="submit" disabled={!modifie || etat.kind === "enregistrement"}>
          {creation ? "Créer l’agent" : "Enregistrer"}
        </BoutonPrincipal>
      </div>
    </form>
  );
}
