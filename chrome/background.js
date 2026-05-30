let CURRENT_PORT = '7382'; 
let HUB_URL = `http://localhost:${CURRENT_PORT}`;
let socket = null;


chrome.runtime.onStartup.addListener(() => {
  console.log("☀️ Chrome started! Initializing Flow Link...");
  initializeFlow();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 Extension installed/reloaded!");
  initializeFlow();
});

chrome.alarms.create('flow-keepalive', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flow-keepalive') {
    console.log("⏰ Heartbeat alarm fired. Checking socket integrity...");
    // If socket died while Chrome was asleep, restore it
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      initializeFlow();
    }
  }
});

// Entry Point
async function initializeFlow() {
  const hubFound = await discoverHubPort();
  if (hubFound) {
    connectWebSocket();
  } else {
    console.log("Hub offline. Retrying port discovery in 5s...");
    setTimeout(initializeFlow, 5000);
  }
}

async function discoverHubPort() {
  console.log("Searching for Hub port...");
  // Scan the dedicated safe port range
  for (let port = 7382; port <= 7399; port++) {
    try {
      const tester = await fetch(`http://localhost:${port}/`);
      if (tester.ok) {
        const text = await tester.text();
        if (text === 'Hub is alive') { // Explicitly verify it's YOUR app!
          CURRENT_PORT = port.toString();
          HUB_URL = `http://localhost:${port}`;
          return true;
        }
      }
    } catch (e) {}
  }
  return false;
}

function connectWebSocket() {
  if (socket) {
    try { socket.close(); } catch(e) {}
  }

  console.log(`Opening stream connection to: ws://localhost:${CURRENT_PORT}`);
  socket = new WebSocket(`ws://localhost:${CURRENT_PORT}`);

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.action === 'save') {
        console.log(`🚀 Save directive caught for capsule: ${data.name}`);
        captureAndSubmit();
      }
    } catch (err) {
      console.error("Malformed packet received over stream:", err);
    }
  };

  // Auto-recovery: If the Hub drops or changes location, scan and reset
  socket.onclose = () => {
    console.log("❌ Stream closed. Initializing recovery configuration in 5s...");
    setTimeout(initializeFlow, 5000);
  };

  socket.onerror = (err) => {
    console.error("Stream runtime error:", err);
  };
}

async function captureAndSubmit() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const data = tabs.map(t => ({ url: t.url, title: t.title }));

  try {
    await fetch(`${HUB_URL}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser',
        data
      })
    });
    console.log("✅ Browser state checkpoint complete.");
  } catch (err) {
    console.error("Failed to ship snapshot to Hub:", err);
  }
}

// Fire up the lifecycle engine on script boot
initializeFlow();