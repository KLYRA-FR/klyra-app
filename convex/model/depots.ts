import { v } from "convex/values";

/**
 * Les jetons GitHub des agents, pour tout projet de KLYRA-FR (`docs/JETONS-GITHUB.md`) : deux GitHub
 * Apps, un rôle pour chacune, car GitHub refuse qu'un auteur approuve sa propre PR. Module pur. Les
 * identifiants d'App ne sont pas des secrets ; les clés privées sont dans l'env Convex. Les Apps sont
 * installées sur tous les dépôts de l'organisation : la limite par personne et par dépôt est `accesDepots`.
 */
export type RoleDepot = "agents" | "reviewer";

export const vRoleDepot = v.union(v.literal("agents"), v.literal("reviewer"));

/** Jamais `administration`, `workflows` ni `secrets` : un jeton ne peut pas changer les règles du dépôt. */
export const APPS_DEPOT: Record<
  RoleDepot,
  { appId: string; variable: "GITHUB_APP_AGENTS_CLE" | "GITHUB_APP_REVIEWER_CLE"; permissions: Record<string, "read" | "write"> }
> = {
  agents: {
    appId: "5618456",
    variable: "GITHUB_APP_AGENTS_CLE",
    permissions: { contents: "write", issues: "write", pull_requests: "write", checks: "read", statuses: "read" },
  },
  reviewer: {
    appId: "5618483",
    variable: "GITHUB_APP_REVIEWER_CLE",
    permissions: { contents: "read", issues: "write", pull_requests: "write", checks: "read", statuses: "read" },
  },
};

const PROPRIETAIRE = "klyra-fr";
const DEPOT = /^([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9._-]{1,100})$/;

/** Un jeton vaut une heure : trente demandes par heure laissent une large marge à une équipe d'agents. */
export const JETONS_PAR_HEURE = 30;
export const HEURE_MS = 3_600_000;

/** `klyra-fr/nom`, en minuscules, ou null : seuls les dépôts de l'organisation sont acceptés. */
export function normaliserDepot(depot: string): { complet: string; proprietaire: string; nom: string } | null {
  const complet = depot.trim().toLowerCase();
  const lu = DEPOT.exec(complet);
  if (lu === null || lu[1] !== PROPRIETAIRE || lu[2] === "." || lu[2] === "..") return null;
  return { complet, proprietaire: lu[1], nom: lu[2] };
}

/**
 * Une clé PEM telle qu'on la colle : les retours à la ligne ont pu devenir des espaces ou des `\n`
 * écrits en toutes lettres. Null si ce n'est pas une clé privée.
 */
export function normaliserCle(brut: string): string | null {
  const lu = /-----BEGIN ((?:RSA )?PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(brut.replace(/\\n/g, "\n"));
  if (lu === null) return null;
  const corps = lu[2].replace(/\s+/g, "");
  if (corps === "" || !/^[A-Za-z0-9+/]+=*$/.test(corps)) return null;
  const lignes = corps.match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${lu[1]}-----`, ...lignes, `-----END ${lu[1]}-----`, ""].join("\n");
}
