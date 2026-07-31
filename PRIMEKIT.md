# Кит Desktop

Официальный форк [OpenCode](https://github.com/anomalyco/opencode) для PrimeKit.
Upstream-код распространяется по MIT; исходная лицензия сохранена в `LICENSE`.

## Рабочий контракт

- Desktop запускает локальный OpenCode server, поэтому агент и инструменты работают на Mac.
- Встроенный провайдер `kit` обращается к `https://primekit-job.ru/v1`.
- Пользователь вводит персональный `kit_…` API key через штатное подключение провайдера.
- `PRIMEKIT_API_URL` меняет API endpoint для локальной разработки.
- `OPENCODE_CONFIG_CONTENT` сохраняет приоритет и может полностью переопределить встроенный provider config.

## TODO

- [x] Форк OpenCode v1.18.10 и отдельная ветка `primekit-brand`.
- [x] Палитра, название, deep link и иконки Кита.
- [x] Встроенный OpenAI-compatible provider `kit/kit`.
- [x] Сборка и typecheck macOS desktop.
- [ ] Экран входа PrimeKit и выпуск персонального API key из приложения.
- [ ] Облачная БД как единый источник чатов для web/macOS/iOS.
- [ ] Outbound Mac connector: presence, approvals, scoped filesystem/shell access.
- [ ] iPhone-клиент для облачных чатов и отправки задач активному Mac.
- [ ] Подпись, notarization, updater и release pipeline PrimeKit.

Важно: облачный чат доступен без Mac. Действия с локальными файлами и приложениями
Mac выполняются только когда доверенный connector этого Mac онлайн.
