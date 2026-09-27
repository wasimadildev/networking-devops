import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * Attaches a correlation id to every request and to every log line emitted while
 * handling it.
 *
 * The id is honoured from the inbound header when the gateway sets one, so a
 * single trace can be followed from Application Gateway through to the app tier.
 * An inbound id is length-limited and character-restricted because it is
 * attacker-controlled: an unbounded value would land in every log line and could
 * be used to inject content into a log pipeline.
 */
const INBOUND_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const requestContext: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  const requestId = inbound && INBOUND_ID.test(inbound) ? inbound : randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};
