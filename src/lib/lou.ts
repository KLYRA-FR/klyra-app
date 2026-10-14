import { getField, parseAgentFile } from "@/lib/agent-file";
import type { Role } from "@/types/domain";

/**
 * Échange avec Lou pour réécrire une fiche : la consigne envoyée à Claude
 * Code, et la lecture de sa réponse. Une proposition qui change
 * l'identifiant de l'agent est écartée.
 */

export function consigne(role: Role, base: string, demande: string): string {
  return `Tu modifies la fiche du sous-agent « ${role.name} » (${role.id}), fichier ~/.claude/agents/${role.id}.md.

Voici la fiche actuelle :
<fiche>
${base}
</fiche>

Demande : ${demande}

Réécris la fiche pour répondre à la demande, sans rien changer d’autre. Garde l’en-tête (le champ name reste « ${role.id} ») et le bloc « Parler en équipe » tel quel, sauf si la demande les vise. N’écris aucun fichier : l’app montre ta proposition, et c’est l’utilisateur qui l’applique.

Réponds uniquement avec ces deux blocs, dans cet ordre :
<resume>les changements majeurs et leur raison, trois lignes au plus</resume>
<fiche>la fiche complète réécrite, en-tête compris</fiche>`;
}

export function lireProposition(texte: string, role: Role): { resume: string; fiche: string } {
  const fiche = texte.match(/<fiche>\s*([\s\S]*?)\s*<\/fiche>/)?.[1];
  if (!fiche) throw new Error("Lou n’a pas rendu de fiche complète. Reformule la demande ou réessaie.");
  const name = getField(parseAgentFile(fiche).frontmatter, "name");
  if (name !== role.id) throw new Error(`La proposition change l’identifiant de l’agent (« ${name ?? "aucun"} ») : elle est écartée.`);
  return { resume: texte.match(/<resume>\s*([\s\S]*?)\s*<\/resume>/)?.[1] ?? "", fiche: `${fiche.trim()}\n` };
}
