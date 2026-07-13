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

function embedAssets(html) {
  return html.replace(
    /(["'`])(assets\/[^"'`)<>\s]+?\.(?:gif|jpe?g|png|svg|webp))\1/g,
    (_match, quote, assetPath) => `${quote}${assetToDataUri(assetPath)}${quote}`,
  );
}

const sourceHtml = fs.readFileSync(inputPath, 'utf8');
const htmlWithEmbeddedAssets = embedAssets(sourceHtml);
const moduleSource = `const previewHtml = ${JSON.stringify(htmlWithEmbeddedAssets)};\n\nexport default previewHtml;\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, moduleSource, 'utf8');

const sizeMb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
console.log(`Generated ${path.relative(rootDir, outputPath)} (${sizeMb} MB)`);
