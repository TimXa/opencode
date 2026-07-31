# Кит Desktop

Официальный форк [OpenCode](https://github.com/anomalyco/opencode) для PrimeKit.
Upstream-код распространяется по MIT; исходная лицензия сохранена в `LICENSE`.

## Рабочий контракт

- Desktop запускает локальный OpenCode server, поэтому агент и инструменты работают на Mac.
- Локальный агент использует официальный OpenAI/Codex OAuth из macOS Keychain/`~/.codex/auth.json`.
- Аккаунт PrimeKit используется для единой истории чатов и outbound-команд на доверенный Mac.
- Коннектор разрешает действия только внутри локально подтверждённого корня проекта.
- `OPENCODE_CONFIG_CONTENT` сохраняет приоритет и может полностью переопределить встроенный provider config.

## TODO

- [x] Форк OpenCode v1.18.10 и отдельная ветка `primekit-brand`.
- [x] Палитра, название, deep link и иконки Кита.
- [x] Провайдер OpenAI Codex с отображаемым брендом «Кит».
- [x] Сборка и typecheck macOS desktop.
- [x] Подключение существующей авторизации PrimeKit из macOS Keychain.
- [ ] Облачная БД как единый источник чатов для web/macOS/iOS.
- [x] Outbound Mac connector: presence, scoped filesystem/shell access и возврат ответа в чат.
- [ ] iPhone-клиент для облачных чатов и отправки задач активному Mac.
- [ ] Подпись, notarization, updater и release pipeline PrimeKit.

Важно: облачный чат доступен без Mac. Действия с локальными файлами и приложениями
Mac выполняются только когда доверенный connector этого Mac онлайн.
