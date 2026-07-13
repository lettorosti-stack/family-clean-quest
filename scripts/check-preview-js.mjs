import { readFileSync } from 'node:fs';

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

console.log(`Checked ${scripts.length} inline preview script(s).`);
