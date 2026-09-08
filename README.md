<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-klaviyo

Dedicated agent for Klaviyo email marketing operations via direct API

![Version](https://img.shields.io/badge/version-1.6.0-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- Campaign
- **get-campaigns** — List all campaigns
- **get-campaign** — Get campaign details
- **get-campaign-messages** — Read-only: get actual message subject, preview, sender fields, and parent-campaign tracking settings
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
- **get-metric-event-volume** — Query count event volume for one metric
- Form
- **get-forms** — List form metadata
- **get-form** — Get form metadata
- **get-form-versions** — List version metadata for a form
- **get-form-version** — Get form-version metadata
- Template
- **list-templates** — List saved/library email templates
- **get-template** — Get one template directly or through a flow message
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
git clone https://github.com/bigl34/claude-code-plugin-klaviyo.git
cd claude-code-plugin-klaviyo
cp config.template.json config.json  # fill in your credentials
npm --prefix scripts install
```

```bash
npm --prefix scripts run cli -- get-campaigns
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

| Command                 | Description                                                                                          | Options                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `get-campaigns`         | List all campaigns                                                                                   | `--filter`, `--channel` (email/sms/mobile_push, default: email) |
| `get-campaign`          | Get campaign details                                                                                 | `--campaign` (required)                                         |
| `get-campaign-messages` | Read-only: get actual message subject, preview, sender fields, and parent-campaign tracking settings | `--campaign` (required)                                         |
| `get-campaign-report`   | Get performance metrics                                                                              | `--timeframe`, `--statistics`, `--conversion-metric`            |

### Flow Commands

| Command            | Description           | Options                                                  |
| ------------------ | --------------------- | -------------------------------------------------------- |
| `get-flows`        | List all flows        | `--filter`                                               |
| `get-flow`         | Get flow details      | `--flow` (required)                                      |
| `get-flow-actions` | Get flow action steps | `--flow` (required), `--all` (optional, paginate all)    |
| `get-flow-report`  | Get flow performance  | `--timeframe`, `--conversion-metric` (optional override) |

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

| Command                   | Description                             | Options                                                                                                                             |
| ------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `get-metrics`             | List tracked metrics                    | -                                                                                                                                   |
| `get-metric`              | Get metric details                      | `--metric` (required)                                                                                                               |
| `get-metric-event-volume` | Query count event volume for one metric | exactly one of `--metric-id` or `--metric-name`, plus `--start`, `--end`, optional `--interval` (hour/day/week/month), `--timezone` |

### Form Commands

| Command             | Description                      | Options                                                              |
| ------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `get-forms`         | List form metadata               | `--filter`, `--page-size`, `--cursor`, `--sort`                      |
| `get-form`          | Get form metadata                | `--form` (required)                                                  |
| `get-form-versions` | List version metadata for a form | `--form` (required), `--filter`, `--page-size`, `--cursor`, `--sort` |
| `get-form-version`  | Get form-version metadata        | `--version` (required)                                               |

### Template Commands

| Command          | Description                                         | Options                                         |
| ---------------- | --------------------------------------------------- | ----------------------------------------------- |
| `list-templates` | List saved/library email templates                  | `--page-size` (1-10), `--cursor`, `--all`       |
| `get-template`   | Get one template directly or through a flow message | exactly one of `--template` or `--flow-message` |

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
npm --prefix "scripts" run cli -- get-campaigns

# Get specific campaign details
npm --prefix "scripts" run cli -- get-campaign --campaign abc123

# Get actual message-local subject/sender fields and parent campaign tracking settings
npm --prefix "scripts" run cli -- get-campaign-messages --campaign abc123

# Get campaign performance report
npm --prefix "scripts" run cli -- get-campaign-report --timeframe "last_30_days"

# List all flows
npm --prefix "scripts" run cli -- get-flows

# Get flow action steps (message sequences, delays, conditions)
npm --prefix "scripts" run cli -- get-flow-actions --flow abc123

# Get all flow actions (with pagination)
npm --prefix "scripts" run cli -- get-flow-actions --flow abc123 --all

# Get flow performance report
npm --prefix "scripts" run cli -- get-flow-report --timeframe "last_7_days"

# List all segments
npm --prefix "scripts" run cli -- get-segments

# List subscriber lists
npm --prefix "scripts" run cli -- get-lists

# Get profiles
npm --prefix "scripts" run cli -- get-profiles

# Query event volume for a known metric ID
npm --prefix "scripts" run cli -- get-metric-event-volume --metric-id METRIC_ID --start "2026-07-01T00:00:00" --end "2026-07-03T00:00:00" --interval day --timezone "Europe/London"

# Query event volume by exact case-insensitive metric name
npm --prefix "scripts" run cli -- get-metric-event-volume --metric-name "Placed Order" --start "2026-07-01T00:00:00" --end "2026-07-03T00:00:00"

# List form and form-version metadata
npm --prefix "scripts" run cli -- get-forms
npm --prefix "scripts" run cli -- get-form-versions --form FORM_ID

# List all saved templates, or fetch a flow-managed template
npm --prefix "scripts" run cli -- list-templates --all
npm --prefix "scripts" run cli -- get-template --flow-message FLOW_MESSAGE_ID

# Get account info
npm --prefix "scripts" run cli -- get-account

# List available tools (to discover all MCP capabilities)
npm --prefix "scripts" run cli -- list-tools
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

- **Saved and flow-managed templates differ**: `list-templates` covers the
  saved/library collection. Resolve flow-managed content through
  `get-template --flow-message`.
- **Channel required for campaigns**: The `get-campaigns` command defaults to `email` channel. Use `--channel sms` or `--channel mobile_push` for other types.
- **Forms are metadata-only**: The Forms API exposes form and form-version resources. This CLI intentionally limits form commands to metadata and does not fetch rendered form HTML or final copy.

## Contributing

Issues and pull requests are welcome.

## License

MIT
