// Personal email providers. A lead can't book a call with one of these: BDRs and growth managers kept getting
// calendar bookings from Gmail and AOL addresses they couldn't tie to a district (Nov 2026).
// public/index.html keeps a copy of this list for the instant check on the page; keep them in sync.

export const PERSONAL_DOMAINS = new Set([
  // Google, Yahoo, Microsoft, AOL, Apple
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "aol.com", "aim.com", "icloud.com", "me.com", "mac.com",
  // US internet providers
  "comcast.net", "xfinity.com", "att.net", "sbcglobal.net", "bellsouth.net", "verizon.net", "cox.net", "charter.net",
  "spectrum.net", "optonline.net", "earthlink.net", "frontier.com", "frontiernet.net", "windstream.net", "centurylink.net",
  "juno.com", "netzero.net", "roadrunner.com", "twc.com",
  // Canadian providers
  "rogers.com", "shaw.ca", "sympatico.ca", "bell.net", "telus.net", "videotron.ca",
  // Privacy and other free mail
  "protonmail.com", "proton.me", "pm.me", "gmx.com", "gmx.us", "mail.com", "zoho.com", "yandex.com", "hey.com",
  "fastmail.com", "tutanota.com", "duck.com",
]);

// Country versions: yahoo.co.uk, hotmail.fr, outlook.es, live.ca and so on.
const PERSONAL_FAMILIES = /^(gmail|yahoo|hotmail|outlook|live|aol)\.[a-z.]+$/;

export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
}

export function isPersonalEmail(email: string): boolean {
  const domain = normalizeEmail(email).split("@")[1] ?? "";
  return PERSONAL_DOMAINS.has(domain) || PERSONAL_FAMILIES.test(domain);
}
