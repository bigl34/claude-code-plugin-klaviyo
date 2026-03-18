#!/usr/bin/env npx tsx
/**
 * Klaviyo Marketing CLI
 *
 * Zod-validated CLI for Klaviyo marketing operations.
 */

import { z, createCommand, runCli, cacheCommands, cliTypes, wrapUntrustedField, buildSafeOutput } from "@local/cli-utils";
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
      const result = await client.getCampaigns({ filter, channel });

      const campaigns = (result?.data || result || []);
      const wrappedCampaigns = (Array.isArray(campaigns) ? campaigns : []).map((c: any) => {
        const attrs = c.attributes || c;
        return {
          metadata: {
            id: c.id,
            status: attrs.status,
            channel: attrs.channel || channel,
            send_time: attrs.send_time || attrs.scheduled_at,
          },
          content: {
            name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }),
            subject: wrapUntrustedField("subject", attrs.subject || attrs.message?.subject, { maxChars: 500 }),
            previewText: wrapUntrustedField("preview_text", attrs.preview_text || attrs.message?.preview_text, { maxChars: 500 }),
          },
        };
      });

      return buildSafeOutput(
        { command: "get-campaigns", count: wrappedCampaigns.length },
        { campaigns: wrappedCampaigns }
      );
    },
    "List all campaigns"
  ),

  "get-campaign": createCommand(
    z.object({
      campaign: z.string().min(1).describe("Campaign ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { campaign } = args as { campaign: string };
      const result = await client.getCampaign(campaign);

      const c = result?.data || result;
      const attrs: any = c.attributes || c;
      return buildSafeOutput(
        {
          command: "get-campaign",
          id: c.id,
          status: attrs.status,
          channel: attrs.channel,
          send_time: attrs.send_time || attrs.scheduled_at,
        },
        {
          name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }),
          subject: wrapUntrustedField("subject", attrs.subject || attrs.message?.subject, { maxChars: 500 }),
          previewText: wrapUntrustedField("preview_text", attrs.preview_text || attrs.message?.preview_text, { maxChars: 500 }),
        }
      );
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
      const result = await client.getFlows({ filter });

      const flows = (result?.data || result || []);
      const wrappedFlows = (Array.isArray(flows) ? flows : []).map((f: any) => {
        const attrs = f.attributes || f;
        return {
          metadata: {
            id: f.id,
            status: attrs.status,
            trigger_type: attrs.trigger_type,
          },
          content: {
            name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }),
          },
        };
      });

      return buildSafeOutput(
        { command: "get-flows", count: wrappedFlows.length },
        { flows: wrappedFlows }
      );
    },
    "List all flows"
  ),

  "get-flow": createCommand(
    z.object({
      flow: z.string().min(1).describe("Flow ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { flow } = args as { flow: string };
      const result = await client.getFlow(flow);

      const f = result?.data || result;
      const attrs: any = f.attributes || f;
      return buildSafeOutput(
        {
          command: "get-flow",
          id: f.id,
          status: attrs.status,
          trigger_type: attrs.trigger_type,
        },
        {
          name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }),
        }
      );
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
      let result;
      if (all) {
        const actions = await client.getAllFlowActions(flow);
        result = { data: actions, totalCount: actions.length };
      } else {
        result = await client.getFlowActions(flow);
      }

      const actions = (result?.data || []);
      const wrappedActions = (Array.isArray(actions) ? actions : []).map((a: any) => {
        const attrs = a.attributes || a;
        return {
          metadata: {
            id: a.id,
            type: attrs.action_type || attrs.type,
            status: attrs.status,
          },
          content: {
            name: wrapUntrustedField("name", attrs.settings?.subject || attrs.name, { maxChars: 200 }),
          },
        };
      });

      return buildSafeOutput(
        { command: "get-flow-actions", flow, count: wrappedActions.length },
        { actions: wrappedActions }
      );
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
    async (_args, client: KlaviyoClient) => {
      const result = await client.getSegments();

      const segments = (result?.data || result || []);
      const wrappedSegments = (Array.isArray(segments) ? segments : []).map((s: any) => {
        const attrs = s.attributes || s;
        return {
          metadata: {
            id: s.id,
            profile_count: attrs.profile_count,
          },
          content: {
            name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }),
          },
        };
      });

      return buildSafeOutput(
        { command: "get-segments", count: wrappedSegments.length },
        { segments: wrappedSegments }
      );
    },
    "List all segments"
  ),

  "get-segment": createCommand(
    z.object({
      segment: z.string().min(1).describe("Segment ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { segment } = args as { segment: string };
      const result = await client.getSegment(segment);

      const s = result?.data || result;
      const attrs: any = s.attributes || s;
      return buildSafeOutput(
        { command: "get-segment", id: s.id, profile_count: attrs.profile_count },
        { name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }) }
      );
    },
    "Get segment details"
  ),

  // ==================== Lists ====================
  "get-lists": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => {
      const result = await client.getLists();

      const lists = (result?.data || result || []);
      const wrappedLists = (Array.isArray(lists) ? lists : []).map((l: any) => {
        const attrs = l.attributes || l;
        return {
          metadata: {
            id: l.id,
            profile_count: attrs.profile_count,
          },
          content: {
            name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }),
          },
        };
      });

      return buildSafeOutput(
        { command: "get-lists", count: wrappedLists.length },
        { lists: wrappedLists }
      );
    },
    "List all subscriber lists"
  ),

  "get-list": createCommand(
    z.object({
      list: z.string().min(1).describe("List ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { list } = args as { list: string };
      const result = await client.getList(list);

      const l = result?.data || result;
      const attrs: any = l.attributes || l;
      return buildSafeOutput(
        { command: "get-list", id: l.id, profile_count: attrs.profile_count },
        { name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }) }
      );
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
      const result = await client.getProfile(profile);

      const p = result?.data || result;
      const attrs: any = p.attributes || p;
      return buildSafeOutput(
        { command: "get-profile", id: p.id },
        {
          email: wrapUntrustedField("email", attrs.email, { maxChars: 200 }),
          firstName: wrapUntrustedField("first_name", attrs.first_name, { maxChars: 200 }),
          lastName: wrapUntrustedField("last_name", attrs.last_name, { maxChars: 200 }),
          phone: wrapUntrustedField("phone_number", attrs.phone_number, { maxChars: 200 }),
          title: wrapUntrustedField("title", attrs.title, { maxChars: 200 }),
          organization: wrapUntrustedField("organization", attrs.organization, { maxChars: 200 }),
        }
      );
    },
    "Get a profile by ID"
  ),

  "get-profiles": createCommand(
    z.object({
      filter: z.string().optional().describe("Filter string for queries"),
    }),
    async (args, client: KlaviyoClient) => {
      const { filter } = args as { filter?: string };
      const result = await client.getProfiles({ filter });

      const profiles = (result?.data || result || []);
      const wrappedProfiles = (Array.isArray(profiles) ? profiles : []).map((p: any) => {
        const attrs = p.attributes || p;
        return {
          metadata: { id: p.id },
          content: {
            email: wrapUntrustedField("email", attrs.email, { maxChars: 200 }),
            firstName: wrapUntrustedField("first_name", attrs.first_name, { maxChars: 200 }),
            lastName: wrapUntrustedField("last_name", attrs.last_name, { maxChars: 200 }),
            phone: wrapUntrustedField("phone_number", attrs.phone_number, { maxChars: 200 }),
            title: wrapUntrustedField("title", attrs.title, { maxChars: 200 }),
            organization: wrapUntrustedField("organization", attrs.organization, { maxChars: 200 }),
          },
        };
      });

      return buildSafeOutput(
        { command: "get-profiles", count: wrappedProfiles.length },
        { profiles: wrappedProfiles }
      );
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
