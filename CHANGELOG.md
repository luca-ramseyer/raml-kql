# Changelog

## 1.0.0 (2026-10-06)


### Features

* **accounts:** Accounts view, add-account flows and re-auth prompts ([d8b417c](https://github.com/luca-ramseyer/raml-kql/commit/d8b417cc8e38c925d7400d241931fff38e002196))
* **accounts:** wire authentication into IPC and inject the built-in client ID ([5c59a02](https://github.com/luca-ramseyer/raml-kql/commit/5c59a02f33faad856b8096d599596beb025eddcb))
* **auth:** multi-account, multi-tenant authentication in the main process ([0fcc4a4](https://github.com/luca-ramseyer/raml-kql/commit/0fcc4a4a72d2d4c65e0221ff25430641253b8198))
* **auth:** multi-account, multi-tenant sign-in (phase 2) ([e160b08](https://github.com/luca-ramseyer/raml-kql/commit/e160b0879e2c141843fb54723afb68f15c931d6a))
* **desktop:** add hardened Electron shell with typed IPC and demo flag ([c354d9b](https://github.com/luca-ramseyer/raml-kql/commit/c354d9b3895b0906cb58360e704662a2969701c4))
* **discovery:** workspace discovery, access paths, groups and config extends ([f3e6550](https://github.com/luca-ramseyer/raml-kql/commit/f3e65501326dc519c1e7d4eceaed66cf350c003a))
* **discovery:** workspace discovery, targets, groups and aliasing (phase 3) ([b9905c8](https://github.com/luca-ramseyer/raml-kql/commit/b9905c845c26ee4960c53174d76add2bf8abd161))
* **editor:** editor groups with split, tab drag and drop, pin, preview and dirty tabs ([856b049](https://github.com/luca-ramseyer/raml-kql/commit/856b04903f2398d7704c8926aea2f0db249c4693))
* **editor:** KQL query tabs with Monaco, schema-aware IntelliSense and time range ([a24b2bf](https://github.com/luca-ramseyer/raml-kql/commit/a24b2bfe8503051b8f9d916afa915e26fae9c790))
* **extensions:** enrichers, renderers, views, themes, git installs and CLI ([e8c935b](https://github.com/luca-ramseyer/raml-kql/commit/e8c935b41c42c39317938f61c816b7c0d8a0bf4f))
* **extensions:** sandboxed extension host with permission broker ([0dae17c](https://github.com/luca-ramseyer/raml-kql/commit/0dae17c14406c96a61ca462d631b37061e7d0d8f))
* **packs:** query packs from git and files, with typed parameters ([0a41cc0](https://github.com/luca-ramseyer/raml-kql/commit/0a41cc0a53375a31a568dc8c817aada4acfb3a87))
* Phase 10 — privacy polish and crash reporting ([ca23887](https://github.com/luca-ramseyer/raml-kql/commit/ca2388771da2bc09da9968a9168cec367861b75d))
* Phase 11 — packaging, signing hooks, auto-update, releases ([#18](https://github.com/luca-ramseyer/raml-kql/issues/18)) ([df7f2b1](https://github.com/luca-ramseyer/raml-kql/commit/df7f2b1bc9eb79a688d6d75ab66b9e0635362336))
* Phase 4 — editor and IntelliSense ([3529bd5](https://github.com/luca-ramseyer/raml-kql/commit/3529bd515cf0bb1b3a6c195df63369d178f68b2b))
* Phase 5 — query engine ([7ad7f97](https://github.com/luca-ramseyer/raml-kql/commit/7ad7f977787294b5690f1fabef3fc680de4354d4))
* Phase 6 — results ([2aadb92](https://github.com/luca-ramseyer/raml-kql/commit/2aadb92b7cbf9d488e5dcc185f38037b7321bc8e))
* Phase 7 — tabs, history, saved queries ([0998828](https://github.com/luca-ramseyer/raml-kql/commit/0998828f8a973cf535a3cb2221be9b5bc09afddd))
* Phase 8 — query packs and git sources ([0b5786e](https://github.com/luca-ramseyer/raml-kql/commit/0b5786e86350714703e4d3d642cac6bc361a82c8))
* Phase 9 — extensions ([09911c3](https://github.com/luca-ramseyer/raml-kql/commit/09911c32767891516314a13fdb8452730e498f6e))
* **privacy:** masking rules, crash reporting and network activity ([e4b4864](https://github.com/luca-ramseyer/raml-kql/commit/e4b486417b7c5cd13596894a4048a698b75f9698))
* **query:** fan-out engine, encrypted result store and audit log ([cb65f4d](https://github.com/luca-ramseyer/raml-kql/commit/cb65f4d4da7e753e6ad6b2b91b5590979c55eaf4))
* **results:** results grid, details sheet, group-by and charts ([9051d28](https://github.com/luca-ramseyer/raml-kql/commit/9051d2851088bb885fd05e9e3930b6fdabac9a5f))
* **results:** run queries from the editor with status and results panels ([487e4aa](https://github.com/luca-ramseyer/raml-kql/commit/487e4aad3d1ea1da6eea5f9fd2503a935423a20a))
* **results:** views, group-by, exports and deep links in the main process ([9a283af](https://github.com/luca-ramseyer/raml-kql/commit/9a283afe5dd6b1adfddc55c7f960fdffaed32f86))
* scaffold Raml KQL (phase 0) ([34503fb](https://github.com/luca-ramseyer/raml-kql/commit/34503fbebfc8516eef1f054c7a2c5feb819c0860))
* **schema:** workspace schema service with metadata API, disk cache and demo schemas ([2443091](https://github.com/luca-ramseyer/raml-kql/commit/24430911ecaa82757e218cad69f8ef1f48953151))
* **tabs:** persistent tabs, per-tab targets, query history and My Queries ([6dfe4e3](https://github.com/luca-ramseyer/raml-kql/commit/6dfe4e3d21e536c0bd3e70dbaab6bdef511b3e2d))
* **targets:** Targets view, Workspaces page and presentation mode ([3990cd0](https://github.com/luca-ramseyer/raml-kql/commit/3990cd0a53f37311653a719511c1e5698f5774c2))
* **theme:** Raml Light and Raml Dark brand themes as the default ([5f5a09d](https://github.com/luca-ramseyer/raml-kql/commit/5f5a09d7ed7ef54faff6b59041b7bbdb0b002446))
* **theme:** Raml Light and Raml Dark brand themes as the default ([9f2748b](https://github.com/luca-ramseyer/raml-kql/commit/9f2748bcee393197dd631cd33e0bb67be31d2e86))
* **workbench:** VS Code-style workbench shell ([cc621aa](https://github.com/luca-ramseyer/raml-kql/commit/cc621aa723785926e6f2893cd965d05690c54999))
* **workbench:** VS Code-style workbench shell (phase 1) ([f1216e8](https://github.com/luca-ramseyer/raml-kql/commit/f1216e8b37a24c523f766116b42dc55040cd71e4))
* **workspaces:** inventory and groups IPC, settings and wiring ([e0c40ed](https://github.com/luca-ramseyer/raml-kql/commit/e0c40ed083f1e1c9a381a8d7e1744963fb4e4799))


### Bug Fixes

* **auth:** sign in to Azure CLI tenants with az login instead of failing ([7fbeeae](https://github.com/luca-ramseyer/raml-kql/commit/7fbeeae6266cc6a3a3226fbec354f2916825697a))
* **crash:** mask e-mail addresses before known names ([8154816](https://github.com/luca-ramseyer/raml-kql/commit/815481670a250a47ec3f0c609fa3a826a797f097))
* **dev:** Kusto worker, Targets selection and AG Grid tooltip under pnpm dev ([9e16edf](https://github.com/luca-ramseyer/raml-kql/commit/9e16edf2722d66f23e6b28cd0037e8b5320a5701))
* **examples:** Country Map streaks across the world and small countries ([#19](https://github.com/luca-ramseyer/raml-kql/issues/19)) ([451ca8d](https://github.com/luca-ramseyer/raml-kql/commit/451ca8d014fcc595f5ca30121ac4d642a70b38fc))
* **history:** share one load of history.jsonl between concurrent callers ([3971bb0](https://github.com/luca-ramseyer/raml-kql/commit/3971bb0520d1be2ac5ff1477a7ce98f5ced7bd00))
* **targets:** keep a restored tab's selection while the inventory loads ([3cba358](https://github.com/luca-ramseyer/raml-kql/commit/3cba3581d62260131a6f48b4512b0dc239edf3c8))


### Performance Improvements

* **editor:** never wait for the schema before the editor takes input ([95ff421](https://github.com/luca-ramseyer/raml-kql/commit/95ff4218f5d1693d3e7567775c08d18852b01557))
* **editor:** open query tabs without the Suspense throttle and preload Monaco when idle ([462eff2](https://github.com/luca-ramseyer/raml-kql/commit/462eff257881b0846ac9f84789d0892642ff31c7))
