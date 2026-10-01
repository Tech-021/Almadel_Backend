const fs = require("fs");
const path = require("path");

const LOG_DIR = path.resolve(
  process.env.LOG_DIR || path.join(__dirname, "..", "logs"),
);
const LOG_TO_CONSOLE = process.env.LOG_TO_CONSOLE !== "false";
const LOG_REQUESTS = process.env.LOG_REQUESTS !== "false";

let installed = false;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function logFile(kind, date = new Date()) {
  return path.join(LOG_DIR, `${kind}-${dayStamp(date)}.log`);
}

function serializeArg(arg) {
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function writeLine(kind, level, args) {
  try {
    ensureLogDir();
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(serializeArg).join(" ")}\n`;
    fs.appendFileSync(logFile(kind), line, "utf8");
    if (kind !== "error" && (level === "ERROR" || level === "WARN")) {
      fs.appendFileSync(logFile("error"), line, "utf8");
    }
  } catch (error) {
    if (LOG_TO_CONSOLE) {
      process.stderr.write(`logger write failed: ${error.message}\n`);
    }
  }
}

function log(level, ...args) {
  const kind = level === "ERROR" || level === "WARN" ? "error" : "app";
  writeLine(kind === "error" ? "error" : "app", level, args);
  // Always also mirror app lines that are errors into app.log for a single stream
  if (kind === "error") {
    writeLine("app", level, args);
  }
  if (LOG_TO_CONSOLE) {
    const fn =
      level === "ERROR"
        ? console._originalError || console.error
        : level === "WARN"
          ? console._originalWarn || console.warn
          : console._originalLog || console.log;
    fn.apply(console, args);
  }
}

const logger = {
  info: (...args) => log("INFO", ...args),
  warn: (...args) => log("WARN", ...args),
  error: (...args) => log("ERROR", ...args),
  debug: (...args) => log("DEBUG", ...args),
};

/**
 * Tee console.log / warn / error into daily log files under /logs.
 * Safe to call once at process start (index.js).
 */
function installFileLogging() {
  if (installed) return logger;
  installed = true;
  ensureLogDir();

  console._originalLog = console.log.bind(console);
  console._originalWarn = console.warn.bind(console);
  console._originalError = console.error.bind(console);

  console.log = (...args) => {
    writeLine("app", "INFO", args);
    if (LOG_TO_CONSOLE) console._originalLog(...args);
  };
  console.warn = (...args) => {
    writeLine("app", "WARN", args);
    writeLine("error", "WARN", args);
    if (LOG_TO_CONSOLE) console._originalWarn(...args);
  };
  console.error = (...args) => {
    writeLine("app", "ERROR", args);
    writeLine("error", "ERROR", args);
    if (LOG_TO_CONSOLE) console._originalError(...args);
  };

  writeLine("app", "INFO", [`File logging enabled → ${LOG_DIR}`]);
  return logger;
}

/** Express middleware: one access line per request. */
function requestLogMiddleware(req, res, next) {
  if (!LOG_REQUESTS) return next();
  const started = Date.now();
  res.on("finish", () => {
    const businessId = req.businessId || req.headers["x-business-id"] || "-";
    const userId = req.user?.id || "-";
    writeLine("access", "INFO", [
      req.method,
      req.originalUrl || req.url,
      res.statusCode,
      `${Date.now() - started}ms`,
      `user=${userId}`,
      `business=${businessId}`,
      `ip=${req.ip || req.socket?.remoteAddress || "-"}`,
    ]);
  });
  next();
}

module.exports = {
  logger,
  installFileLogging,
  requestLogMiddleware,
  LOG_DIR,
};
