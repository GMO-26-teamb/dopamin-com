/**
 * globals.css の `@utility text-*`（Figma の Text Style 25 種）と 1:1。
 * tokens.json の textStyles[].utility と一致させること（text-styles.test.ts が守る）。
 * `cn()` がこれらを font-size / font-weight / font-family / leading / tracking と
 * 競合するグループとして扱うために使う。
 */
export const TEXT_STYLE_UTILITIES = [
  "text-display-hero",
  "text-display-score",
  "text-display-score-sm",
  "text-heading-page",
  "text-heading-section",
  "text-heading-card",
  "text-domain-lg",
  "text-domain-card",
  "text-domain-sm",
  "text-brand-logo",
  "text-brand-logo-latin",
  "text-brand-goku",
  "text-brand-goku-sm",
  "text-body-lead",
  "text-body",
  "text-body-sm",
  "text-label",
  "text-label-sm",
  "text-label-xs",
  "text-caption",
  "text-caption-sm",
  "text-overline",
  "text-code",
  "text-code-label",
  "text-code-input",
] as const;

export type TextStyleUtility = (typeof TEXT_STYLE_UTILITIES)[number];
