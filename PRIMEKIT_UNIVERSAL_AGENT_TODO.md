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

- Backend `083b75b`: 34 chat-run/desktop-agent unit tests — pass.
- Backend `083b75b`: один cloud chat выполняет Mac → Windows → Mac system E2E; третий turn возвращается
  первому runtime, получает канонический контекст Windows и не попадает в очередь второго устройства.
- Backend `083b75b`: внутренний desktop command prompt скрыт от участников общего чата; owner regression — pass.
- Desktop `a556be2`: DMG install → Computer Use → cloud turn → local write → restart → cloud sync — pass.
- Последний установленный Mac E2E: file → restart → file → Terminal — pass; wake 24 ms,
  после restart 1160 ms, одна local session и три синхронизированных cloud result.
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
- Ротация command-bound model token теперь сбрасывает только Provider-кеш выбранного workspace;
  третий ход больше не использует отозванный Bearer предыдущей команды. Unit regression и packaged Mac E2E — pass.
- Desktop `97ac9541` + backend `cb48e67`: Windows QA run `30738294738`, attempt 2 — clean NSIS install →
  Computer Use → browser/cloud → local file → restart → Terminal → cloud sync → silent uninstall — pass;
  6 provider calls, wake 52 ms, после restart 2869 ms.
- Последний Windows artifact `primekit-windows-x64-unsigned-qa` (`8830698626`, 333 455 155 bytes)
  загружен на 14 дней.
- Browser coordinator + два изолированных экземпляра packaged Mac app на общей PostgreSQL-среде:
  один cloud chat прошёл runtime A → runtime B → runtime A; три локальных marker-файла и ровно
  три канонических ответа — pass. Это проверяет UI-переключение хоста, но не заменяет физический Windows gate.
- Физический browser → packaged Mac → установленный Windows x64 → packaged Mac прогон:
  browser coordinator вернул `passed`, `chat_id=1`, runtime sequence `[1, 2, 1]`; команды в PostgreSQL
  завершились на Mac, Windows и снова Mac, а Windows `tool_result` подтвердил локальную запись файла.
- Windows shared-backend QA run `30743954115` — success: сборка x64, clean NSIS install, packaged
  Computer Use, cross-device worker, silent uninstall и artifact upload прошли на `windows-2025`.

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
- [x] Выполнить реальную Terminal-команду из установленного Windows-клиента (Windows PTY x64 проверен как PE runtime).
  - [x] Найти и закрыть гонку persistent session, из-за которой третий ход не доходил до provider.
  - [x] Повторить clean NSIS install → file → restart → Terminal на сборке с исправлением.
- [x] Провести реальный cross-device сценарий одним аккаунтом: browser → Mac → Windows → Mac.
  - [x] Протокольный PostgreSQL system E2E Mac → Windows → Mac в одном cloud chat.
  - [x] Packaged device-worker для назначенных Mac/Windows turns и browser UI coordinator.
  - [x] Packaged Mac worker → локальный write → canonical cloud result на общей PostgreSQL-среде.
  - [x] Browser UI → два изолированных packaged workers → A → B → A в одном cloud chat.
  - [x] Одновременно запустить установленные Mac и Windows workers против одного доступного backend и пройти UI coordinator.
- [x] Исправить platform-specific ошибки первых Windows runs и повторить до зелёного результата.

## P0 — до публичного релиза

- [ ] Запустить `.github/workflows/primekit-release.yml` с immutable backend SHA.
- [x] Release validate job применяет migration `008` к PostgreSQL 16 и доказывает три duplicate-prevention invariant.
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

- [x] GitHub write authentication для `TimXa/opencode` и `TimXa/Omar1` (проверено push; временный PAT не хранится в проекте).
- [x] `primekit-brand` назначена default branch; signed release workflow зарегистрирован GitHub Actions как active.
- [x] `PRIMEKIT_CI_REPO_TOKEN` для checkout приватного backend в Actions настроен в `TimXa/opencode`.
- [ ] Заменить временный токен, опубликованный в чате, на новый dedicated read-only token для `TimXa/Omar1`,
      затем отозвать временный токен.
- [ ] Apple: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_PRIVATE_KEY`,
      `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- [ ] Azure: OIDC credentials, Trusted Signing endpoint/account/profile и publisher DN.

## Definition of done

Universal Agent Thread готов только когда один и тот же облачный чат на production backend успешно
выполняет реальные локальные задачи на подписанных установленных Mac и Windows, переключается между
ними без потери контекста, восстанавливается после restart/network loss, не дублирует turns/results,
а release и update gates проходят на обеих ОС. До этого приложение считается beta, а не готовым для
массовой раздачи.
