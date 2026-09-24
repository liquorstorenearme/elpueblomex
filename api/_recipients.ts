// Every website form notification goes to one inbox (owner decision, 2026-09-24).
// EP_FORMS_TO (comma-separated) may override it later; it is intentionally a NEW
// variable name so the existing EP_TO_EMAIL / EP_*_TO values no longer apply.
export const FORM_TO: string = process.env.EP_FORMS_TO || "marciano@elpueblomex.com";
