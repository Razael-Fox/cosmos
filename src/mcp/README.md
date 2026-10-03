# Cosmos MCP — client configuration

Reference configurations for the four supported AI coding agents.

**All four clients share the SAME single owner API key** (`COSMOS_MCP_TOKEN`). There is no
per-client key to issue, rotate, or revoke — an owner-side rotation updates every client at
once, and revocation is immediate and total. Never commit the real key.

| File                       | Client                                         |
| :------------------------- | :--------------------------------------------- |
| `../.mcp.json`             | Claude Code (committed at the repository root) |
| `opencode.example.json`    | OpenCode                                       |
| `pi.example.json`          | Pi                                             |
| `antigravity.example.json` | Google Antigravity                             |
| `remote-http.example.json` | Any client, over the Streamable HTTP transport |

## Export the key first

```bash
export COSMOS_MCP_TOKEN="$(op read 'op://cosmos/prd/cosmos_mcp_token')"
# or, with Doppler:
eval "$(doppler secrets download --no-file --format env)"
```

## Local vs remote

**Local (stdio)** — spawns the server on this machine:

```bash
pnpm mcp:start
```

**Remote (Streamable HTTP)** — talks to the deployed container. The MCP HTTP port is
loopback-only inside the container and is deliberately **not** proxied by the public Nginx
listener, so forward it over SSH:

```bash
ssh -N -L 4100:127.0.0.1:4100 user@cosmos-host
```

Then point the client at `http://127.0.0.1:4100/mcp` with the `x-internal-secret` header.

## Verify

```bash
npx tsx --test tests/cosmosMcp.test.ts
node tests/smoke/cosmosMcpSmoke.mjs
```

Full reference: [`../../docs/COSMOS_MCP.md`](../../docs/COSMOS_MCP.md).
