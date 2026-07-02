let CURRENT_PORT = '7382';
let HUB_URL = `http://localhost:${CURRENT_PORT}`;
let socket = null;
let lastProcessedSaveId = null; // Dedupe so a websocket push and a poll don't double-save
let processingSaveId = null;    // Guards against a push + poll capturing the same directive at once


chrome.runtime.onStartup.addListener(() => {
  initializeFlow();
});

chrome.runtime.onInstalled.addListener(() => {
  initializeFlow();
});

chrome.alarms.create('flow-keepalive', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flow-keepalive') {
    // If socket died while Chrome was asleep, restore it
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      initializeFlow();
    }
    // Fallback: catch any save directive we missed while the worker was down
    pollForSave();
  }
});

// Entry Point
async function initializeFlow() {
  const hubFound = await discoverHubPort();
  if (hubFound) {
    connectWebSocket();
  } else {
    console.log("Server offline. Retrying port discovery in 5s");
    setTimeout(initializeFlow, 5000);
  }
}

async function discoverHubPort() {
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
  socket = new WebSocket(`ws://localhost:${CURRENT_PORT}`);

  // As soon as we (re)connect, catch up on any directive we missed while offline
  socket.onopen = () => {
    console.log("Stream open");
    pollForSave();
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.action === 'save') {
        console.log(`Saving capsule: ${data.name}`);
        handleSaveDirective(data.saveId);
      }
    } catch (err) {
      console.error("Malformed packet received over stream:", err);
    }
  };

  // Auto-recovery: If the Hub drops or changes location, scan and reset
  socket.onclose = () => {
    console.log("Stream closed. Initializing recovery configuration in 5s");
    setTimeout(initializeFlow, 5000);
  };

  socket.onerror = (err) => {
    console.error("Stream runtime error:", err);
  };
}

// Fallback path: ask the Hub whether a save is pending. This covers the case
// where the websocket push was missed because the service worker was asleep
// or mid-reconnect when the directive was broadcast.
async function pollForSave() {
  try {
    const res = await fetch(`${HUB_URL}/check-save`);
    if (!res.ok) return;
    const { shouldSave, saveId } = await res.json();
    if (shouldSave) {
      handleSaveDirective(saveId);
    }
  } catch (e) {}
}

// Dedupe by saveId so the websocket push and the poll fallback don't both fire.
// Only mark a directive as "processed" once the submit actually succeeds —
// otherwise a transient failure would be swallowed and never retried.
async function handleSaveDirective(saveId) {
  if (saveId != null && (saveId === lastProcessedSaveId || saveId === processingSaveId)) return;
  processingSaveId = saveId;
  try {
    const ok = await captureAndSubmit();
    if (ok) lastProcessedSaveId = saveId;
  } finally {
    if (processingSaveId === saveId) processingSaveId = null;
  }
}

// Identify which Chrome profile this service worker belongs to. The `id` is a
// stable obfuscated gaia id and `email` is the signed-in account — either can be
// matched against Chrome's on-disk `Local State` at restore time so the CLI can
// reopen tabs in the exact profile they came from. Returns nulls if the profile
// isn't signed into a Google account.
async function getProfileInfo() {
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    return { email: info.email || null, gaiaId: info.id || null };
  } catch (e) {
    // Older Chrome (no details arg) or no identity access — degrade gracefully.
    try {
      const info = await chrome.identity.getProfileUserInfo();
      return { email: info.email || null, gaiaId: info.id || null };
    } catch (e2) {
      return { email: null, gaiaId: null };
    }
  }
}

async function captureAndSubmit() {
  const profile = await getProfileInfo();

  // Capture every tab across every window, not just the focused one. When the
  // save is triggered from the terminal Chrome isn't the focused app, so
  // `currentWindow` is ambiguous and often empty — that was dropping tabs.
  // Each extension instance only sees its own profile's tabs, so tag them with
  // this profile's identity to keep multiple profiles from clobbering each other.
  const tabs = await chrome.tabs.query({});
  const data = tabs.map(t => ({
    url: t.url,
    title: t.title,
    windowId: t.windowId,
    email: profile.email,
    gaiaId: profile.gaiaId
  }));

  // Never overwrite a good snapshot with an empty capture.
  if (data.length === 0) {
    console.warn("No tabs captured; skipping submit to avoid wiping saved tabs.");
    return false;
  }

  try {
    const res = await fetch(`${HUB_URL}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser',
        data,
        profile
      })
    });
    if (!res.ok) {
      console.error(`Hub rejected snapshot (HTTP ${res.status})`);
      return false;
    }
    console.log(`Sent browser data (${data.length} tabs) for profile ${profile.email || profile.gaiaId || 'unknown'}`);
    return true;
  } catch (err) {
    console.error("Failed to snapshot", err);
    return false;
  }
}

// Fire up the lifecycle engine on script boot
initializeFlow();
