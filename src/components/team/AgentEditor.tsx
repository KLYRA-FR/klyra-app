"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "klyra-ui";
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";
import { Icon } from "@/components/icons/Icon";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useConfirmation } from "@/components/ui/Modale";
import { getField, newAgentBody, parseAgentFile, parseBody, serializeAgentFile, setFields } from "@/lib/agent-file";
import { roleFromContent, useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useBibliotheque } from "@/lib/bibliotheque";
import { BridgeError } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { lienDe } from "@/lib/lien-bibliotheque";
import { identifiantDe, nomDejaPris, nomPropre } from "@/lib/noms-agents";
import { oublierProposition, reprendreDansEditeur } from "@/lib/proposition-agent";
import { jouer } from "@/lib/sons/sons";
import type { Role, RoleTeinte } from "@/types/domain";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { AgentVisuel } from "./AgentVisuel";

const NOM_VALIDE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Les modèles qu'une fiche peut demander (champ `model`), repris par les Réglages. */
export const MODELES = [
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
 * Modifier la fiche d'un agent, ou en créer une (seul, ou à partir de la proposition de
 * l'assistant). Le fichier garde son en-tête (clés inconnues comprises) ; le rôle court et la
 * couleur sont des réglages de l'app, gardés à part. D'un agent reçu de la bibliothèque, le nom,
 * le rôle court, la couleur et le modèle sont des préférences ; changer sa consigne en fait une
 * copie privée, après confirmation.
 */
export function AgentEditor({ role, onReprendre }: { role: Role | null; onReprendre: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const { roles, tous, save, saveReglage, changerModele, create, reload, identifiantLibre } = useAgents();
  const bibliotheque = useBibliotheque();
  const [demander, fenetreConfirmation] = useConfirmation();
  const creation = role === null;
  const local = role ? (tous.find((a) => a.role.id === role.id) ?? null) : null;
  const lie = local?.entree?.origine.type === "bibliotheque";
  const lien = local ? lienDe(local, { etat: bibliotheque.etat, moiId: bibliotheque.moiId, etats: bibliotheque.etats }) : null;
  const auteur = lien?.type === "recu" ? lien.auteur : null;
  const assistant = roles[0];

  // La version ouverte est figée : si le fichier change sur le disque pendant
  // l'édition, l'enregistrement le détecte au lieu d'écraser la modif.
  const [initial] = useState(() => {
    const parsed = parseAgentFile(role?.file?.content ?? "");
    const proposition = creation && params.get("proposition") ? reprendreDansEditeur() : null;
    return {
      parsed,
      proposition,
      id: role?.id ?? "",
      /** Le nom écrit dans la fiche (celui d'un agent reçu reste celui de la version suivie). */
      nomFiche: getField(parsed.frontmatter, "displayName") ?? "",
      displayName: role?.name ?? proposition?.nom ?? "",
      tag: role?.tag ?? proposition?.role ?? "",
      teinte: role?.teinte ?? (proposition ? roleFromContent(proposition.id || identifiantDe(proposition.nom), "", {}, null).teinte : ("bleu-k2" as RoleTeinte)),
      model: getField(parsed.frontmatter, "model") ?? "opus",
      memory: getField(parsed.frontmatter, "memory") ?? (lie ? "" : "project"),
      description: getField(parsed.frontmatter, "description") ?? proposition?.description ?? "",
      body: role ? parsed.body.trim() : (proposition?.consignes ?? ""),
      modifiedAt: role?.file?.modifiedAt ?? null,
    };
  });
  const changeSurDisque = !creation && role.file !== null && role.file.modifiedAt !== initial.modifiedAt;

  const [idSaisi, setIdSaisi] = useState<string | null>(creation ? (initial.proposition?.id || null) : initial.id);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [tag, setTag] = useState(initial.tag);
  const [teinte, setTeinte] = useState<RoleTeinte>(initial.teinte);
  const [model, setModel] = useState(initial.model);
  const [memory, setMemory] = useState(initial.memory);
  const [description, setDescription] = useState(initial.description);
  const [body, setBody] = useState(initial.body);
  const [bodyTouched, setBodyTouched] = useState(!creation || initial.proposition !== null);
  const [etat, setEtat] = useState<Etat>({ kind: "edition" });
  const [essai, setEssai] = useState(false);
  const [avance, setAvance] = useState(false);
  const champId = useRef<HTMLInputElement>(null);

  // À la création, le squelette suit le nom et le rôle tant qu'on n'a pas écrit dedans.
  const corps = bodyTouched ? body : newAgentBody(displayName, tag, BLOC_COMMUN);
  // L'identifiant se déduit du nom tant qu'on n'y a pas touché ; jamais celui d'une fiche existante.
  const base = idSaisi ?? (identifiantDe(displayName) || "agent");
  const id = creation && idSaisi === null ? identifiantLibre(base) : (idSaisi ?? initial.id);

  const pris = nomDejaPris(displayName, roles, role?.id);
  const erreurs = {
    id: !creation
      ? undefined
      : !id
        ? "Choisis un identifiant."
        : !NOM_VALIDE.test(id)
          ? "Minuscules, chiffres et tirets seulement, sans espace ni accent."
          : identifiantLibre(id) !== id
            ? `« ${id} » existe déjà sur cet ordinateur : choisis-en un autre, rien ne sera écrasé.`
            : undefined,
    displayName: !nomPropre(displayName)
      ? "Donne-lui un nom."
      : pris
        ? `Tu as déjà un agent qui s’appelle ${pris.name}. Choisis un autre nom pour les distinguer dans les chats.`
        : undefined,
    tag: tag.trim() ? undefined : "Donne-lui un rôle court, affiché à côté de son nom.",
    description: description.trim() ? undefined : "Écris quand l’appeler : c’est ce que Claude lit pour choisir l’agent.",
    body: corps.trim() ? undefined : "La fiche ne peut pas être vide.",
  };
  const valide = Object.values(erreurs).every((e) => !e);
  const aideId =
    creation && idSaisi === null && id !== base
      ? `« ${base} » est déjà pris : celui-ci s’appellera « ${id} ».`
      : creation
        ? "Le nom du fichier et du sous-agent. Il ne pourra plus changer."
        : "Ne change pas : Claude Code et les autres fiches l’utilisent.";

  const consigneChangee = description !== initial.description || body !== initial.body;
  const contenu = () =>
    serializeAgentFile({
      frontmatter: setFields(initial.parsed.frontmatter, {
        name: creation ? id : undefined,
        // Agent reçu : son nom pour la personne est une préférence, la fiche garde celui de la version suivie.
        displayName: lie ? initial.nomFiche || undefined : nomPropre(displayName),
        description: description.trim().replace(/\s*\n\s*/g, " "),
        model,
        memory: lie ? undefined : memory,
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
    consigneChangee;

  const enregistrer = async (forcer = false) => {
    setEssai(true);
    if (!valide) {
      // Une erreur dans les réglages avancés les déplie et y met le focus.
      if (erreurs.id) {
        setAvance(true);
        requestAnimationFrame(() => champId.current?.focus());
      }
      return;
    }
    const nom = nomPropre(displayName);
    if (
      lie &&
      consigneChangee &&
      !(await demander({
        titre: "Créer ta copie privée ?",
        texte: `Tu as modifié la consigne de ${role?.name}. Ta version ne suivra plus ${auteur ? `celle de ${auteur}` : "celle de la bibliothèque"}. Tu pourras y revenir depuis sa fiche.`,
        confirmer: "Créer ma copie privée",
        annuler: "Continuer à modifier",
      }))
    )
      return;
    setEtat({ kind: "enregistrement" });
    try {
      const reglage = { tag: tag.trim(), teinte };
      if (creation) {
        await create(id, contenu(), reglage);
        oublierProposition();
        annoncer(`Agent créé : ${nom}.`);
      } else if (lie) {
        await saveReglage(role.id, { ...reglage, nom: nom !== (initial.nomFiche || role.id) ? nom : undefined });
        if (consigneChangee) await save(role.id, contenu(), reglage, forcer ? null : initial.modifiedAt);
        else if (model !== initial.model) await changerModele(role.id, model);
        else await reload();
      } else {
        await save(role.id, contenu(), reglage, forcer ? null : initial.modifiedAt);
      }
      jouer("validation");
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
    if (creation) oublierProposition();
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
            <span className="font-normal">· sa fiche</span>
          </h1>
          {!creation && role.file && <p className="klyra-mono -mt-3 mb-0 text-ui-xs text-texte-tertiaire">{role.file.path}</p>}

          {/* Préparé par l'assistant : on relit, on ajuste, puis on crée. */}
          {creation && initial.proposition && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-bordure-subtile bg-fond-page p-4">
              <p className="m-0 min-w-[240px] flex-1 text-ui leading-[1.5] text-texte-secondaire">
                <span className="font-semibold text-texte-principal">Préparé par {assistant.name} à partir de ta demande.</span> Relis, ajuste ce qui doit
                l’être, puis crée l’agent.
              </p>
              <Bouton variant="discret" taille="compact" onClick={() => router.push("/chat?id=dm-principal")}>
                Retour à la conversation
              </Bouton>
            </div>
          )}

          {/* Un agent reçu : ce qui reste à soi, et ce qui en fait une copie privée. */}
          {lie && (
            <p role="status" className="m-0 rounded-md border border-bordure-accent-survol bg-fond-teinte-bleue p-4 text-ui text-texte-principal">
              Ce {role?.name} suit {auteur ? `la version de ${auteur}` : "une version de la bibliothèque"}. Changer son nom, son rôle court, sa couleur ou son
              modèle ne casse rien. Changer « Quand l’appeler » ou ses consignes en fait ta copie privée : elle ne recevra plus les mises à jour
              {auteur ? ` de ${auteur}` : ""}.
            </p>
          )}

          {/* Deux façons de modifier : soi-même ci-dessous, ou en le demandant à Lou, si elle est dans Mes agents. */}
          {!creation && roles.some((r) => r.id === "prompty") && (
            <div className="flex items-center gap-4 rounded-xl border border-bordure-subtile bg-fond-page p-4">
              <RoleAvatar roleId="prompty" size="lg" />
              <p className="m-0 flex-1 text-ui leading-[1.5] text-texte-secondaire">
                <span className="font-semibold text-texte-principal">Tu préfères ne pas toucher au texte ?</span> Dis en une phrase ce qui doit changer :
                Lou, l’agent qui écrit les consignes, réécrit la fiche. Tu compares l’avant et l’après, et tu valides.
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
                <span className="font-semibold">La fiche a changé sur le disque depuis que tu l’as ouverte.</span> Quelqu’un (ou un agent) l’a modifiée
                entre-temps.
              </p>
              <div className="flex gap-2">
                <Bouton variant="blanc" taille="compact" onClick={() => void reload().then(onReprendre)}>
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
              <Champ label="Nom" erreur={essai ? erreurs.displayName : undefined} aide={lie ? "Ton nom pour lui : il ne change pas sa fiche." : undefined}>
                <Input size="sm" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={CHAMP} />
              </Champ>
              <Champ label="Rôle court" erreur={essai ? erreurs.tag : undefined} aide="Affiché à côté de son nom dans les chats (« Dev », « Ventes »). Réglage de l’app.">
                <Input size="sm" value={tag} onChange={(e) => setTag(e.target.value)} className={CHAMP} />
              </Champ>
              <div className="flex flex-col gap-2 @xl:col-span-2">
                <span id="couleur-agent" className="mb-2 text-ui-s font-medium text-texte-principal">
                  Couleur de son illustration
                </span>
                <ChoixTeinte valeur={teinte} onChange={setTeinte} libelleId="couleur-agent" />
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-bordure-subtile bg-fond-page">
              <div className="h-[180px]">
                <AgentVisuel agentId={id || "nouveau"} teinte={teinte} />
              </div>
              <p className="m-0 border-t border-bordure-subtile bg-fond-surface px-3 py-2 text-ui-s">
                <span className="font-semibold">{displayName || "Nom"}</span> <span className="text-texte-tertiaire">· {tag || "Rôle"}</span>
              </p>
            </div>
          </section>

          <Champ
            label="Quand l’appeler"
            erreur={essai ? erreurs.description : undefined}
            aide="La description lue par Claude pour choisir l’agent. Le motif : « Rôle — ce qu’il couvre. Appelle X dès que… »."
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
            aide="En Markdown : un titre « # Nom — Rôle », une présentation, puis des sections « ## ». C’est la consigne complète de l’agent."
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

          {/* Identifiant, modèle et mémoire : repliés, l'identifiant se déduit du nom. */}
          <details open={avance} onToggle={(e) => setAvance(e.currentTarget.open)} className="group rounded-xl border border-bordure-subtile bg-fond-surface p-5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-ui font-semibold text-texte-principal">
              <Icon name="chevron-right" size={16} className="text-icone-secondaire transition-transform duration-[220ms] ease-sortie group-open:rotate-90" />
              Réglages avancés
              <span className="font-normal text-texte-tertiaire">· identifiant « {id || "…"} », modèle, mémoire</span>
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-4 @xl:grid-cols-3">
              <Champ label="Identifiant" erreur={essai ? erreurs.id : undefined} aide={aideId}>
                <Input
                  ref={champId}
                  size="sm"
                  value={id}
                  readOnly={!creation}
                  onChange={(e) => setIdSaisi(e.target.value.toLowerCase())}
                  className={cn(CHAMP, "klyra-mono", !creation && "bg-fond-page text-texte-tertiaire")}
                />
              </Champ>
              <Champ label="Modèle">
                <ListeDeroulante options={MODELES} value={model} onChange={setModel} />
              </Champ>
              <Champ label="Mémoire" aide={lie ? "Réglée par la version suivie." : undefined}>
                <ListeDeroulante options={MEMOIRES} value={memory} onChange={setMemory} disabled={lie} />
              </Champ>
            </div>
          </details>
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
