import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/config", () => ({
  getEffectiveConfig: vi.fn(),
  saveConfigToDatabase: vi.fn(),
}));

import {
  DEFAULT_USER_NOTIFICATION_PREFERENCES,
  parseUserNotificationPreferences,
  stringifyUserNotificationPreferences,
} from "./settings";
import { canNotifyRecipient, isRealNotificationEmail } from "./recipients";

describe("notification preferences and recipient guards", () => {
  it("merges user preferences with admin defaults", () => {
    expect(parseUserNotificationPreferences(null, { orders: false, support: true })).toEqual({
      orders: false,
      support: true,
    });
    expect(parseUserNotificationPreferences('{"orders":false}', DEFAULT_USER_NOTIFICATION_PREFERENCES)).toEqual({
      orders: false,
      support: true,
    });
    expect(parseUserNotificationPreferences("{bad-json", { orders: true, support: false })).toEqual({
      orders: true,
      support: false,
    });
  });

  it("serializes category switches predictably", () => {
    expect(JSON.parse(stringifyUserNotificationPreferences({ orders: false, support: true }))).toEqual({
      orders: false,
      support: true,
    });
  });

  it("skips demo and placeholder recipients", () => {
    expect(isRealNotificationEmail("researcher@example.org")).toBe(true);
    expect(isRealNotificationEmail("admin@example.com")).toBe(false);
    expect(isRealNotificationEmail("person@seqdesk.local")).toBe(false);
    expect(isRealNotificationEmail("not-an-email")).toBe(false);

    expect(
      canNotifyRecipient(
        { email: "researcher@example.org", role: "user", isDemo: true },
        "order.submitted",
        DEFAULT_USER_NOTIFICATION_PREFERENCES
      )
    ).toBe(false);
    expect(
      canNotifyRecipient(
        {
          email: "researcher@example.org",
          role: "user",
          preferences: '{"orders":false,"support":true}',
        },
        "order.status_changed",
        DEFAULT_USER_NOTIFICATION_PREFERENCES
      )
    ).toBe(false);
  });
});
