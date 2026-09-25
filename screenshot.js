// Screenshots the "Company" tab (tab 3, password-protected) of the Daily Run Rate
// dashboard at 80% browser zoom and uploads the image to a Slack channel.
// Env: SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, DASHBOARD_PASSWORD, DASHBOARD_URL (optional)
const { chromium } = require("playwright");
const fs = require("fs");

const URL_TO_SHOT = process.env.DASHBOARD_URL || "https://dailyrunrate.sakshi-patel.workers.dev/";
const PASSWORD = process.env.DASHBOARD_PASSWORD;
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL = process.env.SLACK_CHANNEL_ID;

// Browser zoom 80% on a 1440px-wide window = a 1800px-wide layout, drawn smaller.
// Emulate that: wider layout viewport, and a matching pixel ratio so the image stays sharp.
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;
const ZOOM = 0.8;

async function screenshot() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: Math.round(WINDOW_WIDTH / ZOOM), height: Math.round(WINDOW_HEIGHT / ZOOM) },
      deviceScaleFactor: 2 * ZOOM,
    });

    await page.goto(URL_TO_SHOT, { waitUntil: "networkidle", timeout: 60000 });

    // Open tab 3: Company
    await page.click('nav.tabs button[data-tab="company"]');

    // Password screen: type the password and press Enter (same as a person would)
    const box = page.locator("#lockPassword-company");
    await box.waitFor({ state: "visible", timeout: 15000 });
    await box.fill(PASSWORD);
    await box.press("Enter");

    // Wait for the lock screen to disappear and the real dashboard to load
    await page.locator(".lockscreen").waitFor({ state: "detached", timeout: 30000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(4000); // let numbers / charts finish rendering

    const path = "dashboard.png";
    await page.screenshot({ path, fullPage: true });
    return path;
  } finally {
    await browser.close();
  }
}

async function upload(path) {
  const png = fs.readFileSync(path);

  // 1. Ask Slack for an upload URL
  const q = new URLSearchParams({ filename: "dashboard.png", length: String(png.length) });
  const step1 = await fetch(`https://slack.com/api/files.getUploadURLExternal?${q}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  }).then((r) => r.json());
  if (!step1.ok) throw new Error("getUploadURLExternal: " + step1.error);

  // 2. Upload the bytes
  const step2 = await fetch(step1.upload_url, { method: "POST", body: png });
  if (!step2.ok) throw new Error("upload failed: " + step2.status);

  // 3. Finish and share to the channel
  const date = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
  });
  const step3 = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [{ id: step1.file_id, title: `Daily Run Rate (Company) - ${date}` }],
      channel_id: CHANNEL,
      initial_comment: `Daily Run Rate - Company - ${date}`,
    }),
  }).then((r) => r.json());
  if (!step3.ok) throw new Error("completeUploadExternal: " + step3.error);
}

(async () => {
  if (!TOKEN || !CHANNEL) throw new Error("Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID");
  if (!PASSWORD) throw new Error("Missing DASHBOARD_PASSWORD");
  const path = await screenshot();
  await upload(path);
  console.log("Posted to Slack");
})().catch((e) => { console.error(e); process.exit(1); });
