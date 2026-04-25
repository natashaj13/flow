// This runs when you click the extension icon
chrome.action.onClicked.addListener((tab) => {
  console.log("Snapshot triggered!");
  
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const urls = tabs.map(t => t.url);
    
    fetch('http://localhost:3000/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser',
        data: urls,
        capsuleName: 'undefined' // Hardcode for now to test
      })
    })
    .then(response => console.log("Hub responded:", response.status))
    .catch(err => console.error("Hub connection failed:", err));
  });
});