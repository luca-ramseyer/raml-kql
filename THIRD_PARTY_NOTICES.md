# Third-party notices

Raml KQL is MIT-licensed. It ships with the third-party components below. Keep this list up
to date whenever a component that ends up in the packaged app is added or removed
(`pnpm check:licenses` checks that no copyleft licence slips in).

| Component                                              | Licence | Used for                                                                                                                   |
| ------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Electron](https://github.com/electron/electron)       | MIT     | Application runtime. Electron bundles Chromium and Node.js; their notices ship inside the app as `LICENSES.chromium.html`. |
| [React](https://github.com/facebook/react) / React DOM | MIT     | Workbench UI                                                                                                               |
| [zod](https://github.com/colinhacks/zod)               | MIT     | Schema validation at every boundary                                                                                        |

## Not affiliated with Microsoft

Raml KQL is an independent open-source project. It is not affiliated with, endorsed by or
sponsored by Microsoft. "Azure", "Microsoft Entra", "Log Analytics", "Microsoft Sentinel",
"Microsoft Defender" and "Visual Studio Code" are trademarks of the Microsoft group of
companies and are used only to describe compatibility.
