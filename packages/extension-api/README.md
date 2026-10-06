# @raml-kql/extension-api

Types and a tiny runtime shim for writing [Raml KQL](https://github.com/luca-ramseyer/raml-kql)
extensions: commands, result enrichers and renderers, sidebar views, themes and settings.

```bash
npm install --save-dev @raml-kql/extension-api
```

```ts
import { ramlKql, type ExtensionContext } from '@raml-kql/extension-api';

export function activate(context: ExtensionContext) {
  context.subscriptions.push(
    ramlKql.commands.registerCommand('hello.world', () =>
      ramlKql.window.showInformationMessage('Hello!'),
    ),
  );
}
```

Extensions run in a sandboxed worker with no Node.js and no network. Bundle this package into
your extension (for example with esbuild); at runtime it only reads the `ramlKql` object the host
provides. Everything an extension can do goes through that host API, and every permission is
asked for and can be revoked.

- Easiest start: `npx @raml-kql/extension-cli init my-extension --publisher me` scaffolds a
  working project (see [`@raml-kql/extension-cli`](https://www.npmjs.com/package/@raml-kql/extension-cli)).
- Guide: [Writing extensions](https://github.com/luca-ramseyer/raml-kql/blob/main/docs/guides/writing-extensions.md)
- Examples: [`examples/extensions`](https://github.com/luca-ramseyer/raml-kql/tree/main/examples/extensions)

`EXTENSION_API_VERSION` is the version of the host API. Declare a compatible range in your
manifest's `engines`.

MIT licence.
