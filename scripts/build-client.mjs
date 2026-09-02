import { build, createLogger } from 'vite';

const logger = createLogger('info');
const warnings = [];
const seenWarnings = new Set();
const originalWarn = logger.warn.bind(logger);
const originalWarnOnce = logger.warnOnce.bind(logger);

const recordWarning = (message) => {
  if (!seenWarnings.has(message)) {
    seenWarnings.add(message);
    warnings.push(message);
  }
};

logger.warn = (message, options) => {
  recordWarning(message);
  originalWarn(message, options);
};

logger.warnOnce = (message, options) => {
  recordWarning(message);
  originalWarnOnce(message, options);
};

await build({ customLogger: logger });

if (warnings.length > 0) {
  throw new Error('Client build emitted ' + warnings.length + ' warning(s).');
}
