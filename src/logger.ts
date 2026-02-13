import { mkdirSync } from "node:fs";
import path from "node:path";
import winston from "winston";

const consoleFormat = winston.format.printf((info) => {
  const level = info.level;
  let msg = "";
  let errorStr = "";

  if (typeof info.message === "string") {
    msg = info.message;
  } else if (info.message && typeof info.message === "object") {
    const msgObj = info.message as Record<string, unknown>;
    if (typeof msgObj.msg === "string") {
      msg = msgObj.msg;
    }
    if (typeof msgObj.error === "string") {
      errorStr = ` - ${msgObj.error}`;
    }
    if (!msg) {
      try {
        msg = JSON.stringify(msgObj);
      } catch {
        msg = "[unserializable object]";
      }
    }
  } else {
    const topLevel = info as Record<string, unknown>;
    if (typeof topLevel.msg === "string") {
      msg = topLevel.msg;
    }
    if (typeof topLevel.error === "string") {
      errorStr = ` - ${topLevel.error}`;
    }
  }

  if (!msg) {
    try {
      const { level: _l, timestamp: _t, service: _s, ...rest } = info as Record<string, unknown>;
      msg = Object.keys(rest).length > 0 ? JSON.stringify(rest) : "[empty message]";
    } catch {
      msg = "[unserializable]";
    }
  }

  return `${level}: ${msg}${errorStr}`;
});

const logDir = path.join(process.env.WOPR_HOME || "/tmp/wopr-test", "logs");
mkdirSync(logDir, { recursive: true });

export const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "wopr-plugin-irc" },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, "irc-plugin-error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logDir, "irc-plugin.log"),
      level: "debug",
    }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), consoleFormat),
      level: "warn",
    }),
  ],
});
