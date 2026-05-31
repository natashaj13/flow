# Privacy Policy for Flow Extension

Last updated: May 2026

This privacy policy governs your use of the Flow companion browser extension. The extension captures active browser tab data to pair with the Flow command-line workspace checkpointer.

## 1. Data Collection and Usage
The extension requests permissions to access your browser's active tabs (`tabs`). This permission is used exclusively to read the titles and URLs of your currently open browser windows when you explicitly trigger a workspace snapshot command via the companion local CLI tool.

## 2. Zero Remote Transmission (Local-Only Storage)
We care deeply about your privacy. **Absolutely none of your browsing data, history, or metadata is ever transmitted to remote external servers, third parties, or cloud storage.** All captured tab data is transferred securely via a local loopback network directly to your machine's local disk, where it is stored inside your user directory. You retain 100% ownership and control over your data.

## 3. Background Processing
The extension utilizes the native browser alarms API to maintain a local connection heartbeat to your computer's background app server. No analytics or behavioral tracking tracking scripts are running within this background context.

## 4. Changes to This Policy
We may update our Privacy Policy from time to time. Any changes will be reflected by updating the "Last updated" date at the top of this page.

## 5. Contact
If you have any questions regarding privacy while using the Extension, please open an issue on our official project repository.