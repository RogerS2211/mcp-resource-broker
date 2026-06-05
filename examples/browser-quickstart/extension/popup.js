const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');

async function load() {
    listEl.innerHTML = '';
    let resp;
    try {
        resp = await chrome.runtime.sendMessage({ action: 'getInstances' });
    } catch (e) {
        statusEl.textContent = 'Could not reach the extension background.';
        return;
    }
    if (!resp || !resp.connected) {
        statusEl.textContent = 'Broker not connected. Start it: npx mcp-resource-broker';
        return;
    }
    const roster = resp.roster || { controllers: [], holders: {} };
    const active = new Set(Object.values(roster.holders || {}));
    if (!roster.controllers.length) {
        statusEl.textContent = 'Broker is up, but no AI sessions are connected yet.';
        return;
    }
    statusEl.textContent = `${roster.controllers.length} session(s) — pick which one drives the browser:`;
    roster.controllers.forEach((c) => {
        const row = document.createElement('label');
        row.className = 'row';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'sess';
        radio.checked = active.has(c.id);
        radio.addEventListener('change', async () => {
            await chrome.runtime.sendMessage({ action: 'setInstance', id: c.id });
            load();
        });
        const span = document.createElement('span');
        span.innerHTML = `${c.label} &nbsp;<code>${c.id}</code>`;
        row.append(radio, span);
        listEl.append(row);
    });
}

document.getElementById('refresh').addEventListener('click', load);
load();
