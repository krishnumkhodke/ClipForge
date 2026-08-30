# ClipForge

ClipForge is a TrueForge-powered video clipping agent. A user uploads one focused video per chat session, asks for an edit in natural language, approves the tool plan, and receives a rendered Remotion clip in the conversation.

## Services

- `apps/web`: Next.js UI embedding TrueForge UI.
- `apps/api`: media upload, metadata, transcription, MCP tools, and Remotion rendering.
- `infra/trueforge`: the self-hosted TrueForge agent server.

The repository uses Turborepo and pnpm for the ClipForge apps. TrueForge remains a self-contained upstream workspace under `infra/trueforge`.

## Development

Install and run the ClipForge apps from the repository root:

```bash
pnpm install
pnpm dev
```

Run TrueForge separately using its local Compose setup:

```bash
cd infra/trueforge
docker compose up --build
```

Local defaults are web on `http://localhost:3000`, media on `http://localhost:4000`, and TrueForge on `http://localhost:8791`.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production images, environment variables, persistent storage, service networking, the TrueForge bootstrap, and Railway setup.
