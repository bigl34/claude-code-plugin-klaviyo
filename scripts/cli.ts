#!/usr/bin/env npx tsx

import { z, createCommand, runCli, cacheCommands, cliTypes, wrapUntrustedField, buildSafeOutput, TRUNCATION_DEFAULTS } from "@local/cli-utils";
import { realpathSync } from "fs";
import { pathToFileURL } from "url";
import {
  KlaviyoClient,
  cursorFromNextLink,
  type CampaignMessage,
  type FlowAction,
  type FlowMessage,
  type Template,
} from "./klaviyo-client.js";

type WrappedField = ReturnType<typeof wrapUntrustedField>;
type KlaviyoResource = {
  id?: string;
  type?: string;
  attributes?: KlaviyoAttributes;
};
type KlaviyoAttributes = Record<string, unknown> & {
  name?: unknown;
  status?: unknown;
  channel?: unknown;
  send_time?: unknown;
  scheduled_at?: unknown;
  archived?: unknown;
  audiences?: unknown;
  send_options?: unknown;
  tracking_options?: unknown;
  created?: string;
  created_at?: string;
  updated?: string;
  updated_at?: string;
  sent_at?: string | null;
  subject?: unknown;
  preview_text?: unknown;
  message?: string | { body?: string; content?: string; subject?: unknown; preview_text?: unknown };
  definition?: unknown;
  trigger_type?: unknown;
  profile_count?: unknown;
  email?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  phone_number?: unknown;
  title?: unknown;
  organization?: unknown;
  ab_test?: unknown;
  form_type?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const attrsOf = (resource: KlaviyoResource): KlaviyoAttributes =>
  (isRecord(resource.attributes) ? resource.attributes : resource as Record<string, unknown>) as KlaviyoAttributes;

const dataArray = (result: unknown): KlaviyoResource[] => {
  if (isRecord(result) && Array.isArray(result.data)) return result.data as KlaviyoResource[];
  if (Array.isArray(result)) return result as KlaviyoResource[];
  return [];
};

const dataResource = (result: unknown): KlaviyoResource => {
  if (isRecord(result) && isRecord(result.data)) return result.data as KlaviyoResource;
  return isRecord(result) ? result as KlaviyoResource : {};
};

const messageBody = (message: KlaviyoAttributes["message"]): string | undefined => {
  if (typeof message === "string") return message;
  if (isRecord(message)) return message.body ?? message.content;
  return undefined;
};

const flowDefinitionRecord = (definition: unknown): Record<string, unknown> =>
  isRecord(definition) ? definition : {};

const BODY = TRUNCATION_DEFAULTS.body;
const SUBJECT = TRUNCATION_DEFAULTS.subject;
const NAME = TRUNCATION_DEFAULTS.displayName;

type CampaignChannel = "email" | "sms" | "mobile_push";

function wrapCampaignStructure(value: unknown, path: string): unknown {
  if (typeof value === "string") {
    return wrapUntrustedField(path, value, { maxChars: SUBJECT });
  }
  if (Array.isArray(value)) {
    return value.map((item) => wrapCampaignStructure(item, `${path}[]`));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        wrapCampaignStructure(item, `${path}.${key}`),
      ]),
    );
  }
  return value;
}

const TRACKING_BOOLEAN_FIELDS = [
  "is_add_utm",
  "add_tracking_params",
  "is_tracking_clicks",
  "is_tracking_opens",
] as const;

const TRACKING_PARAMETER_FIELDS = [
  "utm_params",
  "custom_tracking_params",
] as const;

type TrackingParameterField = typeof TRACKING_PARAMETER_FIELDS[number];
type WrappedTrackingParameters = Partial<
  Record<TrackingParameterField, Array<Record<string, WrappedField>>>
>;

export function normalizeCampaignTrackingOptions(value: unknown): {
  metadata?: Record<string, boolean>;
  content?: WrappedTrackingParameters;
} {
  if (!isRecord(value)) return {};

  const metadata: Record<string, boolean> = {};
  for (const field of TRACKING_BOOLEAN_FIELDS) {
    if (typeof value[field] === "boolean") metadata[field] = value[field];
  }

  const content: WrappedTrackingParameters = {};
  for (const parameterField of TRACKING_PARAMETER_FIELDS) {
    if (Array.isArray(value[parameterField])) {
      content[parameterField] = value[parameterField].map((parameter) => {
        const input: Record<string, unknown> = isRecord(parameter)
          ? parameter
          : { value: parameter };
        const output: Record<string, WrappedField> = {};
        for (const field of ["name", "value", "type"] as const) {
          if (input[field] !== undefined) {
            output[field] = wrapUntrustedField(
              `${parameterField}[].${field}`,
              input[field],
              { maxChars: field === "value" ? SUBJECT : NAME },
            );
          }
        }
        return output;
      });
    }
  }

  return {
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    content: Object.keys(content).length > 0 ? content : undefined,
  };
}

export function normalizeCampaignForOutput(c: KlaviyoResource, channel?: CampaignChannel) {
  const attrs = attrsOf(c);
  const createdIso: string | undefined = attrs.created_at ?? attrs.created;
  const updatedIso: string | undefined = attrs.updated_at ?? attrs.updated;
  const sentAt: string | null | undefined = attrs.sent_at ?? null;
  const messageText = messageBody(attrs.message);
  const trackingOptions = normalizeCampaignTrackingOptions(attrs.tracking_options);

  return {
    metadata: {
      id: c.id,
      status: attrs.status,
      channel: attrs.channel || channel,
      send_time: attrs.send_time || attrs.scheduled_at,
      archived: attrs.archived,
      send_options: attrs.send_options,
      tracking_options: trackingOptions.metadata,
      created: createdIso,
      updated: updatedIso,
      sent_at: sentAt,
    },
    content: {
      name: wrapUntrustedField("name", attrs.name, { maxChars: NAME }),
      subject: wrapUntrustedField("subject", attrs.subject || (isRecord(attrs.message) ? attrs.message.subject : undefined), { maxChars: SUBJECT }),
      previewText: wrapUntrustedField("preview_text", attrs.preview_text || (isRecord(attrs.message) ? attrs.message.preview_text : undefined), { maxChars: SUBJECT }),
      message: messageText
        ? wrapUntrustedField("message", messageText, { maxChars: BODY })
        : undefined,
      ...(attrs.audiences !== undefined
        ? { audiences: wrapCampaignStructure(attrs.audiences, "campaign.audiences") }
        : {}),
      tracking_options: trackingOptions.content,
    },
  };
}

export function normalizeCampaignMessageForOutput(message: CampaignMessage) {
  const attrs = message.attributes ?? {};
  const definition = attrs.definition ?? {};
  const messageContent = definition.content ?? {};
  const content: Record<string, WrappedField> = {};

  const wrapIfPresent = (
    outputKey: string,
    fieldName: string,
    value: unknown,
    maxChars: number,
  ) => {
    if (value !== undefined) {
      content[outputKey] = wrapUntrustedField(fieldName, value, { maxChars });
    }
  };

  wrapIfPresent("label", "label", definition.label, NAME);
  wrapIfPresent("subject", "subject", messageContent.subject, SUBJECT);
  wrapIfPresent("previewText", "preview_text", messageContent.preview_text, SUBJECT);
  wrapIfPresent("from_email", "from_email", messageContent.from_email, NAME);
  wrapIfPresent("from_label", "from_label", messageContent.from_label, NAME);
  wrapIfPresent("reply_to_email", "reply_to_email", messageContent.reply_to_email, NAME);
  wrapIfPresent("cc_email", "cc_email", messageContent.cc_email, NAME);
  wrapIfPresent("bcc_email", "bcc_email", messageContent.bcc_email, NAME);

  return {
    metadata: compactRecord({
      id: message.id,
      type: message.type,
      channel: definition.channel,
      send_times: attrs.send_times,
      created: attrs.created_at,
      updated: attrs.updated_at,
    }),
    content,
  };
}

interface NormalizedFlowMessage {
  id: string;
  channel?: string;
  from_email: WrappedField;
  from_label: WrappedField;
  reply_to_email: WrappedField;
  subject_line: WrappedField;
  template_id?: string;
}

interface NormalizedFlowAction {
  metadata: { id: string; type?: string };
  content: { settings?: unknown };
  messages?: NormalizedFlowMessage[];
  messageError?: string;
}

export function normalizeFlowMessageForOutput(m: FlowMessage): NormalizedFlowMessage {
  const def = m.attributes?.definition;
  return {
    id: m.id,
    channel: m.attributes?.channel,
    from_email: wrapUntrustedField("from_email", def?.from_email, { maxChars: NAME }),
    from_label: wrapUntrustedField("from_label", def?.from_label, { maxChars: NAME }),
    reply_to_email: wrapUntrustedField("reply_to_email", def?.reply_to_email, { maxChars: NAME }),
    subject_line: wrapUntrustedField("subject_line", def?.subject_line, { maxChars: SUBJECT }),
    template_id: def?.template_id,
  };
}

export function flowActionType(action: FlowAction): string | undefined {
  const def = action.attributes?.definition;
  return def?.action_type ?? def?.type;
}

function flowTriggerMetricIds(definition: unknown): string[] {
  const def = flowDefinitionRecord(definition);
  const triggers = Array.isArray(def.triggers) ? def.triggers.filter(isRecord) : [];
  return triggers
    .map((trigger) =>
      trigger?.id ??
      trigger?.metric_id ??
      trigger?.metricId ??
      (isRecord(trigger?.data) ? trigger.data.id : undefined) ??
      (isRecord(trigger?.data) ? trigger.data.metric_id : undefined)
    )
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
}

function hasMeaningfulFilter(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

export function flowDefinitionFilterFlags(definition: unknown): {
  hasTriggerFilter: boolean;
  hasFlowFilter: boolean;
} {
  const def = flowDefinitionRecord(definition);
  const triggers = Array.isArray(def.triggers) ? def.triggers.filter(isRecord) : [];
  return {
    hasTriggerFilter:
      hasMeaningfulFilter(def.trigger_filter) ||
      triggers.some((trigger) => hasMeaningfulFilter(trigger?.trigger_filter)),
    hasFlowFilter:
      hasMeaningfulFilter(def.flow_filter) ||
      triggers.some((trigger) => hasMeaningfulFilter(trigger?.flow_filter)),
  };
}

function formVariationName(attrs: KlaviyoAttributes): unknown {
  return attrs?.variation_name ?? attrs?.variationName ?? (isRecord(attrs?.ab_test) ? attrs.ab_test.variation_name : undefined);
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

export function normalizeTemplateForOutput(
  template: Template,
  flowMessage?: FlowMessage,
) {
  const attrs = template.attributes ?? {};
  const messageDefinition = flowMessage?.attributes?.definition;
  const content: Record<string, WrappedField> = {};

  if (attrs.name !== undefined) {
    content.name = wrapUntrustedField("name", attrs.name, { maxChars: NAME });
  }
  const subject = messageDefinition?.subject_line ?? attrs.subject;
  if (subject !== undefined) {
    content.subject = wrapUntrustedField("subject", subject, { maxChars: SUBJECT });
  }
  const previewText = messageDefinition?.preview_text ?? attrs.preview_text;
  if (previewText !== undefined) {
    content.previewText = wrapUntrustedField("preview_text", previewText, { maxChars: SUBJECT });
  }
  if (attrs.html !== undefined) {
    content.html = wrapUntrustedField("html", attrs.html, { maxChars: BODY });
  }
  if (attrs.text !== undefined) {
    content.text = wrapUntrustedField("text", attrs.text, { maxChars: BODY });
  }
  if (attrs.amp !== undefined) {
    content.amp = wrapUntrustedField("amp", attrs.amp, { maxChars: BODY });
  }

  return {
    metadata: compactRecord({
      id: template.id,
      type: template.type,
      editor_type: attrs.editor_type,
      created: attrs.created,
      updated: attrs.updated,
    }),
    content,
  };
}

function normalizeFormForOutput(form: KlaviyoResource) {
  const attrs = attrsOf(form);
  const variationName = formVariationName(attrs);
  const content: Record<string, unknown> = {};
  if (attrs.name !== undefined) {
    content.name = wrapUntrustedField("name", attrs.name, { maxChars: NAME });
  }
  if (variationName !== undefined) {
    content.variationName = wrapUntrustedField("variation_name", variationName, { maxChars: NAME });
  }

  return {
    metadata: compactRecord({
      id: form.id,
      type: form.type,
      status: attrs.status,
      ab_test: typeof attrs.ab_test === "boolean" ? attrs.ab_test : undefined,
      created_at: attrs.created_at,
      updated_at: attrs.updated_at,
    }),
    content,
  };
}

function normalizeFormVersionForOutput(version: KlaviyoResource) {
  const attrs = attrsOf(version);
  const variationName = formVariationName(attrs);
  const content: Record<string, unknown> = {};
  if (attrs.name !== undefined) {
    content.name = wrapUntrustedField("name", attrs.name, { maxChars: NAME });
  }
  if (variationName !== undefined) {
    content.variationName = wrapUntrustedField("variation_name", variationName, { maxChars: NAME });
  }

  return {
    metadata: compactRecord({
      id: version.id,
      type: version.type,
      form_type: attrs.form_type,
      status: attrs.status,
      ab_test: typeof attrs.ab_test === "boolean" ? attrs.ab_test : undefined,
      created_at: attrs.created_at,
      updated_at: attrs.updated_at,
    }),
    content,
  };
}

export function normalizeFlowActionForOutput(
  action: FlowAction,
  messages?: FlowMessage[],
): NormalizedFlowAction {
  const def = action.attributes?.definition;
  const actionType = flowActionType(action);
  const settings = def?.data ?? def?.settings;

  const out: NormalizedFlowAction = {
    metadata: { id: action.id, type: actionType },
    content: {},
  };

  if (settings !== undefined) {
    out.content.settings = settings;
  }

  if (actionType === "send-email" && messages) {
    out.messages = messages.map(normalizeFlowMessageForOutput);
  }

  return out;
}

async function resolveConversionMetricId(
  client: KlaviyoClient,
  conversionMetric?: string,
): Promise<string> {
  if (conversionMetric) return conversionMetric;

  const foundMetricId = await client.findPlacedOrderMetricId();
  if (foundMetricId) return foundMetricId;

  throw new Error(
    "Could not resolve the Klaviyo Placed Order metric automatically. Pass --conversion-metric <metric_id> after checking get-metrics.",
  );
}

export const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (): Promise<Array<{ name: string; description: string }>> => Object.entries(commands).map(([name, command]) => ({
      name,
      description: command.description ?? "",
    })),
    "List all available commands",
    { sideEffect: "read" }
  ),

  "get-campaigns": createCommand(
    z.object({
      filter: z.string().optional().describe("Filter string for queries"),
      channel: z.enum(["email", "sms", "mobile_push"]).optional().describe("Channel type"),
      pageSize: cliTypes.int(1, 100).optional().describe("Campaigns per page (Klaviyo maximum: 100)"),
      cursor: z.string().min(1).optional().describe("Opaque pagination cursor from metadata.next_cursor"),
      updatedSince: z.string().min(1).optional().describe("Only campaigns whose updated_at is at or after this ISO 8601 datetime"),
    }),
    async (args, client: KlaviyoClient) => {
      const { filter, channel, pageSize, cursor, updatedSince } = args as {
        filter?: string;
        channel?: "email" | "sms" | "mobile_push";
        pageSize?: number;
        cursor?: string;
        updatedSince?: string;
      };
      const effectiveChannel = channel ?? "email";
      const result = await client.getCampaigns({ filter, channel: effectiveChannel, pageSize, cursor, updatedSince });

      const wrappedCampaigns = dataArray(result)
        .map((c) => normalizeCampaignForOutput(c, effectiveChannel));
      const nextCursor = cursorFromNextLink(result.links?.next);
      const hasMore = Boolean(result.links?.next);

      return buildSafeOutput(
        {
          command: "get-campaigns",
          channel: effectiveChannel,
          count: wrappedCampaigns.length,
          page_size: pageSize ?? null,
          updated_since: updatedSince ?? null,
          requested_cursor: cursor ?? null,
          next_cursor: nextCursor ?? null,
          has_more: hasMore,
          coverage: "single_page",
        },
        { campaigns: wrappedCampaigns }
      );
    },
    "List one page of campaigns for a channel; for the next page repeat the same flags with --cursor set to metadata.next_cursor",
    { sideEffect: "read" }
  ),

  "get-campaign": createCommand(
    z.object({
      campaign: z.string().min(1).describe("Campaign ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { campaign } = args as { campaign: string };
      const result = await client.getCampaign(campaign);

      const c = dataResource(result);
      const normalized = normalizeCampaignForOutput(c);
      return buildSafeOutput(
        {
          command: "get-campaign",
          ...normalized.metadata,
        },
        normalized.content,
      );
    },
    "Get campaign details",
    { sideEffect: "read" }
  ),

  "get-campaign-messages": createCommand(
    z.object({
      campaign: z.string().min(1).describe("Campaign ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { campaign } = args as { campaign: string };
      const [campaignResult, messagesResult] = await Promise.all([
        client.getCampaign(campaign),
        client.getCampaignMessages(campaign),
      ]);
      const campaignAttrs = attrsOf(dataResource(campaignResult));
      const messages = messagesResult.data.map(normalizeCampaignMessageForOutput);
      const trackingOptions = normalizeCampaignTrackingOptions(campaignAttrs.tracking_options);

      return buildSafeOutput(
        {
          command: "get-campaign-messages",
          campaign_id: campaign,
          message_count: messages.length,
          campaign_tracking_options: trackingOptions.metadata,
          tracking_options_source: "parent_campaign",
        },
        {
          messages,
          campaign_tracking_options: trackingOptions.content,
        },
        [
          "Subject, preview, and sender fields are message-local; campaign_tracking_options comes from the parent campaign.",
        ],
      );
    },
    "Get campaign message subject/sender details and parent campaign tracking options",
    { sideEffect: "read" },
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

      const conversionMetricId = await resolveConversionMetricId(client, conversionMetric);

      return client.getCampaignReport({
        conversionMetricId,
        timeframe: parsedTimeframe,
        statistics: parsedStats,
      });
    },
    "Get campaign performance report",
    { sideEffect: "read" }
  ),

  "get-flows": createCommand(
    z.object({
      filter: z.string().optional().describe("Filter string for queries"),
      pageSize: cliTypes.int(1, 50).optional().describe("Flows per page (Klaviyo maximum: 50)"),
      cursor: z.string().min(1).optional().describe("Opaque pagination cursor from metadata.next_cursor"),
      updatedSince: z.string().min(1).optional().describe("Only flows whose updated time is at or after this ISO 8601 datetime"),
    }),
    async (args, client: KlaviyoClient) => {
      const { filter, pageSize, cursor, updatedSince } = args as {
        filter?: string;
        pageSize?: number;
        cursor?: string;
        updatedSince?: string;
      };
      const result = await client.getFlows({ filter, pageSize, cursor, updatedSince });

      const wrappedFlows = dataArray(result).map((f) => {
        const attrs = attrsOf(f);
        const createdIso: string | undefined = attrs.created ?? attrs.created_at;
        const updatedIso: string | undefined = attrs.updated ?? attrs.updated_at;
        const sentAt: string | null | undefined = attrs.sent_at ?? null;
        const messageText = messageBody(attrs.message);
        return {
          metadata: {
            id: f.id,
            status: attrs.status,
            trigger_type: attrs.trigger_type,
            archived: attrs.archived,
            created: createdIso,
            updated: updatedIso,
            sent_at: sentAt,
          },
          content: {
            name: wrapUntrustedField("name", attrs.name, { maxChars: NAME }),
            message: messageText
              ? wrapUntrustedField("message", messageText, { maxChars: BODY })
              : undefined,
          },
        };
      });

      const nextCursor = cursorFromNextLink(result.links?.next);
      const hasMore = Boolean(result.links?.next);

      return buildSafeOutput(
        {
          command: "get-flows",
          count: wrappedFlows.length,
          page_size: pageSize ?? null,
          updated_since: updatedSince ?? null,
          requested_cursor: cursor ?? null,
          next_cursor: nextCursor ?? null,
          has_more: hasMore,
          coverage: "single_page",
        },
        { flows: wrappedFlows }
      );
    },
    "List one page of flows; for the next page repeat the same flags with --cursor set to metadata.next_cursor",
    { sideEffect: "read" }
  ),

  "get-flow": createCommand(
    z.object({
      flow: z.string().min(1).describe("Flow ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { flow } = args as { flow: string };
      const result = await client.getFlow(flow);

      const f = dataResource(result);
      const attrs = attrsOf(f);
      const definition = attrs.definition;
      const definitionRecord = flowDefinitionRecord(definition);
      const filterFlags = flowDefinitionFilterFlags(definition);
      return buildSafeOutput(
        {
          command: "get-flow",
          id: f.id,
          status: attrs.status,
          trigger_type: attrs.trigger_type,
          trigger_metric_ids: flowTriggerMetricIds(definition),
          trigger_count: Array.isArray(definitionRecord.triggers) ? definitionRecord.triggers.length : 0,
          has_trigger_filter: filterFlags.hasTriggerFilter,
          has_flow_filter: filterFlags.hasFlowFilter,
        },
        {
          name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }),
          definition: definition
            ? wrapUntrustedField("definition", JSON.stringify(definition), { maxChars: BODY })
            : undefined,
        }
      );
    },
    "Get flow details",
    { sideEffect: "read" }
  ),

  "get-flow-actions": createCommand(
    z.object({
      flow: z.string().min(1).describe("Flow ID"),
      all: cliTypes.bool().optional().describe("Fetch all pages (default: first page only)"),
    }),
    async (args, client: KlaviyoClient) => {
      const { flow, all } = args as { flow: string; all?: boolean };

      let actionsResult;
      if (all) {
        const actions = await client.getAllFlowActions(flow);
        actionsResult = { data: actions };
      } else {
        actionsResult = await client.getFlowActions(flow);
      }

      const actions: FlowAction[] = Array.isArray(actionsResult?.data) ? actionsResult.data : [];

      const isSendEmail = (a: FlowAction) => flowActionType(a) === "send-email";
      const sendEmailActionIds = actions.filter(isSendEmail).map((a) => a.id);

      const fetchedMessages = await client.getSendEmailMessages(sendEmailActionIds);
      const messagesByAction = new Map<string, { messages: FlowMessage[]; error?: string }>();
      for (const entry of fetchedMessages) {
        messagesByAction.set(entry.actionId, { messages: entry.messages, error: entry.error });
      }

      const wrappedActions = actions.map((a) => {
        if (!isSendEmail(a)) {
          return normalizeFlowActionForOutput(a);
        }
        const fetched = messagesByAction.get(a.id);
        const shaped = normalizeFlowActionForOutput(a, fetched?.messages ?? []);
        if (fetched?.error) {
          shaped.messageError = fetched.error;
        }
        return shaped;
      });

      return buildSafeOutput(
        { command: "get-flow-actions", flow, count: wrappedActions.length },
        { actions: wrappedActions }
      );
    },
    "Get actions (steps) for a flow, including sender envelope for send-email steps",
    { sideEffect: "read" }
  ),

  "get-flow-report": createCommand(
    z.object({
      conversionMetric: z.string().optional().describe("Conversion metric ID override"),
      timeframe: z.string().optional().describe("Timeframe preset (e.g., last_30_days)"),
    }),
    async (args, client: KlaviyoClient) => {
      const { conversionMetric, timeframe } = args as {
        conversionMetric?: string;
        timeframe?: string;
      };

      let parsedTimeframe: { key: string } | { start: string; end: string } | undefined;
      if (timeframe) {
        try {
          parsedTimeframe = JSON.parse(timeframe);
        } catch {
          parsedTimeframe = { key: timeframe };
        }
      }

      const conversionMetricId = await resolveConversionMetricId(client, conversionMetric);

      return client.getFlowReport({ conversionMetricId, timeframe: parsedTimeframe });
    },
    "Get flow performance report",
    { sideEffect: "read" }
  ),

  "list-templates": createCommand(
    z.object({
      pageSize: cliTypes.int(1, 10).optional().describe("Templates per page (Klaviyo maximum: 10)"),
      cursor: z.string().min(1).optional().describe("Opaque pagination cursor from metadata.next_cursor"),
      all: cliTypes.bool().optional().describe("Fetch all remaining pages"),
    }),
    async (args, client: KlaviyoClient) => {
      const { pageSize, cursor, all } = args as {
        pageSize?: number;
        cursor?: string;
        all?: boolean;
      };
      const effectivePageSize = pageSize ?? 10;

      let templates: Template[];
      let pagesFetched: number;
      let nextCursor: string | undefined;

      if (all) {
        const result = await client.getAllTemplates({ pageSize: effectivePageSize, cursor });
        templates = result.data;
        pagesFetched = result.pagesFetched;
      } else {
        const result = await client.getTemplates({ pageSize: effectivePageSize, cursor });
        templates = result.data ?? [];
        pagesFetched = 1;
        nextCursor = cursorFromNextLink(result.links?.next);
      }

      return buildSafeOutput(
        {
          command: "list-templates",
          count: templates.length,
          page_size: effectivePageSize,
          requested_cursor: cursor ?? null,
          next_cursor: nextCursor ?? null,
          has_more: nextCursor !== undefined,
          pages_fetched: pagesFetched,
          coverage: all ? "all_remaining_pages" : "single_page",
        },
        { templates: templates.map((template) => normalizeTemplateForOutput(template)) },
        [
          "The templates collection contains saved/library templates only. Flow-managed templates are available through get-template --flow-message.",
        ],
      );
    },
    "List saved Klaviyo email templates with resumable cursor pagination",
    { sideEffect: "read" },
  ),

  "get-template": createCommand(
    z.object({
      template: z.string().min(1).optional().describe("Template ID for direct retrieval"),
      flowMessage: z.string().min(1).optional().describe("Flow-message ID whose linked template should be fetched"),
    }).refine(
      (args) => Number(Boolean(args.template)) + Number(Boolean(args.flowMessage)) === 1,
      { message: "Pass exactly one of --template or --flow-message" },
    ),
    async (args, client: KlaviyoClient) => {
      const { template: templateId, flowMessage: flowMessageId } = args as {
        template?: string;
        flowMessage?: string;
      };

      if (templateId) {
        const result = await client.getTemplate(templateId);
        const normalized = normalizeTemplateForOutput(result.data);
        return buildSafeOutput(
          {
            command: "get-template",
            source: "direct_template",
            ...normalized.metadata,
          },
          normalized.content,
        );
      }

      const result = await client.getFlowMessageTemplate(flowMessageId!);
      const flowMessage = result.data;
      const linkedTemplate = result.included?.find(
        (resource) => resource.type === "template",
      );
      if (!linkedTemplate) {
        throw new Error(
          `Flow message "${flowMessageId}" has no linked template`,
        );
      }

      const normalized = normalizeTemplateForOutput(linkedTemplate, flowMessage);
      return buildSafeOutput(
        {
          command: "get-template",
          source: "flow_message",
          flow_message_id: flowMessage.id,
          channel: flowMessage.attributes?.channel,
          template_id: flowMessage.attributes?.definition?.template_id ?? linkedTemplate.id,
          ...normalized.metadata,
        },
        normalized.content,
      );
    },
    "Get a Klaviyo template directly or through a flow-message relationship",
    { sideEffect: "read" },
  ),

  "get-segments": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => {
      const result = await client.getSegments();

      const wrappedSegments = dataArray(result).map((s) => {
        const attrs = attrsOf(s);
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
    "List all segments",
    { sideEffect: "read" }
  ),

  "get-segment": createCommand(
    z.object({
      segment: z.string().min(1).describe("Segment ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { segment } = args as { segment: string };
      const result = await client.getSegment(segment);

      const s = dataResource(result);
      const attrs = attrsOf(s);
      return buildSafeOutput(
        { command: "get-segment", id: s.id, profile_count: attrs.profile_count },
        { name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }) }
      );
    },
    "Get segment details",
    { sideEffect: "read" }
  ),

  "get-lists": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => {
      const result = await client.getLists();

      const wrappedLists = dataArray(result).map((l) => {
        const attrs = attrsOf(l);
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
    "List all subscriber lists",
    { sideEffect: "read" }
  ),

  "get-list": createCommand(
    z.object({
      list: z.string().min(1).describe("List ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { list } = args as { list: string };
      const result = await client.getList(list);

      const l = dataResource(result);
      const attrs = attrsOf(l);
      return buildSafeOutput(
        { command: "get-list", id: l.id, profile_count: attrs.profile_count },
        { name: wrapUntrustedField("name", attrs.name, { maxChars: 200 }) }
      );
    },
    "Get list details",
    { sideEffect: "read" }
  ),

  "get-profile": createCommand(
    z.object({
      profile: z.string().min(1).describe("Profile ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { profile } = args as { profile: string };
      const result = await client.getProfile(profile);

      const p = dataResource(result);
      const attrs = attrsOf(p);
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
    "Get a profile by ID",
    { sideEffect: "read" }
  ),

  "get-profiles": createCommand(
    z.object({
      filter: z.string().optional().describe("Filter string for queries"),
    }),
    async (args, client: KlaviyoClient) => {
      const { filter } = args as { filter?: string };
      const result = await client.getProfiles({ filter });

      const wrappedProfiles = dataArray(result).map((p) => {
        const attrs = attrsOf(p);
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
    "Get profiles (with optional filter)",
    { sideEffect: "read" }
  ),

  "get-metrics": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => client.getMetrics(),
    "List all tracked metrics",
    { sideEffect: "read" }
  ),

  "get-metric": createCommand(
    z.object({
      metric: z.string().min(1).describe("Metric ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { metric } = args as { metric: string };
      return client.getMetric(metric);
    },
    "Get metric details",
    { sideEffect: "read" }
  ),

  "get-metric-event-volume": createCommand(
    z.object({
      metricId: z.string().min(1).optional().describe("Metric ID"),
      metricName: z.string().min(1).optional().describe("Exact metric name, case-insensitive"),
      start: z.string().min(1).describe("Inclusive start datetime"),
      end: z.string().min(1).describe("Exclusive end datetime"),
      interval: z.enum(["hour", "day", "week", "month"]).optional().default("day"),
      timezone: z.string().min(1).optional().describe("IANA timezone for aggregation"),
    }).refine(
      (args) => Number(Boolean(args.metricId)) + Number(Boolean(args.metricName)) === 1,
      { message: "Pass exactly one of --metric-id or --metric-name" },
    ),
    async (args, client: KlaviyoClient) => {
      const { metricId, metricName, start, end, interval, timezone } = args as {
        metricId?: string;
        metricName?: string;
        start: string;
        end: string;
        interval: "hour" | "day" | "week" | "month";
        timezone?: string;
      };

      const resolvedMetricId = metricId ?? await client.resolveMetricIdByName(metricName as string);
      return client.getMetricEventVolume({
        metricId: resolvedMetricId,
        start,
        end,
        interval,
        timezone,
      });
    },
    "Query count event volume for a metric via Klaviyo's read-style metric-aggregates POST",
    { sideEffect: "read" }
  ),

  "get-forms": createCommand(
    z.object({
      filter: z.string().optional().describe("Klaviyo filter string"),
      pageSize: cliTypes.int(1, 100).optional().describe("Results per page"),
      cursor: z.string().optional().describe("Pagination cursor"),
      sort: z.enum(["created_at", "-created_at", "updated_at", "-updated_at"]).optional(),
    }),
    async (args, client: KlaviyoClient) => {
      const { filter, pageSize, cursor, sort } = args as {
        filter?: string;
        pageSize?: number;
        cursor?: string;
        sort?: "created_at" | "-created_at" | "updated_at" | "-updated_at";
      };
      const result = await client.getForms({ filter, pageSize, cursor, sort });
      const forms = Array.isArray(result?.data) ? result.data : [];
      return buildSafeOutput(
        {
          command: "get-forms",
          count: forms.length,
          next: result?.links?.next,
          prev: result?.links?.prev,
        },
        { forms: forms.map(normalizeFormForOutput) },
        ["Form commands expose metadata only; rendered form HTML/copy is not returned."],
      );
    },
    "List Klaviyo form metadata",
    { sideEffect: "read" }
  ),

  "get-form": createCommand(
    z.object({
      form: z.string().min(1).describe("Form ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { form } = args as { form: string };
      const result = await client.getForm(form);
      const normalized = normalizeFormForOutput(result?.data || result);
      return buildSafeOutput(
        { command: "get-form", ...normalized.metadata },
        normalized.content,
        ["Form commands expose metadata only; rendered form HTML/copy is not returned."],
      );
    },
    "Get Klaviyo form metadata by ID",
    { sideEffect: "read" }
  ),

  "get-form-versions": createCommand(
    z.object({
      form: z.string().min(1).describe("Form ID"),
      filter: z.string().optional().describe("Klaviyo filter string"),
      pageSize: cliTypes.int(1, 100).optional().describe("Results per page"),
      cursor: z.string().optional().describe("Pagination cursor"),
      sort: z.enum(["created_at", "-created_at", "updated_at", "-updated_at"]).optional(),
    }),
    async (args, client: KlaviyoClient) => {
      const { form, filter, pageSize, cursor, sort } = args as {
        form: string;
        filter?: string;
        pageSize?: number;
        cursor?: string;
        sort?: "created_at" | "-created_at" | "updated_at" | "-updated_at";
      };
      const result = await client.getFormVersions(form, { filter, pageSize, cursor, sort });
      const versions = Array.isArray(result?.data) ? result.data : [];
      return buildSafeOutput(
        {
          command: "get-form-versions",
          form,
          count: versions.length,
          next: result?.links?.next,
          prev: result?.links?.prev,
        },
        { versions: versions.map(normalizeFormVersionForOutput) },
        ["Form-version commands expose metadata only; rendered form HTML/copy is not returned."],
      );
    },
    "List metadata for versions of a Klaviyo form",
    { sideEffect: "read" }
  ),

  "get-form-version": createCommand(
    z.object({
      version: z.string().min(1).describe("Form version ID"),
    }),
    async (args, client: KlaviyoClient) => {
      const { version } = args as { version: string };
      const result = await client.getFormVersion(version);
      const normalized = normalizeFormVersionForOutput(result?.data || result);
      return buildSafeOutput(
        { command: "get-form-version", ...normalized.metadata },
        normalized.content,
        ["Form-version commands expose metadata only; rendered form HTML/copy is not returned."],
      );
    },
    "Get Klaviyo form-version metadata by ID",
    { sideEffect: "read" }
  ),

  "get-account": createCommand(
    z.object({}),
    async (_args, client: KlaviyoClient) => client.getAccount(),
    "Get account details",
    { sideEffect: "read" }
  ),

  ...cacheCommands<KlaviyoClient>(),
};

let isCliEntry = false;
try {
  isCliEntry =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
} catch {
  isCliEntry = false;
}

if (isCliEntry) {
  runCli(commands, KlaviyoClient, {
    programName: "klaviyo-cli",
    description: "Klaviyo email marketing operations",
  });
}

