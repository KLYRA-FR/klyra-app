"use client";

import { Fragment, useEffect, useRef } from "react";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { formatDaySeparator, formatTime, isSameDay } from "@/lib/format";
import { useChatMessages, useRole, useWorkspace } from "@/lib/workspace";
import type { Message, RoleId } from "@/types/domain";
import { MessagePartView } from "./MessageParts";

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="klyra-mono py-1 text-center text-ui-3xs uppercase tracking-[0.06em] text-fg-3">
      {formatDaySeparator(iso)}
    </div>
  );
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {message.parts.map((part, i) => (
        <MessagePartView key={i} part={part} tone="user" onAction={() => {}} />
      ))}
    </div>
  );
}

function RoleMessage({
  message,
  roleId,
  onAction,
}: {
  message: Message;
  roleId: RoleId;
  onAction: (label: string, roleId: RoleId) => void;
}) {
  const role = useRole(roleId);
  return (
    <div className="flex gap-2.5">
      <RoleAvatar roleId={roleId} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-ui-s font-semibold">{role.name}</span>
          <span className="klyra-mono text-ui-3xs uppercase tracking-[0.04em] text-fg-3">{role.tag}</span>
          <span className="klyra-mono text-ui-3xs text-fg-3">{formatTime(message.createdAt)}</span>
        </div>
        {message.parts.map((part, i) => (
          <MessagePartView key={i} part={part} tone="role" onAction={(label) => onAction(label, roleId)} />
        ))}
      </div>
    </div>
  );
}

function TypingIndicator({ roleId }: { roleId: RoleId }) {
  const role = useRole(roleId);
  return (
    <div className="flex items-center gap-2 text-ui-xs text-fg-3" aria-live="polite">
      <RoleAvatar roleId={roleId} size="sm" />
      {role.name} écrit…
    </div>
  );
}

/** Fil de la conversation, collé en bas comme dans Messages. */
export function MessageThread({ chatId }: { chatId: string }) {
  const messages = useChatMessages(chatId);
  const { state, sendMessage } = useWorkspace();
  const typing = state.typing?.chatId === chatId ? state.typing : null;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, typing]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col justify-end gap-[18px] px-7 py-6">
        {messages.map((message, i) => {
          const previous = messages[i - 1];
          const showDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
          return (
            <Fragment key={message.id}>
              {showDay && <DaySeparator iso={message.createdAt} />}
              {message.author.kind === "user" ? (
                <UserMessage message={message} />
              ) : (
                <RoleMessage
                  message={message}
                  roleId={message.author.roleId}
                  onAction={(label, roleId) => sendMessage(chatId, label, roleId)}
                />
              )}
            </Fragment>
          );
        })}
        {typing && <TypingIndicator roleId={typing.roleId} />}
        <div ref={endRef} />
      </div>
    </div>
  );
}
