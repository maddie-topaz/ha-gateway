import {defineApp} from "../types.js";
import {phraseHeard, zoneActivity} from "../shared/events.js";
import {notifyMaddiesPhone, phoneNotify, phoneSay, turnOffAction, turnOnAction} from "../shared/actions.js";


// Upstairs lights Cam Quest can switch.
const upstairsLamp = "light.upstairs_lamp";
const upstairsLight = "light.shellydimmerg3_b08184f2b428";
const upstairsHallLight = "light.shellydimmer2_4cebd6edf4c4";
const upstairsBathroomLight = "light.shellydimmer2_4cebd6edf6c0";
const upstairsToiletLight = "light.shellydimmer2_08f9e0442e99";
const allUpstairsLights = [upstairsLamp, upstairsLight, upstairsHallLight, upstairsBathroomLight, upstairsToiletLight];

// Lets Cam Quest pick a brightness when turning a light on.
const brightness = { params: { brightness_pct: "number" } } as const;

export const camQuest = defineApp({
  name: "cam-quest",
  apiKeyEnv: "CAM_QUEST_API_KEY",
  webhook: { urlEnv: "CAM_QUEST_WEBHOOK_URL", secretEnv: "CAM_QUEST_WEBHOOK_SECRET" },

  events: [zoneActivity],
  // Fired by the "Cam Quest - phrase heard" HA automation (see README: Voice phrases).
  customEvents: [phraseHeard("cam_quest_phrase")],
  // "Alexa, ask <invocation name> to cast open the portal" (see README: Alexa phrases).
  alexa: {
    skillIdEnv: "CAM_QUEST_ALEXA_SKILL_ID",
    replies: {
      launch: "Speak your spell.",
      heard: (phrase) => `${phrase}. So it shall be.`,
    },
  },

  actions: {
    test_phone_notification: notifyMaddiesPhone,
    say_on_maddies_phone: phoneSay("mobile_app_maddie_s_pixel"),
    // Cam's iPhone can't speak like the Pixel; Siri reads this aloud if he has Announce Notifications on.
    notify_cams_phone: phoneNotify("notify.cams_iphone"),
    say_on_cams_phone: phoneSay("mobile_app_cam_s_pixel"),

    upstairs_lamp_on: turnOnAction(upstairsLamp, brightness),
    upstairs_lamp_off: turnOffAction(upstairsLamp),
    upstairs_light_on: turnOnAction(upstairsLight, brightness),
    upstairs_light_off: turnOffAction(upstairsLight),
    upstairs_hall_light_on: turnOnAction(upstairsHallLight, brightness),
    upstairs_hall_light_off: turnOffAction(upstairsHallLight),
    upstairs_bathroom_light_on: turnOnAction(upstairsBathroomLight, brightness),
    upstairs_bathroom_light_off: turnOffAction(upstairsBathroomLight),
    upstairs_toilet_light_on: turnOnAction(upstairsToiletLight, brightness),
    upstairs_toilet_light_off: turnOffAction(upstairsToiletLight),
    upstairs_lights_on: turnOnAction(allUpstairsLights, brightness),
    upstairs_lights_off: turnOffAction(allUpstairsLights),

    // Once you've confirmed which speaker works (see speakOn in shared/actions.ts):
    // say_upstairs: speakOn("media_player.upstairs_speaker"),
    // Once Alexa Media Player is installed (see alexaSay in shared/actions.ts):
    // say_on_echo: alexaSay("media_player.<your_echo>"),
  },
});
