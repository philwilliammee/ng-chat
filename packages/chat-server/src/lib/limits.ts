import type { UIMessage } from 'ai';

/**
 * Caps on how *much* a single request may carry. The rate limiter caps how
 * *often* an IP may post; without these, one permitted request can still ship an
 * arbitrarily large `messages` array straight through to a metered gateway.
 *
 * `clipHistory` is not a substitute: it trims to fit the model's context, so an
 * oversized body still buys tokenization, compaction and a gateway call before
 * anything notices.
 *
 * What these caps do **not** do is bound bytes on the wire. They run on an
 * already-parsed body, so the read and the `JSON.parse` are paid before
 * `checkRequestLimits` is reached, and they count visible text only (see
 * `textLength`) — a hand-written body can carry megabytes of file or tool parts
 * and pass. A byte bound needs Hono's `bodyLimit` middleware or a limit at the
 * reverse proxy; these caps sit downstream of that and bound what reaches the
 * *model*.
 */
export interface RequestLimits {
  /** Max characters of visible text in a single message. */
  maxMessageChars: number;
  /** Max characters of visible text across the whole conversation. */
  maxTotalChars: number;
  /** Max messages in the conversation. */
  maxMessages: number;
}

/**
 * Sized as abuse backstops, not UX limits. ng-chat's default posture is an
 * agentic assistant used by a trusted operator, where pasting a whole source
 * file into a turn is ordinary — a cap tight enough to be felt in normal use
 * would be the wrong trade. A deployment exposed to anonymous visitors should
 * tighten these by an order of magnitude (a long question is a few hundred
 * characters) via `ChatRouterConfig.limits`.
 */
export const DEFAULT_LIMITS: RequestLimits = {
  maxMessageChars: 100_000,
  maxTotalChars: 1_000_000,
  maxMessages: 500,
};

/**
 * Characters of visible text in a message. Only `text` parts count.
 *
 * Tool and file parts are excluded because charging them against a *text* budget
 * gives the wrong answer in both directions: a single base64 image outweighs
 * every message in a long conversation, and a legitimate agentic turn would be
 * rejected for tool output the caller never typed. So the budget measures the one
 * thing a human is aware of sending.
 *
 * The cost is that these are not a size bound on the request. An ordinary client
 * only sends parts it produced, but nothing stops a hand-written body from
 * carrying unbounded `file` or `tool-*` parts through this check — bound bytes
 * with `bodyLimit`, not with these caps.
 */
export function textLength(message: UIMessage): number {
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return 0;
  let total = 0;
  for (const part of parts as Array<{ type?: string; text?: unknown }>) {
    if (part?.type === 'text' && typeof part.text === 'string') total += part.text.length;
  }
  return total;
}

/**
 * Merges caller overrides onto `DEFAULT_LIMITS`, ignoring keys explicitly set to
 * `undefined`. A plain spread does not: `{ ...DEFAULT_LIMITS, maxMessages: undefined }`
 * yields `undefined`, every `n > undefined` is false, and the cap is silently gone.
 * That shape is easy to reach by accident — it is what forwarding an optional
 * config field produces — so a security control should not depend on the caller
 * stripping the key first.
 */
export function resolveLimits(overrides?: Partial<RequestLimits>): RequestLimits {
  const resolved = { ...DEFAULT_LIMITS };
  if (!overrides) return resolved;
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof RequestLimits>) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value)) resolved[key] = value;
  }
  return resolved;
}

export interface LimitViolation {
  status: 400 | 413;
  error: string;
}

/**
 * Returns the first violated limit, or `null` when the request is within budget.
 *
 * The status codes differ on purpose. An over-long *single message* is a 400: the
 * caller can shorten what they are about to send. An over-long *conversation* is
 * a 413 — the caller cannot unsend the history that got them here, so the message
 * names the action that actually resolves it.
 */
export function checkRequestLimits(
  messages: UIMessage[],
  limits: RequestLimits,
): LimitViolation | null {
  if (messages.length > limits.maxMessages) {
    return {
      status: 413,
      error: `This conversation has too many messages (limit ${limits.maxMessages}). Start a new conversation, or compact this one.`,
    };
  }

  const perMessage = messages.map(textLength);

  if (perMessage.some(n => n > limits.maxMessageChars)) {
    return {
      status: 400,
      error: `That message is too long — please keep it under ${limits.maxMessageChars} characters.`,
    };
  }

  const total = perMessage.reduce((sum, n) => sum + n, 0);
  if (total > limits.maxTotalChars) {
    return {
      status: 413,
      error: `This conversation has grown too large (limit ${limits.maxTotalChars} characters). Start a new conversation, or compact this one.`,
    };
  }

  return null;
}
