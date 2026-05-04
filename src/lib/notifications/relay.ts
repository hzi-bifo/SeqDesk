import type { NotificationDispatchInput } from "./types";

export interface RelayClientInput extends NotificationDispatchInput {
  relayUrl: string;
  relayToken: string;
  installation: {
    siteName?: string;
    baseUrl?: string;
    profileId?: string;
  };
}

export async function sendViaSeqDeskRelay(input: RelayClientInput): Promise<{ ok: true; id?: string }> {
  const response = await fetch(input.relayUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.relayToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event: input.event,
      recipient: {
        email: input.recipient.email,
        name: input.recipient.name || undefined,
        role: input.recipient.role,
      },
      installation: input.installation,
      context: {
        ...withoutEmpty({
          orderNumber: input.context.orderNumber,
          orderName: input.context.orderName,
          ticketSubject: input.context.ticketSubject,
          statusFrom: input.context.statusFrom,
          statusTo: input.context.statusTo,
          actorName: input.context.actorName,
          snippet: truncate(input.context.snippet, 240),
          linkUrl: buildLink(input.installation.baseUrl, input.context.linkPath),
        }),
      },
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`SeqDesk notification relay failed (${response.status}): ${text}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

function buildLink(baseUrl: string | undefined, linkPath: string | null | undefined): string | undefined {
  if (!baseUrl || !linkPath) return undefined;
  try {
    return new URL(linkPath, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function truncate(value: string | null | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, Math.max(0, max - 3))}...` : trimmed;
}

function withoutEmpty<T extends Record<string, string | undefined | null>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => typeof value === "string" && value.trim())
  );
}
