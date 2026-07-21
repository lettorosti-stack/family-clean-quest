Загрузить в GitHub с заменой существующих файлов:

1. App.js
2. app.json
3. preview.html
4. package.json
5. package-lock.json
6. scripts/generate-preview-html.js
7. assets/app-icon.png
8. .github/workflows/android-apk.yml

Если GitHub web не принимает скрытую папку .github:
- откройте в репозитории .github/workflows/android-apk.yml;
- нажмите Edit;
- вставьте содержимое файла android-apk.yml из этой папки;
- Commit changes.

Важно:
- старый family-clean-quest-source.zip больше не нужен;
- после сборки устанавливать release APK;
- перед установкой удалить старое приложение с телефона, чтобы Android не держал старую иконку/название в кэше.
