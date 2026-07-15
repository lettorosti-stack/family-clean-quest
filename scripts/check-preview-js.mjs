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
if (!html.includes('id="topSyncStatus"') || !html.includes("familySync.status === 'syncing'")) {
  throw new Error('Visible synchronization progress indicator is missing');
}
if (!html.includes('id="historyTaskPicker"') || !html.includes('data-history-task-option')) {
  throw new Error('Stable manual history picker is missing');
}
if (!html.includes('id="historyAreaPicker"') || !html.includes('data-history-area-option')) {
  throw new Error('Manual history room picker is missing');
}
if (!html.includes('.filter(task => task.area === historyAreaSelection)')) {
  throw new Error('Manual history tasks are not filtered by the selected room');
}
if (!html.includes("repeatableDailyTaskLimits = new Map([['kitchen-dishes', 4]])")) {
  throw new Error('Four-times-daily dish washing completion policy is missing');
}
if (!html.includes("perMemberDailyTaskIds = new Set(['garden-water', 'garden-weed'])")
  || !html.includes("task?.area === 'помощь бабушке и дедушке'")) {
  throw new Error('Per-member shared task completion policy is missing');
}
if (!html.includes('id="historyTaskOptions"') || !html.includes('historyTaskOptions.scrollTop = historyTaskScrollTop')) {
  throw new Error('Manual history picker does not preserve its scroll position');
}
if (!html.includes('window.shouldDeferFamilySyncApply')) {
  throw new Error('Manual history picker does not defer background sync rendering');
}
if (!html.includes('window.setFamilyStateFromNative')) {
  throw new Error('Remote family state is not applied to the live preview state');
}
if (!html.includes('window.handleNativeBack') || !html.includes("state.tab = 'home'")) {
  throw new Error('Android back navigation does not return to the previous app screen');
}
if (!html.includes('id="createFamilyBackup"') || !html.includes('id="restoreFamilyBackup"')) {
  throw new Error('Family backup controls are missing');
}
if (!html.includes("id: 'lawn-mow', title: 'Газон: покосить траву', area: 'огород', points: 2")
  || !html.includes("id: 'front-lawn-mow', title: 'Перед участком: покосить траву', area: 'огород', points: 2")
  || !html.includes("id: 'kitchen-cook-baking', title: 'Кухня: приготовление еды - выпечка', area: '1 этаж - кухня', points: 3")) {
  throw new Error('Updated mowing and baking points are missing');
}
if (html.includes('<select class="select-input" id="historyTask"')) {
  throw new Error('Native history task select must not be used in Android WebView');
}

console.log(`Checked ${scripts.length} inline preview script(s) and ${quoteAssets.length} daily quotes.`);
