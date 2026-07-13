const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const inputPath = path.join(rootDir, 'preview.html');
const outputPath = path.join(rootDir, 'src', 'previewHtml.js');

const mimeByExt = {
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function assetToDataUri(assetPath) {
  const normalized = assetPath.replace(/\\/g, '/');
  const fullPath = path.join(rootDir, ...normalized.split('/'));

  if (!fs.existsSync(fullPath)) {
    console.warn(`Asset not found, keeping original path: ${assetPath}`);
    return assetPath;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mime = mimeByExt[ext] || 'application/octet-stream';
  const data = fs.readFileSync(fullPath).toString('base64');
  return `data:${mime};base64,${data}`;
}

function embedLiteralAssets(html) {
  return html.replace(/(["'`])(assets\/[^"'`]+\.(?:png|jpe?g|gif|svg|webp))\1/gi, (match, quote, assetPath) => {
    const dataUri = assetToDataUri(assetPath);
    return `${quote}${dataUri}${quote}`;
  });
}

function patchDynamicAssetCalls(html) {
  return html
    .replace(
      "if (!icon) return 'assets/icons/tasks-list-transparent.png';\n      return icon.includes('/') ? icon : `assets/task-icons/${icon}.png`;",
      "if (!icon) return window.cleanQuestAssetUrl('assets/icons/tasks-list-transparent.png');\n      return window.cleanQuestAssetUrl(icon.includes('/') ? icon : `assets/task-icons/${icon}.png`);"
    )
    .replace(
      "return `assets/reward-icons/${icon}.png`;",
      "return window.cleanQuestAssetUrl(`assets/reward-icons/${icon}.png`);"
    );
}

function collectDynamicAssetMap() {
  const folders = [
    path.join(rootDir, 'assets', 'task-icons'),
    path.join(rootDir, 'assets', 'reward-icons'),
  ];
  const map = {};

  for (const folder of folders) {
    if (!fs.existsSync(folder)) continue;
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      const ext = path.extname(item.name).toLowerCase();
      if (!mimeByExt[ext]) continue;

      const fullPath = path.join(folder, item.name);
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      map[relativePath] = assetToDataUri(relativePath);
    }
  }

  return map;
}

function buildDynamicAssetRuntime(assetMap) {
  return `
  <script>
    (function() {
      var assetData = ${JSON.stringify(assetMap)};

      function normalizeAssetPath(value) {
        if (!value || typeof value !== 'string') return value;
        if (assetData[value]) return value;
        if (value.indexOf('data:') === 0) return value;

        try {
          var url = new URL(value, 'https://localhost');
          var path = url.pathname.replace(/^\\/+/, '');
          return assetData[path] ? path : value;
        } catch (_error) {
          return value;
        }
      }

      window.cleanQuestAssetUrl = function(value) {
        var key = normalizeAssetPath(value);
        return assetData[key] || value;
      };

    })();
  </script>`;
}

function injectDynamicAssetRuntime(html, assetMap) {
  const runtime = buildDynamicAssetRuntime(assetMap);
  if (html.includes('</head>')) {
    return html.replace('</head>', `${runtime}\n</head>`);
  }
  return `${runtime}\n${html}`;
}

const sourceHtml = fs.readFileSync(inputPath, 'utf8');
const dynamicAssetMap = collectDynamicAssetMap();
const patchedHtml = patchDynamicAssetCalls(sourceHtml);
const htmlWithLiteralAssets = embedLiteralAssets(patchedHtml);
const htmlWithEmbeddedAssets = injectDynamicAssetRuntime(htmlWithLiteralAssets, dynamicAssetMap);
const moduleSource = `const previewHtml = ${JSON.stringify(htmlWithEmbeddedAssets)};\n\nexport default previewHtml;\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, moduleSource, 'utf8');

const sizeMb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
console.log(`Generated ${path.relative(rootDir, outputPath)} (${sizeMb} MB, ${Object.keys(dynamicAssetMap).length} dynamic assets)`);
