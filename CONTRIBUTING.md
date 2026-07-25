# Contributing

Thank you for helping improve Sreda Community Map.

## Before opening a change

- Search existing issues.
- Use synthetic identities and locations in examples and tests.
- Never commit Telegram tokens, webhook secrets, production `initData`, real
  member IDs, or raw community exports.
- Discuss changes that alter visibility, retention, authentication, or the data
  model in an issue first.

## Development

```bash
npm install
npm run db:generate
npm run lint
npx tsc --noEmit
npm test
```

If the schema changes, include the generated Drizzle migration and inspect the
SQL before committing it.

## Pull requests

Keep pull requests focused. Explain:

- the user-facing behaviour;
- privacy or security implications;
- schema or migration changes;
- how the change was tested.

New API routes must authenticate on the server. Do not implement a development
authentication bypass that can enter the production bundle.

## Style

- Prefer structured controls over free-form input.
- Keep city-level precision throughout the product.
- Treat authorization as a server-side responsibility.
- Preserve keyboard and touch accessibility.
- Avoid adding an LLM where deterministic UI is sufficient.
