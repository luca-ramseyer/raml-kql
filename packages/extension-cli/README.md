# @raml-kql/extension-cli

`raml-kql-ext`: scaffold, validate and package extensions and query packs for
[Raml KQL](https://github.com/luca-ramseyer/raml-kql). No dependencies; needs Node.js 22 or newer.

```bash
npx @raml-kql/extension-cli init my-extension --publisher me   # scaffold a TypeScript extension
cd my-extension && npm install && npm run build
npx raml-kql-ext validate                                       # the checks the app runs on install
npx raml-kql-ext package                                        # builds the .rkqlx file
npx raml-kql-ext pack validate ./packs                          # validate query packs in a folder
```

Install a `.rkqlx` in the app with **Extensions: Install from File…**.

- Guide: [Writing extensions](https://github.com/luca-ramseyer/raml-kql/blob/main/docs/guides/writing-extensions.md)
- Query packs: [Writing query packs](https://github.com/luca-ramseyer/raml-kql/blob/main/docs/guides/writing-query-packs.md)

MIT licence.
