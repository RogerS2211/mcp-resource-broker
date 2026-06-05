// Chrome MV3 service worker. Connects to the broker as a RESOURCE named
// "demo-browser", executes incoming commands against the active tab, and relays
// the roster to the popup so you can pick which AI session is active.
//
// Firefox note: replace the manifest "background" with
//   "background": { "scripts": ["extension-client.js", "background.js"] }
// and delete the importScripts line below (scripts are loaded in order instead).

importScripts('extension-client.js'); // provides self.BrokerResource

let latestRoster = { resources: [], controllers: [], holders: {} };

const resource = new BrokerResource({
    name: 'demo-browser',
    mode: 'exclusive',
    onCommand: async ({ action }) => {
        if (action === 'get_active_tab') {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (!tab) return { ok: false, error: 'no active tab' };
            return { ok: true, data: { title: tab.title, url: tab.url } };
        }
        if (action === 'list_tabs') {
            const tabs = await chrome.tabs.query({});
            return { ok: true, data: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })) };
        }
        return { ok: false, error: `unknown action: ${action}` };
    },
    onRoster: (r) => { latestRoster = r; }
});
resource.connect();

// Popup <-> background bridge.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'getInstances') {
        sendResponse({ connected: resource.connected, roster: latestRoster });
        return false;
    }
    if (msg.action === 'setInstance') {
        resource.select(msg.id);
        sendResponse({ ok: true });
        return false;
    }
});

// Keep the service worker alive enough to hold the broker connection.
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === 'keepalive' && !resource.connected) resource.connect();
});
