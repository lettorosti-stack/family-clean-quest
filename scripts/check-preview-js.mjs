import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const html = readFileSync(new URL('../preview.html', import.meta.url), 'utf8');
const scripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi));

if (!scripts.length) throw new Error('preview.html does not contain an inline script');

scripts.forEach((match, index) => {
  try {
    // Parse without executing browser-only code.
    new Function(match[1]);
  } catch (error) {
    throw new Error(`Inline script ${index + 1} is invalid: ${error.message}`);
  }
});

const quoteAssets = Array.from(html.matchAll(/icon: '(assets\/daily-quotes\/[^']+\.jpg)'/g), match => match[1]);
if (quoteAssets.length !== 70) throw new Error(`Expected 70 daily quote icons, found ${quoteAssets.length}`);
if (new Set(quoteAssets).size !== quoteAssets.length) throw new Error('Daily quote icons must be unique');
const root = path.dirname(fileURLToPath(new URL('../preview.html', import.meta.url)));
quoteAssets.forEach((asset) => {
  if (!existsSync(path.join(root, asset))) throw new Error(`Daily quote icon is missing: ${asset}`);
});
if (!html.includes('id="dailyQuoteButton"') || !html.includes('id="quoteModal"')) {
  throw new Error('Daily quote controls are missing');
}
if (!html.includes('id="historyTaskPicker"') || !html.includes('data-history-task-option')) {
  throw new Error('Stable manual history picker is missing');
}
if (html.includes('<select class="select-input" id="historyTask"')) {
  throw new Error('Native history task select must not be used in Android WebView');
}

console.log(`Checked ${scripts.length} inline preview script(s) and ${quoteAssets.length} daily quotes.`);
