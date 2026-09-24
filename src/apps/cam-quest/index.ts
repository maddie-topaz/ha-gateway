import {defineApp} from "../types.js";
import {zoneActivity} from "../shared/events.js";
import {notifyMaddiesPhone, phoneNotify, phoneSay} from "../shared/actions.js";


export const camQuest = defineApp({
  name: "cam-quest",
  apiKeyEnv: "CAM_QUEST_API_KEY",
  webhook: { urlEnv: "CAM_QUEST_WEBHOOK_URL", secretEnv: "CAM_QUEST_WEBHOOK_SECRET" },

  events: [zoneActivity],

  actions: {
    test_phone_notification: notifyMaddiesPhone,
    say_on_maddies_phone: phoneSay("mobile_app_maddie_s_pixel"),
    // Cam's iPhone can't speak like the Pixel; Siri reads this aloud if he has Announce Notifications on.
    notify_cams_phone: phoneNotify("notify.cams_iphone"),
    say_on_cams_phone: phoneSay("mobile_app_cam_s_pixel"),
    // Once you've confirmed which speaker works (see speakOn in shared/actions.ts):
    // say_upstairs: speakOn("media_player.upstairs_speaker"),
    // Once Alexa Media Player is installed (see alexaSay in shared/actions.ts):
    // say_on_echo: alexaSay("media_player.<your_echo>"),
  },
});
