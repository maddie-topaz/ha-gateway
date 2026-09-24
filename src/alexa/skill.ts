/**
 * Turns Alexa custom skill requests into replies. The skill has one intent, `PhraseIntent`, whose
 * `phrase` slot (type AMAZON.SearchQuery) catches whatever was said after the carrier word,
 * e.g. "Alexa, ask the spellbook to cast {phrase}". See README: Alexa phrases.
 *
 * Request/response shapes: https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html
 */

export const PHRASE_INTENT = "PhraseIntent";
export const PHRASE_SLOT = "phrase";

/** What Alexa says. `heard` gets the phrase so replies can repeat it back. */
export type AlexaReplies = {
  /** "Alexa, open <skill>" with no phrase. Alexa then waits for one. */
  readonly launch: string;
  /** Said after a phrase is passed to the app. */
  readonly heard: (phrase: string) => string;
  readonly help: string;
  readonly goodbye: string;
  /** Alexa couldn't make out a phrase. Alexa then waits for another try. */
  readonly notUnderstood: string;
};

export const defaultReplies: AlexaReplies = {
  launch: "What's the phrase?",
  heard: () => "Got it.",
  help: "Say cast, followed by your phrase.",
  goodbye: "Goodbye.",
  notUnderstood: "Sorry, I didn't catch that. Say cast, followed by your phrase.",
};

/** The parts of an Alexa request body the gateway reads. */
export type AlexaRequestBody = {
  session?: { application?: { applicationId?: string } };
  context?: { System?: { application?: { applicationId?: string } } };
  request?: {
    type?: string;
    timestamp?: string;
    intent?: { name?: string; slots?: Record<string, { value?: string } | undefined> };
  };
};

export const skillIdOf = (body: AlexaRequestBody) =>
  body.context?.System?.application?.applicationId ?? body.session?.application?.applicationId;

const speak = (text: string, { listen }: { listen: boolean }) => ({
  version: "1.0",
  response: {
    outputSpeech: { type: "PlainText", text },
    // A reprompt keeps the microphone open for an answer.
    ...(listen && { reprompt: { outputSpeech: { type: "PlainText", text } } }),
    shouldEndSession: !listen,
  },
});

/**
 * Works out Alexa's reply to an already-verified request, calling `onPhrase` when one was said.
 * `onPhrase` should not wait on slow work: Alexa gives up after about 8 seconds.
 */
export const handleAlexaRequest = (
  body: AlexaRequestBody,
  { replies, onPhrase }: { replies: AlexaReplies; onPhrase: (phrase: string) => void },
) => {
  const request = body.request;
  switch (request?.type) {
    case "LaunchRequest":
      return speak(replies.launch, { listen: true });
    case "SessionEndedRequest":
      // Alexa ignores any speech here, but still wants a valid response.
      return { version: "1.0", response: {} };
    case "IntentRequest":
      break;
    default:
      return speak(replies.notUnderstood, { listen: false });
  }

  switch (request.intent?.name) {
    case PHRASE_INTENT: {
      const phrase = request.intent.slots?.[PHRASE_SLOT]?.value?.trim();
      if (!phrase) return speak(replies.notUnderstood, { listen: true });
      onPhrase(phrase);
      return speak(replies.heard(phrase), { listen: false });
    }
    case "AMAZON.HelpIntent":
      return speak(replies.help, { listen: true });
    case "AMAZON.StopIntent":
    case "AMAZON.CancelIntent":
    case "AMAZON.NavigateHomeIntent":
      return speak(replies.goodbye, { listen: false });
    default:
      // Includes AMAZON.FallbackIntent: something was said that fits none of the skill's sentences.
      return speak(replies.notUnderstood, { listen: true });
  }
};
