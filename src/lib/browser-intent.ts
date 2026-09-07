const BROWSER_WORDS = /\b(?:browse|search|look up|research|visit|navigate to|go to|open (?:a |the )?(?:site|website|url|webpage)|on the web|online|website|webpage|latest (?:news|updates|information))\b/i;
const WEB_ADDRESS = /https?:\/\/|(?:^|\s)(?:www\.)?[a-z0-9-]+(?:\.[a-z]{2,})(?:[/?#][^\s]*)?(?=\s|$|[,.!?])/i;

/** Prompts that should reveal and route through the hosted live browser. */
export function hasBrowserIntent(text: string): boolean {
  return BROWSER_WORDS.test(text) || WEB_ADDRESS.test(text);
}
