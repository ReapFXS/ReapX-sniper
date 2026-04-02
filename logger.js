import pino from 'pino';
import pretty from 'pino-pretty';

const stream = pretty({
  colorize: true,
  translateTime: 'HH:MM:ss',
  ignore: 'pid,hostname',
  messageFormat: '{msg}',
});

export const logger = pino({ level: 'info' }, stream);

export default logger;
