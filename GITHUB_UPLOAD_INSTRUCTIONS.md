# Что загружать в GitHub

Загружать `family-clean-quest-source.zip` больше не нужно. Он слишком большой, потому что содержит уже сгенерированный `src/previewHtml.js`.

GitHub Actions теперь сам создаёт `src/previewHtml.js` из `preview.html` и папки `assets` перед сборкой APK.

## Загружать

- `.github/workflows/android-apk.yml`
- `App.js`
- `app.json`
- `babel.config.js`
- `package.json`
- `package-lock.json`
- `preview.html`
- `README.md`
- `GITHUB_UPLOAD_INSTRUCTIONS.md`
- папку `assets`
- папку `scripts`
- папку `src`, но без `src/previewHtml.js`

## Не загружать

- `family-clean-quest-source.zip`
- `src/previewHtml.js`
- `node_modules`
- `android`
- `ios`
- `dist`
- `.expo`
- `apk-inspect`
- любые `*.apk`

## Почему так

Картинки в `assets` нужны приложению. Они загружаются в GitHub отдельными файлами, а не одним большим архивом.

Большой файл `src/previewHtml.js` не нужен в репозитории: он генерируется командой:

```bash
npm run generate:preview
```

В workflow эта команда уже добавлена перед `npx expo-doctor`.
