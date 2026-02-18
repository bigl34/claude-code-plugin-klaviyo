<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-klaviyo

Dedicated agent for Klaviyo email marketing operations via direct API

![Version](https://img.shields.io/badge/version-1.2.9-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- Campaign
- **get-campaigns** — List all campaigns
- **get-campaign** — Get campaign details
- **get-campaign-report** — Get performance metrics
- Flow
- **get-flows** — List all flows
- **get-flow** — Get flow details
- **get-flow-actions** — Get flow action steps
- **get-flow-report** — Get flow performance
- Segment
- **get-segments** — List all segments
- **get-segment** — Get segment details
- List
- **get-lists** — List subscriber lists
- **get-list** — Get list details
- Profile
- **get-profile** — Get profile by ID
- **get-profiles** — Get profiles with filter
- Metrics
- **get-metrics** — List tracked metrics
- **get-metric** — Get metric details
- Account
- **get-account** — Get account info
- Discovery
- **list-tools** — List all available MCP tools

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- API credentials for the target service (see Configuration)

## Quick Start

```bash
git clone https://github.com/YOUR_GITHUB_USER/claude-code-plugin-klaviyo.git
cd claude-code-plugin-klaviyo
cp config.template.json config.json  # fill in your credentials
cd scripts && npm install
```

```bash
node scripts/dist/cli.js get-campaigns
```

## Installation

1. Clone this repository
2. Copy `config.template.json` to `config.json` and fill in your credentials
3. Install dependencies:
   ```bash
   cd scripts && npm install
   ```

## Available Commands

### Campaign Commands

| Command               | Description             | Options                                                         |
| --------------------- | ----------------------- | --------------------------------------------------------------- |
| `get-campaigns`       | List all campaigns      | `--filter`, `--channel` (email/sms/mobile_push, default: email) |
| `get-campaign`        | Get campaign details    | `--campaign` (required)                                         |
| `get-campaign-report` | Get performance metrics | `--timeframe`, `--statistics`, `--conversion-metric`            |

### Flow Commands

| Command            | Description           | Options                                               |
| ------------------ | --------------------- | ----------------------------------------------------- |
| `get-flows`        | List all flows        | `--filter`                                            |
| `get-flow`         | Get flow details      | `--flow` (required)                                   |
| `get-flow-actions` | Get flow action steps | `--flow` (required), `--all` (optional, paginate all) |
| `get-flow-report`  | Get flow performance  | `--timeframe`                                         |

### Segment Commands

| Command        | Description         | Options                |
| -------------- | ------------------- | ---------------------- |
| `get-segments` | List all segments   | -                      |
| `get-segment`  | Get segment details | `--segment` (required) |

### List Commands

| Command     | Description           | Options             |
| ----------- | --------------------- | ------------------- |
| `get-lists` | List subscriber lists | -                   |
| `get-list`  | Get list details      | `--list` (required) |

### Profile Commands

| Command        | Description              | Options                |
| -------------- | ------------------------ | ---------------------- |
| `get-profile`  | Get profile by ID        | `--profile` (required) |
| `get-profiles` | Get profiles with filter | `--filter`             |

### Metrics Commands

| Command       | Description          | Options               |
| ------------- | -------------------- | --------------------- |
| `get-metrics` | List tracked metrics | -                     |
| `get-metric`  | Get metric details   | `--metric` (required) |

### Account Commands

| Command       | Description      | Options |
| ------------- | ---------------- | ------- |
| `get-account` | Get account info | -       |

### Discovery Commands

| Command      | Description                  |
| ------------ | ---------------------------- |
| `list-tools` | List all available MCP tools |

## Usage Examples

```bash
# List all campaigns
node /Users/USER/node scripts/dist/cli.js get-campaigns

# Get specific campaign details
node /Users/USER/node scripts/dist/cli.js get-campaign --campaign abc123

# Get campaign performance report
node /Users/USER/node scripts/dist/cli.js get-campaign-report --timeframe "last_30_days"

# List all flows
node /Users/USER/node scripts/dist/cli.js get-flows

# Get flow action steps (message sequences, delays, conditions)
node /Users/USER/node scripts/dist/cli.js get-flow-actions --flow abc123

# Get all flow actions (with pagination)
node /Users/USER/node scripts/dist/cli.js get-flow-actions --flow abc123 --all

# Get flow performance report
node /Users/USER/node scripts/dist/cli.js get-flow-report --timeframe "last_7_days"

# List all segments
node /Users/USER/node scripts/dist/cli.js get-segments

# List subscriber lists
node /Users/USER/node scripts/dist/cli.js get-lists

# Get profiles
node /Users/USER/node scripts/dist/cli.js get-profiles

# Get account info
node /Users/USER/node scripts/dist/cli.js get-account

# List available tools (to discover all MCP capabilities)
node /Users/USER/node scripts/dist/cli.js list-tools
```

## How It Works

This plugin connects directly to the service's HTTP API. The CLI handles authentication, request formatting, pagination, and error handling, returning structured JSON responses.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Authentication errors | Verify credentials in `config.json` |
| `ERR_MODULE_NOT_FOUND` | Run `cd scripts && npm install` |
| Rate limiting | The CLI handles retries automatically; wait and retry if persistent |
| Unexpected JSON output | Check API credentials haven't expired |

## Known Limitations

- **No list-templates command**: The Klaviyo MCP server does not expose a tool to list all templates. You can only fetch a specific template by ID using `get-email-template`.
- **Channel required for campaigns**: The `get-campaigns` command defaults to `email` channel. Use `--channel sms` or `--channel mobile_push` for other types.

## Contributing

Issues and pull requests are welcome.

## License

MIT
