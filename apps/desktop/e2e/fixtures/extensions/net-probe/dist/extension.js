// Test fixture for e2e/extensions.spec.ts. Plain ESM, no imports (spec 07: bundled code).
const api = () => globalThis.ramlKql;

async function direct(url) {
  const attempts = [
    () => fetch(`${url}/direct`),
    () => Object.getPrototypeOf(globalThis).fetch.call(globalThis, `${url}/direct`),
    () => WorkerGlobalScope.prototype.fetch.call(globalThis, `${url}/direct`),
  ];
  for (const attempt of attempts) {
    try {
      await attempt();
      return 'reached';
    } catch {
      // blocked, try the next way around
    }
  }
  return 'blocked';
}

export function activate(context) {
  context.subscriptions.push(
    api().commands.registerCommand('netProbe.fetch', async () => {
      const url = await api().configuration.get('net-probe.url');
      const directResult = await direct(url);
      let apiResult;
      try {
        const response = await api().net.fetch(`${url}/probe`);
        apiResult = `${response.status} ${await response.text()}`;
      } catch (error) {
        apiResult = error.message.startsWith('Permission denied')
          ? 'denied'
          : `error ${error.message}`;
      }
      await api().window.showInformationMessage(
        `Net Probe: direct ${directResult}, api ${apiResult}`,
      );
    }),
  );
}
