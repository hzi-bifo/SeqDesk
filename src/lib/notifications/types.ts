export type NotificationEvent =
  | "order.submitted"
  | "order.status_changed"
  | "order.samples_sent"
  | "ticket.created"
  | "ticket.reply";

export type NotificationRecipientRole = "user" | "admin";

export interface NotificationEventSettings {
  order: {
    submitted: boolean;
    statusChanged: boolean;
    samplesSent: boolean;
  };
  ticket: {
    created: boolean;
    reply: boolean;
  };
}

export interface NotificationUserPreferences {
  orders: boolean;
  support: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  provider: "seqdesk-relay";
  relayUrl: string;
  hasRelayToken: boolean;
  events: NotificationEventSettings;
  userDefaults: NotificationUserPreferences;
}

export interface NotificationRecipient {
  email: string;
  name?: string | null;
  role: NotificationRecipientRole;
  isDemo?: boolean | null;
  preferences?: string | null;
}

export interface NotificationContext {
  orderNumber?: string | null;
  orderName?: string | null;
  ticketSubject?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  actorName?: string | null;
  snippet?: string | null;
  linkPath?: string | null;
}

export interface NotificationDispatchInput {
  event: NotificationEvent;
  recipient: NotificationRecipient;
  context: NotificationContext;
  replyTo?: string | null;
}
