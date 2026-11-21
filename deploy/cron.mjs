const secret = process.env.CRON_SECRET;
if (!secret || secret.length < 32) throw new Error("CRON_SECRET must contain at least 32 characters");
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const response = await fetch("http://app:3000/api/cron/publish", { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(300000) });
    if (!response.ok) console.error(`Cron returned HTTP ${response.status}`);
  } catch { console.error("Cron request failed"); }
  finally { running = false; }
}
void tick();
setInterval(tick, 60000);
