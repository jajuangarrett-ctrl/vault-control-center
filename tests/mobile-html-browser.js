// Execute in Obsidian's renderer with VCCMobileTest from the production-target bundle.
// Everything is an in-memory fixture. No real vault file is created or changed.
async function runMobileHtmlBrowserChecks(api) {
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const fixturePath = "VCC Mobile Fixture/index.html";
  const entries = {
    [fixturePath]: `<!doctype html><html><head><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js" defer></script></head><body>
      <button id="counter">Count</button><div id="value">0</div><img src="assets/icon.svg">
      <a id="next" href="next.htm">Next</a></body></html>`,
    "VCC Mobile Fixture/assets/app.css": '@import "colors.css"; #counter { background-image: url(icon.svg); }',
    "VCC Mobile Fixture/assets/colors.css": '#value { color: rgb(12, 34, 56); }',
    "VCC Mobile Fixture/assets/icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
    "VCC Mobile Fixture/data.json": '{"total":42}',
    "VCC Mobile Fixture/next.htm": '<h1>Next page</h1>',
    "VCC Mobile Fixture/assets/app.js": `
      document.getElementById('counter').onclick = () => {
        document.getElementById('value').textContent = '1'; localStorage.setItem('counter', '1');
      };
      window.addEventListener('DOMContentLoaded', async () => {
        document.getElementById('counter').click();
        const data = await (await fetch('data.json')).json();
        let isolated = false; try { parent.document.title; } catch { isolated = true; }
        const icon = document.querySelector('img'); await icon.decode();
        parent.postMessage({fixture: 'vcc-mobile', count: document.getElementById('value').textContent,
          color: getComputedStyle(document.getElementById('value')).color,
          image: icon.naturalWidth, stored: localStorage.getItem('counter'), total: data.total, isolated}, '*');
        document.getElementById('next').click();
      });`,
  };
  const files = Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, {
    path, name: path.split('/').pop(), basename: path.split('/').pop().replace(/\.[^.]+$/, ''),
    stat: {size: new TextEncoder().encode(text).length},
  }]));
  const source = {
    size: path => files[path]?.stat.size ?? null,
    text: async path => entries[path],
    binary: async path => new TextEncoder().encode(entries[path]).buffer,
  };
  const prepared = await api.prepareMobileHtml(entries[fixturePath], fixturePath, source);
  assert(prepared.warnings.length === 0, 'Bundled fixture has warnings: ' + prepared.warnings.join(';'));
  assert(prepared.document.querySelector('script[src]').src.startsWith('data:text/javascript'), 'Script was not embedded');
  assert(prepared.document.querySelector('link').href.startsWith('data:text/css'), 'CSS was not embedded');
  assert(prepared.document.querySelector('img').src.startsWith('data:image/svg+xml'), 'Image was not embedded');
  results.push('Local CSS, nested CSS imports, script and image bundled without warnings');
  const missing = await api.prepareMobileHtml('<script src="missing.js"></script><img src="missing.png">', fixturePath, source);
  assert(missing.warnings.length === 2, 'Missing dependencies were not reported');
  assert(!missing.document.querySelector('script'), 'Missing script retained');
  const remote = await api.prepareMobileHtml('<link rel="stylesheet" href="https://example.com/font.css">', fixturePath, source);
  assert(remote.warnings.some(value => value.includes('internet')), 'Online dependency was not reported');
  results.push('Missing assets and online dependencies reported');
  let limit = false;
  try { await api.prepareMobileHtml('x'.repeat(api.MOBILE_HTML_FILE_LIMIT + 1), fixturePath, source); } catch { limit = true; }
  assert(limit, 'Oversize HTML was not rejected');
  results.push('Oversize HTML rejected');
  const host = document.body.createDiv(); host.style.cssText = 'position:fixed;left:-10000px;width:390px;height:700px';
  const cleanup = [];
  const storageKey = 'fjg-vcc-mobile-html:' + fixturePath;
  const oldStorage = localStorage.getItem(storageKey);
  const appFixture = { vault: {
    getAbstractFileByPath: path => files[path] || null,
    read: async file => entries[file.path], readBinary: async file => source.binary(file.path),
  }};
  let listener, timer, navigated = '';
  try {
    const resultPromise = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Interactive fixture timed out')), 8000);
      listener = event => { if (event.data?.fixture === 'vcc-mobile' && event.source === host.querySelector('iframe')?.contentWindow) resolve(event.data); };
      window.addEventListener('message', listener);
    });
    await api.renderMobileHtml(appFixture, files[fixturePath], host, {register: callback => cleanup.push(callback)}, () => true, path => { navigated = path; });
    const outcome = await resultPromise;
    await new Promise(resolve => setTimeout(resolve, 80));
    assert(outcome.count === '1' && outcome.stored === '1' && outcome.total === 42, 'Interactive controls/storage/local fetch failed: ' + JSON.stringify(outcome));
    assert(outcome.color === 'rgb(12, 34, 56)' && outcome.image === 10, 'Styles/image did not render');
    assert(outcome.isolated, 'Frame could access Obsidian parent document');
    assert(navigated === 'VCC Mobile Fixture/next.htm', 'Relative HTM navigation failed');
    assert(JSON.parse(localStorage.getItem(storageKey)).counter === '1', 'Device-local persistence failed');
    results.push('Actual sandboxed iframe: click, CSS, image, local fetch, saved value, isolation and HTM navigation passed');
    // Spoofed messages from outside the frame must not affect stored data.
    window.postMessage({channel: 'wrong-channel', type: 'storage', values: {counter: 'spoofed'}}, '*');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert(JSON.parse(localStorage.getItem(storageKey)).counter === '1', 'Spoofed message modified saved values');
    cleanup.forEach(fn => fn());
    assert(!host.querySelector('iframe').hasAttribute('srcdoc'), 'Closing did not dispose the frame');
    results.push('Spoofed messages ignored and frame disposed');
  } finally {
    clearTimeout(timer); window.removeEventListener('message', listener);
    cleanup.forEach(fn => fn()); host.remove();
    if (oldStorage === null) localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, oldStorage);
  }
  return results;
}
