/**
 * Cheap keyword match: given the last user message text and a list of skill
 * names, return the top-N skills whose name keywords appear in the text.
 *
 * Scoring: skill name is split on [-_] into keywords; each keyword >= 3 chars
 * that appears in the message adds its length to the score.  Longer exact
 * matches win over short common substrings.
 *
 * Used to prepend a one-line hint to the per-request system prompt so the
 * model is nudged toward the right skill without loading the skill content.
 */
export function suggestSkills(
  userText: string,
  availableSkills: string[],
  topN = 3,
): string[] {
  if (!userText.trim() || availableSkills.length === 0) return [];

  const lower = userText.toLowerCase();
  const scored: Array<{ skill: string; score: number }> = [];

  for (const skill of availableSkills) {
    const keywords = skill.toLowerCase().split(/[-_]/);
    let score = 0;
    for (const kw of keywords) {
      if (kw.length >= 3 && lower.includes(kw)) {
        score += kw.length;
      }
    }
    if (score > 0) scored.push({ skill, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => s.skill);
}

/** Extract plain text from the last user UIMessage for skill matching. */
export function extractLastUserText(
  messages: Array<{ role: string; parts?: unknown }>,
): string {
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last?.parts || !Array.isArray(last.parts)) return '';
  return (last.parts as Array<Record<string, unknown>>)
    .filter(p => p['type'] === 'text' && typeof p['text'] === 'string')
    .map(p => p['text'] as string)
    .join(' ');
}
