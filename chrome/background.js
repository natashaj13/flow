const HUB_URL = 'http://localhost:3000';

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
  const res = await fetch('http://localhost:3000/check-save');
  const { shouldSave, saveId } = await res.json();
  
  if (shouldSave && saveId !== lastId) {
    lastId = saveId;
    captureAndSubmit();
  }
}

async function captureAndSubmit() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const urls = tabs.map(t => t.url);

  await fetch(`${HUB_URL}/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'browser',
      data: urls
    })
  });
  console.log("✅ Browser synced.");
}