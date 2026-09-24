import { pino, type Logger } from "pino";

export type { Logger };

export const createLogger = (level: string): Logger =>
  pino({
    level,
    base: { service: "ha-gateway" },
    // Defence in depth: nothing should log these, but never let them reach the logs if it does.
    redact: {
      paths: [
        "access_token",
        "*.access_token",
        "token",
        "*.token",
        "req.headers.authorization",
        "headers.authorization",
      ],
      censor: "[redacted]",
    },
  });
