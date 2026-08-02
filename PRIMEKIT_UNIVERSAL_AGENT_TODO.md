# PrimeKit Universal Agent Thread — release checklist

Обновлено: 2026-08-02. Этот файл — источник правды для статуса Universal Agent Thread.
Пункт считается готовым только после указанной проверки; наличие кода само по себе не считается доказательством.

## Целевой контракт

Один облачный чат принадлежит аккаунту и открывается в браузере, на Mac и Windows. Перед локальным
запуском пользователь явно выбирает устройство и разрешённую папку. Сервер хранит каноническую
историю и маршрутизацию, а выбранное устройство исполняет агента нативно: файлы, Terminal и UI.
Повтор запроса, reconnect или падение процесса не должны создавать второй turn или второй ответ.

## Доказано

- [x] Каноническая история чата хранится в облаке и доступна всем клиентам аккаунта.
  - Проверка: backend system E2E создаёт один чат и продолжает его на двух runtime.
- [x] Чат направляется только на явно выбранные `runtime_id` и `folder_grant_id`.
  - Проверка: второй turn после смены target доставляется Windows runtime, а не первому Mac runtime.
- [x] Офлайн-устройство не вызывает скрытый fallback в облако.
  - Проверка: `test_universal_turn_never_falls_back_to_cloud_when_saved_device_is_offline`.
- [x] Device credential ограничен runtime, имеет срок жизни и безопасно ротируется.
- [x] Model gateway token ограничен командой/claim/runtime и отзывается после terminal result.
- [x] Повтор `client_message_id` возвращает тот же task/command без второго сообщения.
- [x] Повтор terminal result идемпотентен и не создаёт второй ответ.
- [x] Lease восстанавливает команду после падения device executor.
- [x] Отзыв runtime или folder grant отменяет работу и инвалидирует claim.
- [x] Контекст первого устройства передаётся второму через канонический chat snapshot.
- [x] Mac выполняет локальные file/Terminal/Computer Use tools из установленной DMG-копии.
- [x] Mac сохраняет local agent session после перезапуска приложения.
- [x] SSE будит нужный runtime; 30-секундный poll остаётся аварийным fallback.
- [x] 10 000 одновременных sidebar SSE connections доставляют событие в нагрузочном тесте.

### Последние проверки

- Backend `8f5b88c`: 33 unit tests — pass.
- Backend `8f5b88c`: двухустройственный system E2E — pass (`runtime_id=1`, `second_runtime_id=2`).
- Desktop `a556be2`: DMG install → Computer Use → cloud turn → local write → restart → cloud sync — pass.
- Последний Mac DMG E2E: wake 26 ms, после restart 1209 ms, session сохранена.
- Desktop config: 9 tests, typecheck и actionlint 1.7.12 — pass.
- Desktop `6e09173`: Windows QA run `30732881834` на настоящем `windows-2025` — pass.
- Windows QA: x64 NSIS собран; PE/native runtime, packaged Computer Use и browser → cloud → local agent → cloud E2E — pass.
- Windows QA artifact `primekit-windows-x64-unsigned-qa` (`8828656646`, 333 453 158 bytes) загружен на 14 дней.
- Desktop `7c8b1c4`: Windows QA run `30733437581` — clean NSIS install → installed Computer Use →
  browser/cloud → installed local agent → restart → cloud sync → silent uninstall — pass.
- Последний Windows artifact `primekit-windows-x64-unsigned-qa` (`8828838118`, 333 452 979 bytes) загружен на 14 дней.
- Persistent-session regression: прежний цикл терял prompt, сохранённый во время активного Runner
  (`ожидалось 2 provider calls, получено 1`); после pin-and-drain исправления — 56 pass, 1 skip.
- HTTP regression с PrimeKit ID `msg_pk_cmd_9 → 10 → 11`: три последовательных tool round-trip,
  6 provider calls, 3 user + 6 assistant messages — pass.
- Последний установленный Windows Terminal gate ещё не подтверждён: runs `30734033150`–`30736253537`
  зависали на третьем ходе из-за найденной потери queued prompt; требуется повтор после новой сборки.

## P0 — до тестовой раздачи

- [x] Push desktop `primekit-brand` и backend `main` в GitHub.
- [x] Запустить `.github/workflows/primekit-windows-qa.yml` на настоящем `windows-2025`.
- [x] Подтвердить на packaged Windows x64 QA-клиенте:
  - [x] регистрацию runtime;
  - [x] scoped folder grant;
  - [x] локальный file tool;
  - [x] Computer Use screenshot/input;
  - [x] SSE wakeup;
  - [x] сохранение session после restart;
  - [x] ровно один cloud result на каждый turn.
- [x] Подтвердить чистую установку, запуск и штатное удаление Windows NSIS-клиента.
  - [x] регистрацию runtime;
  - [x] scoped folder grant;
  - [x] локальный file tool;
  - [x] Computer Use screenshot/input;
  - [x] SSE wakeup;
  - [x] сохранение session после restart;
  - [x] ровно один cloud result на каждый turn.
- [ ] Выполнить реальную Terminal-команду из установленного Windows-клиента (Windows PTY x64 уже проверен как PE runtime).
  - [x] Найти и закрыть гонку persistent session, из-за которой третий ход не доходил до provider.
  - [ ] Повторить clean NSIS install → file → restart → Terminal на сборке с исправлением.
- [ ] Провести ручной cross-device сценарий одним аккаунтом: browser → Mac → Windows → Mac.
- [x] Исправить platform-specific ошибки первых Windows runs и повторить до зелёного результата.

## P0 — до публичного релиза

- [ ] Запустить `.github/workflows/primekit-release.yml` с immutable backend SHA.
- [ ] macOS ARM64 и x64: Developer ID Application, hardened runtime, notarization, stapling.
- [ ] Windows x64: Azure Trusted Signing и точный `PRIMEKIT_WINDOWS_PUBLISHER_NAME`.
- [ ] Проверить чистую установку production DMG и NSIS, не только unpacked directory.
- [ ] Убедиться, что release остаётся draft при падении любой platform gate.
- [ ] Проверить ручной logout/login, revoke device и revoke folder grant на production build.

## P1 — безопасные обновления

- [ ] Выпустить подписанную версию N в PrimeKit-owned public feed.
- [ ] Собрать подписанную N+1 теми же publisher/team identities.
- [ ] Пройти реальное N → N+1 обновление на Mac ARM64, Mac x64 и Windows x64.
- [ ] После обновления повторить Universal Agent E2E и проверить сохранение разрешений ОС.
- [ ] Только после этого включить `UPDATER_ENABLED` для signed `prod`.
- [x] Проверка Windows update signature включена; downgrade запрещён.
- [x] Upstream OpenCode feed не выводится из package metadata.

## P1 — эксплуатация

- [ ] Закрытая бета минимум на двух физических Mac и двух Windows PC.
- [ ] Проверить sleep/wake, смену сети, VPN, offline queue и повторный reconnect.
- [ ] Добавить release dashboard: online runtimes, delivery latency, lease recovery, duplicate prevention.
- [ ] Настроить staged rollout и аварийное отключение новой версии без установки upstream binaries.
- [ ] Проверить удаление аккаунта, device credentials, grants и audit metadata.

## Внешние prerequisites

- [ ] GitHub write authentication для `TimXa/opencode` и `TimXa/Omar1`.
- [ ] `PRIMEKIT_CI_REPO_TOKEN` для checkout приватного backend в Actions.
- [ ] Apple: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_PATH`,
      `APPLE_API_KEY`, `APPLE_API_ISSUER`.
- [ ] Azure: OIDC credentials, Trusted Signing endpoint/account/profile и publisher DN.

## Definition of done

Universal Agent Thread готов только когда один и тот же облачный чат на production backend успешно
выполняет реальные локальные задачи на подписанных установленных Mac и Windows, переключается между
ними без потери контекста, восстанавливается после restart/network loss, не дублирует turns/results,
а release и update gates проходят на обеих ОС. До этого приложение считается beta, а не готовым для
массовой раздачи.
