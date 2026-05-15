let CURRENT_PORT = '7382'; // Start with default
let HUB_URL = `http://localhost:${CURRENT_PORT}`;

// 1. Create an alarm to wake up the service worker every minute
chrome.alarms.create('keep-alive-poll', { periodInMinutes: 1 });

// 2. Listen for the alarm to wake up
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keep-alive-poll') {
    console.log("⏰ Alarm wake-up: Checking Hub...");
    checkHub();
  }
});

// 3. Keep a regular interval running while the worker IS active
setInterval(checkHub, 2000);

let lastId = null;

async function checkHub() {
  try {
    const res = await fetch(`${HUB_URL}/check-save`);
    if (!res.ok) throw new Error();

    const { shouldSave, saveId } = await res.json();
    
    if (shouldSave && saveId !== lastId) {
      lastId = saveId;
      captureAndSubmit();
    }
  } catch (err) {
    discoverNewPort()
  }
}

async function discoverNewPort() {
  console.log("Searching for Hub...");
  // Scan a small range of ports where the Hub usually lives
  for (let port = 7382; port < 7399; port++) {
    try {
      const tester = await fetch(`http://localhost:${port}/`);
      if (tester.ok) {
        CURRENT_PORT = port.toString();
        HUB_URL = `http://localhost:${port}`;
        console.log(`Found Hub on new port: ${port}`);
        return;
      }
    } catch (e) {}
  }
}

async function captureAndSubmit() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const data = tabs.map(t => ({ url: t.url, title: t.title }));

  await fetch(`${HUB_URL}/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'browser',
      data
    })
  });
  console.log("✅ Browser synced.");
}