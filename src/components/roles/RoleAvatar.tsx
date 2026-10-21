import type { RoleId } from "@/types/domain";
import { AgentRond } from "./AgentRond";

interface RoleAvatarProps {
  roleId: RoleId;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const TAILLES = { xs: 20, sm: 24, md: 32, lg: 40, xl: 48 } as const;

/** Avatar d'un rôle aux tailles nommées : le rond pastel de l'agent (cf. AgentRond). */
export function RoleAvatar({ roleId, size = "md", className }: RoleAvatarProps) {
  return <AgentRond roleId={roleId} taille={TAILLES[size]} className={className} />;
}
