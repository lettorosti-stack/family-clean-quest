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

function collectAssetMap() {
  const assetsDir = path.join(rootDir, 'assets');
  const map = {};

  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const ext = path.extname(item.name).toLowerCase();
      if (!mimeByExt[ext]) continue;

      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      map[relativePath] = assetToDataUri(relativePath);
    }
  }

  walk(assetsDir);
  return map;
}

function buildAssetRuntime(assetMap) {
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

      function patchImage(img) {
        var current = img.getAttribute('src');
        var next = window.cleanQuestAssetUrl(current);
        if (next && next !== current) img.setAttribute('src', next);
      }

      function patchImages(root) {
        if (!root) return;
        if (root.tagName === 'IMG') patchImage(root);
        if (root.querySelectorAll) {
          root.querySelectorAll('img').forEach(patchImage);
        }
      }

      function start() {
        patchImages(document);
        var observer = new MutationObserver(function(records) {
          records.forEach(function(record) {
            if (record.type === 'attributes') {
              patchImages(record.target);
              return;
            }
            record.addedNodes.forEach(function(node) {
              if (node.nodeType === 1) patchImages(node);
            });
          });
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src']
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
    })();
  </script>`;
}

function injectAssetRuntime(html, assetMap) {
  const runtime = buildAssetRuntime(assetMap);
  if (html.includes('</head>')) {
    return html.replace('</head>', `${runtime}\n</head>`);
  }
  return `${runtime}\n${html}`;
}

const sourceHtml = fs.readFileSync(inputPath, 'utf8');
const assetMap = collectAssetMap();
const htmlWithEmbeddedAssets = injectAssetRuntime(sourceHtml, assetMap);
const moduleSource = `const previewHtml = ${JSON.stringify(htmlWithEmbeddedAssets)};\n\nexport default previewHtml;\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, moduleSource, 'utf8');

const sizeMb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
console.log(`Generated ${path.relative(rootDir, outputPath)} (${sizeMb} MB, ${Object.keys(assetMap).length} embedded assets)`);
