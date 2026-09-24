import { notifyMaddiesPhone } from "./shared/actions.js";
import { zoneActivity } from "./shared/events.js";
import { defineApp } from "./types.js";

export const camQuest = defineApp({
  name: "cam-quest",
  apiKeyEnv: "CAM_QUEST_API_KEY",
  webhook: { urlEnv: "CAM_QUEST_WEBHOOK_URL", secretEnv: "CAM_QUEST_WEBHOOK_SECRET" },

  events: [zoneActivity],

  actions: {
    test_phone_notification: notifyMaddiesPhone,
  },
});
