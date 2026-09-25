// Screenshots the dashboard and uploads the image to a Slack channel.
// Env: SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, DASHBOARD_URL (optional)
const { chromium } = require("playwright");
const fs = require("fs");

const URL_TO_SHOT = process.env.DASHBOARD_URL || "https://dailyrunrate.sakshi-patel.workers.dev/";
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL = process.env.SLACK_CHANNEL_ID;

async function screenshot() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(URL_TO_SHOT, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000); // let charts / sheet data finish rendering
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
      files: [{ id: step1.file_id, title: `Daily Run Rate - ${date}` }],
      channel_id: CHANNEL,
      initial_comment: `Daily Run Rate dashboard - ${date}\n${URL_TO_SHOT}`,
    }),
  }).then((r) => r.json());
  if (!step3.ok) throw new Error("completeUploadExternal: " + step3.error);
}

(async () => {
  if (!TOKEN || !CHANNEL) throw new Error("Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID");
  const path = await screenshot();
  await upload(path);
  console.log("Posted to Slack");
})().catch((e) => { console.error(e); process.exit(1); });
