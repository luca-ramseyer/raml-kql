// Test fixture for e2e/example-extensions.spec.ts. Plain ESM, no imports (spec 07: bundled code).
// Answers from the value itself, so the tests need no network.
const api = () => globalThis.ramlKql;

export function activate(context) {
  context.subscriptions.push(
    api().enrichment.registerProvider('addressFacts', {
      enrich(entities) {
        return entities.map((entity) => ({
          entity,
          fields: {
            family: entity.value.includes(':') ? 'IPv6' : 'IPv4',
            last: entity.value.split(/[.:]/).at(-1) ?? null,
          },
        }));
      },
    }),
  );
}
