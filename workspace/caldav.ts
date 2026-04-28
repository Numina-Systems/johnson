// Skill: apple-reminders
// Description: List, create, and complete reminders in Apple iCloud Reminders via CalDAV

// ── Config ──────────────────────────────────────────────────────────
const email = Deno.env.get("APPLE_EMAIL");
const password = Deno.env.get("APPLE_REMINDERS");
if (!email || !password)
  throw new Error("APPLE_EMAIL and APPLE_REMINDERS env vars required");

const AUTH = btoa(`${email}:${password}`);
const mkHeaders = (extra?: Record<string, string>) => ({
  Authorization: `Basic ${AUTH}`,
  "Content-Type": "application/xml; charset=utf-8",
  ...extra,
});

// ── Discovery ───────────────────────────────────────────────────────
async function discover(): Promise<string> {
  const r1 = await fetch("https://caldav.icloud.com/", {
    method: "PROPFIND",
    headers: { ...mkHeaders(), Depth: "0" },
    body: `<?xml version="1.0"?>
 <d:propfind xmlns:d="DAV:">
   <d:prop><d:current-user-principal/></d:prop>
 </d:propfind>`,
  });
  const t1 = await r1.text();
  const principal = t1.match(/<d:href>([^<]*principal[^<]*)<\/d:href>/)?.[1];
  if (!principal)
    throw new Error("Could not discover principal: " + t1.slice(0, 500));

  const base = "https://caldav.icloud.com";
  const r2 = await fetch(base + principal, {
    method: "PROPFIND",
    headers: { ...mkHeaders(), Depth: "0" },
    body: `<?xml version="1.0"?>
 <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
   <d:prop><c:calendar-home-set/></d:prop>
 </d:propfind>`,
  });
  const t2 = await r2.text();
  const home = t2
    .match(/<d:href>([^<]*)<\/d:href>/g)
    ?.map((m) => m.replace(/<\/?d:href>/g, ""))
    .find((h) => h.includes("/calendars/"));
  if (!home)
    throw new Error("Could not discover calendar home: " + t2.slice(0, 500));
  return home;
}

// ── List reminder lists (VTODO collections) ────────────────────────
async function listReminderLists(): Promise<
  Array<{ name: string; url: string }>
> {
  const home = await discover();
  const base = "https://caldav.icloud.com";
  const r = await fetch(base + home, {
    method: "PROPFIND",
    headers: { ...mkHeaders(), Depth: "1" },
    body: `<?xml version="1.0"?>
 <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
   <d:prop>
     <d:displayname/>
     <c:supported-calendar-component-set/>
   </d:prop>
 </d:propfind>`,
  });
  const text = await r.text();

  const lists: Array<{ name: string; url: string }> = [];
  const responses = text.split(/<d:response>/g).slice(1);
  for (const resp of responses) {
    const hasVTODO = /<c:comp\s[^>]*name="VTODO"/.test(resp);
    if (!hasVTODO) continue;
    const url = resp.match(/<d:href>([^<]+)<\/d:href>/)?.[1] ?? "";
    const name =
      resp.match(/<d:displayname>([^<]*)<\/d:displayname>/)?.[1] ?? url;
    if (url) lists.push({ name, url });
  }
  return lists;
}

// ── Fetch incomplete reminders ──────────────────────────────────────
async function listReminders(
  listUrl?: string,
): Promise<
  Array<{
    uid: string;
    summary: string;
    due: string | null;
    etag: string;
    url: string;
  }>
> {
  const lists = await listReminderLists();
  const target = listUrl ?? lists[0]?.url;
  if (!target) throw new Error("No reminder lists found");

  const base = "https://caldav.icloud.com";
  const r = await fetch(base + target, {
    method: "REPORT",
    headers: { ...mkHeaders(), Depth: "1" },
    body: `<?xml version="1.0"?>
 <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
   <d:prop>
     <d:getetag/>
     <c:calendar-data/>
   </d:prop>
   <c:filter>
     <c:comp-filter name="VCALENDAR">
       <c:comp-filter name="VTODO">
         <c:prop-filter name="STATUS">
           <c:text-match negate-condition="yes">COMPLETED</c:text-match>
         </c:prop-filter>
       </c:comp-filter>
     </c:comp-filter>
   </c:filter>
 </c:calendar-query>`,
  });
  const text = await r.text();

  const reminders: Array<{
    uid: string;
    summary: string;
    due: string | null;
    etag: string;
    url: string;
  }> = [];
  const responses = text.split(/<d:response>/g).slice(1);
  for (const resp of responses) {
    const url = resp.match(/<d:href>([^<]+)<\/d:href>/)?.[1] ?? "";
    const etag = resp.match(/<d:getetag>"?([^"<]+)"?<\/d:getetag>/)?.[1] ?? "";
    const ics =
      resp.match(/<c:calendar-data[^>]*>([\s\S]*?)<\/c:calendar-data>/)?.[1] ??
      "";
    const uid = ics.match(/UID:(.+)/)?.[1]?.trim() ?? "";
    const summary = ics.match(/SUMMARY:(.+)/)?.[1]?.trim() ?? "";
    const due = ics.match(/DUE[^:]*:(.+)/)?.[1]?.trim() ?? null;
    if (uid) reminders.push({ uid, summary, due, etag, url });
  }
  return reminders;
}

// ── Create a reminder ───────────────────────────────────────────────
async function createReminder(
  summary: string,
  opts?: { due?: string; listUrl?: string; priority?: number },
): Promise<string> {
  const lists = await listReminderLists();
  const target = opts?.listUrl ?? lists[0]?.url;
  if (!target) throw new Error("No reminder lists found");

  const uid = crypto.randomUUID().toUpperCase();
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//constellation//EN\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:${now}\r\nSUMMARY:${summary}\r\nSTATUS:NEEDS-ACTION\r\n`;
  if (opts?.due) {
    const d =
      new Date(opts.due).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    ics += `DUE:${d}\r\n`;
  }
  if (opts?.priority !== undefined) {
    ics += `PRIORITY:${opts.priority}\r\n`;
  }
  ics += `END:VTODO\r\nEND:VCALENDAR`;

  const base = "https://caldav.icloud.com";
  const r = await fetch(base + target + `${uid}.ics`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${AUTH}`,
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*",
    },
    body: ics,
  });
  if (!r.ok) throw new Error(`Create failed (${r.status}): ${await r.text()}`);
  return uid;
}

// ── Complete a reminder ─────────────────────────────────────────────
async function completeReminder(
  reminderUrl: string,
  etag: string,
): Promise<void> {
  const base = "https://caldav.icloud.com";

  const r1 = await fetch(base + reminderUrl, {
    method: "GET",
    headers: { Authorization: `Basic ${AUTH}` },
  });
  if (!r1.ok)
    throw new Error(`Fetch failed (${r1.status}): ${await r1.text()}`);
  let ics = await r1.text();
  const currentEtag = r1.headers.get("etag") ?? etag;

  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  ics = ics.replace(/STATUS:NEEDS-ACTION/, "STATUS:COMPLETED");
  if (!ics.includes("COMPLETED:")) {
    ics = ics.replace(/END:VTODO/, `COMPLETED:${now}\r\nEND:VTODO`);
  }

  const r2 = await fetch(base + reminderUrl, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${AUTH}`,
      "Content-Type": "text/calendar; charset=utf-8",
      "If-Match": currentEtag,
    },
    body: ics,
  });
  if (!r2.ok)
    throw new Error(`Update failed (${r2.status}): ${await r2.text()}`);
}

// ── Command dispatch ────────────────────────────────────────────────
declare const __args: string[];
const args = typeof __args !== "undefined" ? __args : [];
const command = args[0];
switch (command) {
  case "lists": {
    const lists = await listReminderLists();
    output(lists);
    break;
  }
  case "list": {
    const reminders = await listReminders(args[1]);
    output(reminders);
    break;
  }
  case "create": {
    const summary = args[1];
    if (!summary)
      throw new Error("Usage: create <summary> [due-date] [list-url]");
    const uid = await createReminder(summary, {
      due: args[2],
      listUrl: args[3],
    });
    output({ created: uid, summary });
    break;
  }
  case "complete": {
    const url = args[1];
    const etag = args[2];
    if (!url || !etag) throw new Error("Usage: complete <reminder-url> <etag>");
    await completeReminder(url, etag);
    output({ completed: url });
    break;
  }
  default:
    output(
      "Commands: lists, list [list-url], create <summary> [due] [list-url], complete <url> <etag>",
    );
}
