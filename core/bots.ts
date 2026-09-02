/**
 * Bot detection.
 *
 * A user agent that matches this pattern is treated as automated. When
 * `IGNORE_BOTS` is on, such a request is answered with the current count but the
 * counter is not incremented. The list favours precision over recall. It catches
 * common crawlers and link preview fetchers and misses everything else.
 */

const TOKENS = [
  "bot",
  "crawler",
  "spider",
  "crawl",
  "slurp",
  "facebookexternalhit",
  "facebot",
  "embedly",
  "quora link preview",
  "outbrain",
  "pinterest",
  "developers\\.google\\.com/\\+/web/snippet",
  "www\\.google\\.com/webmasters/tools",
  "chrome-lighthouse",
  "google-inspectiontool",
  "google page speed",
  "headlesschrome",
  "phantomjs",
  "preview",
  "fetch",
  "monitor",
  "uptime",
  "pingdom",
  "curl",
  "wget",
  "python-requests",
  "python-httpx",
  "go-http-client",
  "node-fetch",
  "axios",
  "okhttp",
  "java/",
  "libwww-perl",
  "http_request",
  "whatsapp",
  "telegrambot",
  "discordbot",
  "slackbot",
  "twitterbot",
  "linkedinbot",
  "redditbot",
  "applebot",
  "bingpreview",
  "yandex",
  "baiduspider",
  "duckduckbot",
  "petalbot",
  "semrushbot",
  "ahrefsbot",
  "mj12bot",
  "dotbot",
  "gptbot",
  "claudebot",
  "ccbot",
  "perplexitybot",
];

/** Default value for `BOT_PATTERN`. Case insensitive. */
export const DEFAULT_BOT_PATTERN: RegExp = new RegExp(TOKENS.join("|"), "i");

/** True when the user agent looks automated. */
export function isBot(userAgent: string | null, pattern: RegExp = DEFAULT_BOT_PATTERN): boolean {
  if (!userAgent) return true;
  return pattern.test(userAgent);
}
