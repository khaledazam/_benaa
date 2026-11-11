/**
 * Logger Utility
 * Centralized logging utility for development-only console logs
 * Automatically sends errors to Sentry in production when configured
 */

import { isAxiosError, isExpectedClientError } from "@/lib/api/errors";
import { captureException, captureMessage } from "@/lib/monitoring/sentry";
import { redactLogValue, redactText, sanitizedError } from './log-redaction';

/**
 * Log levels
 */
type LogLevel = "log" | "error" | "warn" | "info" | "debug";

/**
 * Logger interface
 */
interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Extract error from logger arguments
 */
function extractError(args: unknown[]): Error | null {
  if (args.length === 0) {
    return null;
  }

  const firstArg = args[0];
  if (firstArg instanceof Error) {
    return firstArg;
  }

  // Try to create error from string or object
  if (typeof firstArg === "string") {
    return new Error(firstArg);
  }

  if (typeof firstArg === "object" && firstArg !== null) {
    if ("error" in firstArg && firstArg.error instanceof Error) {
      return firstArg.error as Error;
    }
    if ("message" in firstArg && typeof firstArg.message === "string") {
      return new Error(firstArg.message as string);
    }
  }

  return null;
}

/**
 * Resolve the primary error/cause from logger.error arguments
 */
function resolvePrimaryError(args: unknown[]): unknown {
  if (args.length > 1) {
    if (args[1] instanceof Error) {
      return args[1];
    }
    if (isAxiosError(args[1])) {
      return args[1];
    }
  }
  return extractError(args);
}

/**
 * Create a logger function for a specific level
 */
const createLogger = (level: LogLevel): (...args: unknown[]) => void => {
  if (process.env.NODE_ENV === "production") {
    // In production, send errors to Sentry and suppress console logs
    if (level === "error") {
      return (...args: unknown[]) => {
        emitStructured(level, args);
        const primary = resolvePrimaryError(args);
        if (isExpectedClientError(primary)) {
          return;
        }

        // Pattern: logger.error("label:", realError) — use the Error instance as primary exception
        // so Sentry shows the real error message, not the label string
        if (
          args.length > 1 &&
          args[1] instanceof Error &&
          typeof args[0] === "string"
        ) {
          captureException(sanitizedError(args[1]), { label: redactText(args[0]) });
          return;
        }
        const error = extractError(args);
        if (error) {
          // Send to Sentry if configured
          if (args.length > 1 && typeof args[1] === "object") {
            captureException(sanitizedError(error), redactLogValue(args[1]) as Record<string, unknown>);
          } else {
            captureException(sanitizedError(error));
          }
        } else if (args.length > 0) {
          // Try to send as message if not an error
          const message = String(args[0]);
          const context =
            args.length > 1 && typeof args[1] === "object"
              ? (args[1] as Record<string, unknown>)
              : undefined;
          captureMessage(redactText(message), "error", redactLogValue(context) as Record<string, unknown> | undefined);
        }
      };
    }
    if (level === "warn") {
      return (...args: unknown[]) => {
        emitStructured(level, args);
        if (args.length > 0) {
          const message = String(args[0]);
          const context =
            args.length > 1 && typeof args[1] === "object"
              ? (args[1] as Record<string, unknown>)
              : undefined;
          captureMessage(redactText(message), "warning", redactLogValue(context) as Record<string, unknown> | undefined);
        }
      };
    }
    return (...args: unknown[]) => { if (level !== 'debug') emitStructured(level, args); };
  }

  // Development mode: log to console
  return (...args: unknown[]) => {
    const sink = globalThis.console;
    sink[level](...args.map(value => redactLogValue(value)));
  };
};

function emitStructured(level: LogLevel, args: unknown[]) {
  // Aliased sink intentionally survives removeConsole in the production compiler.
  const sink = globalThis.console;
  sink[level](JSON.stringify({ timestamp: new Date().toISOString(), level, event: args.map(value => redactLogValue(value)) }));
}

/**
 * Logger instance
 * Only logs in development mode
 * Sends errors to Sentry in production when configured
 */
export const logger: Logger = {
  log: createLogger("log"),
  error: createLogger("error"),
  warn: createLogger("warn"),
  info: createLogger("info"),
  debug: createLogger("debug"),
};
