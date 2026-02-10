#!/usr/bin/env npx tsx
/**
 * Klaviyo Marketing CLI
 *
 * Zod-validated CLI for Klaviyo marketing operations.
 */

import { z, createCommand, runCli, cacheCommands, cliTypes } from "@local/cli-utils";
import { KlaviyoClient } from "./klaviyo-client.js";

// Define commands with Zod schemas
const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => client.getTools(),
    "List all available commands"
  ),

  // ==================== Campaigns ====================
  "get-campaigns": createCommand(
    z.object({
      filter: z.string().optional().describe("Filter string for queries"),
      channel: z.enum(["email", "sms", "mobile_push"]).optional().describe("Channel type"),
    }),
    async (args, client: KlaviyoClient) => {
      const { filter, channel } = args as {
        filter?: string; channel?: "email" | "sms" | "mobile_push";
      };
      return client.getCampaigns({ filter, channel });
    },
    "List all campaigns"
  ),

  "get-campaign": createCommand(
    z.object({
      campaign: z.string().min(1).describe("Campaign ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { campaign } = args as { campaign: string };
      return client.getCampaign(campaign);
    },
    "Get campaign details"
  ),

  "get-campaign-report": createCommand(
    z.object({
      timeframe: z.string().optional().describe("Timeframe preset (e.g., last_30_days)"),
      statistics: z.string().optional().describe("JSON array of statistics to fetch"),
      conversionMetric: z.string().optional().describe("Conversion metric ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { timeframe, statistics, conversionMetric } = args as {
        timeframe?: string; statistics?: string; conversionMetric?: string;
      };

      let parsedStats: string[] | undefined;
      if (statistics) {
        try {
          parsedStats = JSON.parse(statistics);
        } catch {
          throw new Error("--statistics must be valid JSON array");
        }
      }

      let parsedTimeframe: { key: string } | { start: string; end: string } | undefined;
      if (timeframe) {
        try {
          parsedTimeframe = JSON.parse(timeframe);
        } catch {
          parsedTimeframe = { key: timeframe };
        }
      }

      let conversionMetricId = conversionMetric;
      if (!conversionMetricId) {
        const foundMetricId = await client.findPlacedOrderMetricId();
        if (foundMetricId) {
          conversionMetricId = foundMetricId;
        } else {
          throw new Error("--conversion-metric is required. Use get-metrics to find available metric IDs.");
        }
      }

      return client.getCampaignReport({
        conversionMetricId,
        timeframe: parsedTimeframe,
        statistics: parsedStats,
      });
    },
    "Get campaign performance report"
  ),

  // ==================== Flows ====================
  "get-flows": createCommand(
    z.object({
      filter: z.string().optional().describe("Filter string for queries"),
    }),
    async (args, client: KlaviyoClient) => {
      const { filter } = args as { filter?: string };
      return client.getFlows({ filter });
    },
    "List all flows"
  ),

  "get-flow": createCommand(
    z.object({
      flow: z.string().min(1).describe("Flow ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { flow } = args as { flow: string };
      return client.getFlow(flow);
    },
    "Get flow details"
  ),

  "get-flow-actions": createCommand(
    z.object({
      flow: z.string().min(1).describe("Flow ID"),
      all: cliTypes.bool().optional().describe("Fetch all pages (default: first page only)"),
    }),
    async (args, client: KlaviyoClient) => {
      const { flow, all } = args as { flow: string; all?: boolean };
      if (all) {
        const actions = await client.getAllFlowActions(flow);
        return { data: actions, totalCount: actions.length };
      }
      return client.getFlowActions(flow);
    },
    "Get actions (steps) for a flow"
  ),

  "get-flow-report": createCommand(
    z.object({
      timeframe: z.string().optional().describe("Timeframe preset (e.g., last_30_days)"),
    }),
    async (args, client: KlaviyoClient) => {
      const { timeframe } = args as { timeframe?: string };

      let parsedTimeframe: { key: string } | { start: string; end: string } | undefined;
      if (timeframe) {
        try {
          parsedTimeframe = JSON.parse(timeframe);
        } catch {
          parsedTimeframe = { key: timeframe };
        }
      }

      return client.getFlowReport({ timeframe: parsedTimeframe });
    },
    "Get flow performance report"
  ),

  // ==================== Segments ====================
  "get-segments": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => client.getSegments(),
    "List all segments"
  ),

  "get-segment": createCommand(
    z.object({
      segment: z.string().min(1).describe("Segment ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { segment } = args as { segment: string };
      return client.getSegment(segment);
    },
    "Get segment details"
  ),

  // ==================== Lists ====================
  "get-lists": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => client.getLists(),
    "List all subscriber lists"
  ),

  "get-list": createCommand(
    z.object({
      list: z.string().min(1).describe("List ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { list } = args as { list: string };
      return client.getList(list);
    },
    "Get list details"
  ),

  // ==================== Profiles ====================
  "get-profile": createCommand(
    z.object({
      profile: z.string().min(1).describe("Profile ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { profile } = args as { profile: string };
      return client.getProfile(profile);
    },
    "Get a profile by ID"
  ),

  "get-profiles": createCommand(
    z.object({
      filter: z.string().optional().describe("Filter string for queries"),
    }),
    async (args, client: KlaviyoClient) => {
      const { filter } = args as { filter?: string };
      return client.getProfiles({ filter });
    },
    "Get profiles (with optional filter)"
  ),

  // ==================== Metrics ====================
  "get-metrics": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => client.getMetrics(),
    "List all tracked metrics"
  ),

  "get-metric": createCommand(
    z.object({
      metric: z.string().min(1).describe("Metric ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { metric } = args as { metric: string };
      return client.getMetric(metric);
    },
    "Get metric details"
  ),

  // ==================== Account ====================
  "get-account": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => client.getAccount(),
    "Get account details"
  ),

  // Pre-built cache commands
  ...cacheCommands<KlaviyoClient>(),
};

// Run CLI
runCli(commands, KlaviyoClient, {
  programName: "klaviyo-cli",
  description: "Klaviyo email marketing operations",
});
