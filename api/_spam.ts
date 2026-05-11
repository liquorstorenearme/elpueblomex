// Shared spam filter for all form handlers.
// Catches B2B cold-outreach (web dev pitches, SaaS demos, SEO services) sent
// through public contact/inquiry forms. Tune patterns here; all 6 handlers
// inherit the change.

const PATTERNS: RegExp[] = [
  // Service pitches
  /\b(web|website|app|software|wordpress|shopify|wix|squarespace)\s+(developer|designer|design|development)\b/i,
  /\b(seo|digital marketing|lead generation|google ads|facebook ads|social media)\s+(expert|specialist|service|agency|company)/i,
  /\b(graphic|logo|brand)\s+(designer|design)\b/i,
  // Pricing tells
  /\$\s?\d{1,3}\s?\/?\s?(hr|hour|per\s+hour)/i,
  /\b(affordable|cheap|low[-\s]?cost|competitive)\s+(rates?|pricing|price)\b/i,
  // Cold-call CTAs
  /\b(15[-\s]?min(ute)?|quick|brief|short|free)\s+(call|zoom|meeting|demo|audit|trial|consultation)\b/i,
  /\bvideo\s+call\b/i,
  /\bwalk\s+(you\s+through|through\s+how)\b/i,
  /\bjump\s+on\s+a\s+(call|zoom)/i,
  // Unsubscribe footers — no real customer writes these
  /reply\s+["']?stop["']?/i,
  /\bnot\s+(a\s+fit|interested)\??\s+(reply|just\s+reply)/i,
  /\bref:\s*[a-z0-9_-]+/i,
  /\bopt[-\s]?out\b/i,
  // Self-intro from-a-stranger pattern
  /\b(this\s+is|i\s+am|my\s+name\s+is)\s+\w+[,.]?\s+(and\s+)?i\s+(am|build|help|specialize|develop|create|design|run)\b/i,
  // Generic outreach hooks
  /\b(boost|increase|grow|scale|10x|2x|3x)\s+your\s+(business|revenue|sales|traffic|conversions?|leads?)\b/i,
  /\bgenerate\s+more\s+(leads|sales|customers|revenue)\b/i,
];

export function looksLikeSpam(message: string, email: string, name: string): boolean {
  const blob = `${name}\n${email}\n${message}`;
  for (const re of PATTERNS) if (re.test(blob)) return true;
  // 2+ URLs in the message body is almost always a sales pitch
  const urlCount = (message.match(/https?:\/\//gi) || []).length;
  if (urlCount >= 2) return true;
  return false;
}
