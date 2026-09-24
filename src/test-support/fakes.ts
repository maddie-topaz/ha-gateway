import { pino } from "pino";
import type { ServiceTransport } from "../home-assistant/services.js";
import type { OutgoingCommand } from "../home-assistant/types.js";

/** A real pino logger that records every line, so tests can assert on what gets logged. */
export const createCapturingLogger = () => {
  const lines: string[] = [];
  const logger = pino({ level: "debug" }, { write: (line: string) => void lines.push(line) });
  return {
    logger,
    output: () => lines.join(""),
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
};

/** Stands in for the HA connection. `respond` decides what each command resolves or rejects with. */
export const createFakeTransport = (respond: (command: OutgoingCommand) => unknown) => {
  const sent: OutgoingCommand[] = [];
  const transport: ServiceTransport = {
    sendCommand: async <T,>(command: OutgoingCommand) => {
      sent.push(command);
      return (await respond(command)) as T;
    },
  };
  return { transport, sent };
};

export const okResult = { context: { id: "01J0CONTEXT", parent_id: null, user_id: null } };
