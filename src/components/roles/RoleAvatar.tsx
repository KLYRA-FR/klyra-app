import { Avatar, type AvatarSize } from "klyra-ui";
import { useRole } from "@/lib/workspace";
import type { RoleId } from "@/types/domain";

interface RoleAvatarProps {
  roleId: RoleId;
  size?: AvatarSize;
  className?: string;
}

/** Avatar d'un rôle : plein pour le Principal, neutre pour les autres. */
export function RoleAvatar({ roleId, size = "md", className }: RoleAvatarProps) {
  const role = useRole(roleId);
  return (
    <Avatar
      shape="circle"
      size={size}
      initials={role.initial}
      alt={role.name}
      gradient={roleId === "principal"}
      className={className}
    />
  );
}
