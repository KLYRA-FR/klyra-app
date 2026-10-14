import type { Role, RoleId } from "@/types/domain";

/** Premier agent mentionné dans un message, par prénom ou par rôle : « @Hugo », « @Dev »… */
export function findMention(text: string, roles: Role[]): RoleId | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  for (const match of text.matchAll(/@([\p{L}/]+)/gu)) {
    const wanted = normalize(match[1]);
    const role = roles.find((r) => [r.name, r.tag, r.id].some((n) => normalize(n) === wanted));
    if (role) return role.id;
  }
  return null;
}
