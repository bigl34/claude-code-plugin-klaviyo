
import {
  loadServiceConfig,
  normalizeLegacyMcpConfig,
  z,
} from "@local/cli-utils";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";
import { fetchWithRetry, sleep } from "./vendor/retry/index.js";

export const API_REVISION = "2026-04-15";
const BASE_URL = "https://a.klaviyo.com/api";
const DEFAULT_TIMEOUT = 30000;
const CAMPAIGN_FIELDS = [
  "name",
  "status",
  "archived",
  "audiences",
  "send_options",
  "tracking_options",
  "created_at",
  "updated_at",
  "scheduled_at",
  "send_time",
].join(",");

type JsonObject = Record<string, unknown>;
type ReportRequestBody = {
  data: {
    type: string;
    attributes: JsonObject;
  };
};

const KlaviyoConfigSchema = z.object({
  klaviyo: z.object({
    apiKey: z.string().min(1),
  }),
});

interface Campaign {
  id: string;
  type: string;
  attributes: {
    name: string;
    status: string;
    archived: boolean;
    audiences?: JsonObject;
    send_options?: JsonObject;
    tracking_options?: JsonObject;
    created_at?: string;
    updated_at?: string;
    scheduled_at?: string;
    send_time?: string;
  };
  relationships?: JsonObject;
}

interface Flow {
  id: string;
  type: string;
  attributes: {
    name: string;
    status: string;
    archived: boolean;
    trigger_type?: string;
    definition?: {
      triggers?: Array<Record<string, unknown>>;
      trigger_filter?: unknown;
      flow_filter?: unknown;
      [key: string]: unknown;
    };
    created?: string;
    updated?: string;
  };
}

export interface CampaignMessage {
  id: string;
  type: string;
  attributes: {
    definition?: {
      channel?: CampaignChannel;
      label?: string;
      content?: {
        subject?: string;
        preview_text?: string;
        from_email?: string;
        from_label?: string;
        reply_to_email?: string | null;
        cc_email?: string | null;
        bcc_email?: string | null;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    send_times?: Array<{
      datetime?: string;
      is_local?: boolean;
      [key: string]: unknown;
    }>;
    created_at?: string;
    updated_at?: string;
  };
}

export interface FlowActionDefinition {
  type?: string;
  data?: {
    unit?: string;
    value?: number;
    [key: string]: unknown;
  };
  action_type?: string;
  settings?: {
    delay_seconds?: number;
    [key: string]: unknown;
  };
  links?: { next?: string };
  [key: string]: unknown;
}

export interface FlowAction {
  id: string;
  type: string;
  attributes: {
    definition?: FlowActionDefinition;
    created?: string;
    updated?: string;
  };
  relationships?: {
    flow?: { data: { id: string; type: string } };
    "flow-messages"?: {
      data?: Array<{ id: string; type: string }>;
      links?: { self?: string; related?: string };
    };
  };
}

export interface FlowMessageDefinition {
  from_email?: string;
  from_label?: string;
  reply_to_email?: string;
  cc_email?: string;
  bcc_email?: string;
  subject_line?: string;
  preview_text?: string;
  template_id?: string;
  content?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FlowMessage {
  id: string;
  type: string;
  attributes: {
    channel?: string;
    definition?: FlowMessageDefinition;
    created?: string;
    updated?: string;
  };
}

interface Segment {
  id: string;
  type: string;
  attributes: {
    name: string;
    definition?: JsonObject;
    created?: string;
    updated?: string;
  };
}

interface List {
  id: string;
  type: string;
  attributes: {
    name: string;
    created?: string;
    updated?: string;
  };
}

interface Profile {
  id: string;
  type: string;
  attributes: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone_number?: string;
    created?: string;
    updated?: string;
  };
}

interface Metric {
  id: string;
  type: string;
  attributes: {
    name: string;
    created?: string;
    updated?: string;
  };
}

interface Form {
  id: string;
  type: string;
  attributes: {
    name?: string;
    status?: string;
    ab_test?: boolean;
    created_at?: string;
    updated_at?: string;
  };
}

interface FormVersion {
  id: string;
  type: string;
  attributes: {
    name?: string;
    form_type?: string;
    status?: string;
    ab_test?: boolean | Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
  };
  relationships?: Record<string, unknown>;
}

export interface Template {
  id: string;
  type: string;
  attributes: {
    name?: string;
    editor_type?: string;
    html?: string;
    text?: string;
    amp?: string;
    subject?: string;
    preview_text?: string;
    created?: string;
    updated?: string;
  };
}

interface Account {
  id: string;
  type: string;
  attributes: {
    test_account: boolean;
    contact_information?: JsonObject;
    industry?: string;
    timezone?: string;
    preferred_currency?: string;
    public_api_key?: string;
  };
}

interface ListResponse<T> {
  data: T[];
  links?: {
    self?: string;
    next?: string;
    prev?: string;
  };
}

interface SingleResponse<T> {
  data: T;
}

export interface FlowMessageTemplateResponse {
  data: FlowMessage;
  included?: Template[];
}

export interface AllTemplatesResponse {
  data: Template[];
  pagesFetched: number;
}

type CampaignChannel = "email" | "sms" | "mobile_push";
type MetricAggregateInterval = "hour" | "day" | "week" | "month";

interface CampaignListOptions {
  channel?: CampaignChannel;
  filter?: string;
  pageSize?: number;
  cursor?: string;
  updatedSince?: string;
}

interface FlowListOptions {
  filter?: string;
  pageSize?: number;
  cursor?: string;
  updatedSince?: string;
}

export function buildCampaignsCacheKey(options?: CampaignListOptions): string {
  const channel = options?.channel || "email";
  return createCacheKey("campaigns", {
    revision: API_REVISION,
    channel,
    filter: options?.filter,
    pageSize: options?.pageSize,
    cursor: options?.cursor,
    updatedSince: options?.updatedSince,
  });
}

export function buildFlowsCacheKey(options?: FlowListOptions): string {
  return createCacheKey("flows", {
    filter: options?.filter,
    pageSize: options?.pageSize,
    cursor: options?.cursor,
    updatedSince: options?.updatedSince,
  });
}

export function toFilterDatetime(value: string): string {
  const epochMs = Date.parse(value);
  if (Number.isNaN(epochMs)) {
    throw new Error(`Invalid datetime for a Klaviyo filter: "${value}"`);
  }
  const wholeSecondMs = Math.floor(epochMs / 1000) * 1000;
  const wholeSecondIso = new Date(wholeSecondMs).toISOString();
  return wholeSecondIso.replace(".000Z", "Z");
}

function combineFilters(clauses: string[]): string | undefined {
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return `and(${clauses.join(",")})`;
}

export function cursorFromNextLink(next?: string): string | undefined {
  if (!next) return undefined;
  const url = new URL(next, `${BASE_URL}/`);
  return url.searchParams.get("page[cursor]") || undefined;
}

export function buildMetricAggregateBody(options: {
  metricId: string;
  start: string;
  end: string;
  interval: MetricAggregateInterval;
  timezone?: string;
}): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    metric_id: options.metricId,
    measurements: ["count"],
    filter: [
      `greater-or-equal(datetime,${options.start})`,
      `less-than(datetime,${options.end})`,
    ],
    interval: options.interval,
  };

  if (options.timezone) {
    attributes.timezone = options.timezone;
  }

  return {
    data: {
      type: "metric-aggregate",
      attributes,
    },
  };
}

const cache = new PluginCache({
  namespace: "klaviyo-marketing-manager",
  defaultTTL: TTL.FIFTEEN_MINUTES,
});

export class KlaviyoClient {
  private apiKey: string;
  private timeout: number = DEFAULT_TIMEOUT;

  constructor(options?: { apiKey?: string }) {
    if (options?.apiKey) {
      this.apiKey = options.apiKey;
      return;
    }

    const raw = loadServiceConfig("klaviyo-marketing-manager");
    const normalized = normalizeLegacyMcpConfig(raw, {
      "klaviyo.apiKey": "PRIVATE_API_KEY",
    });
    const config = KlaviyoConfigSchema.parse(normalized);
    this.apiKey = config.klaviyo.apiKey;
  }


  disableCache(): void {
    cache.disable();
  }

  enableCache(): void {
    cache.enable();
  }

  getCacheStats() {
    return cache.getStats();
  }

  clearCache(): number {
    return cache.clear();
  }

  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }

  setTimeout(ms: number): void {
    this.timeout = ms;
  }


  private async request<T>(
    method: string,
    endpoint: string,
    body?: JsonObject,
    customTimeout?: number
  ): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${this.apiKey}`,
      revision: API_REVISION,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    };

    const effectiveTimeout = customTimeout || this.timeout;

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetchWithRetry(
        url,
        options,
        { maxRetries: 3, timeoutMs: effectiveTimeout },
        "Klaviyo.request"
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Klaviyo API error (${response.status}): ${errorText}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof Error && /(timed out|timeout|abort)/i.test(error.message)) {
        throw new Error(`Klaviyo API request timed out after ${effectiveTimeout / 1000}s`);
      }
      throw error;
    }
  }

  private buildChannelFilter(channel: "email" | "sms" | "mobile_push"): string {
    return `equals(messages.channel,'${channel}')`;
  }


  async getCampaigns(options?: CampaignListOptions): Promise<ListResponse<Campaign>> {
    const channel = options?.channel || "email";
    const cacheKey = buildCampaignsCacheKey(options);

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        const clauses = [this.buildChannelFilter(channel)];
        if (options?.filter) {
          clauses.push(options.filter);
        }
        if (options?.updatedSince) {
          const since = toFilterDatetime(options.updatedSince);
          clauses.push(`greater-or-equal(updated_at,${since})`);
        }
        const filterStr = combineFilters(clauses);
        if (filterStr) {
          params.set("filter", filterStr);
        }

        if (options?.pageSize) {
          params.set("page[size]", options.pageSize.toString());
        }
        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        params.set("fields[campaign]", CAMPAIGN_FIELDS);

        return this.request<ListResponse<Campaign>>(
          "GET",
          `/campaigns?${params.toString()}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getCampaign(campaignId: string): Promise<SingleResponse<Campaign>> {
    const cacheKey = createCacheKey("campaign", { id: campaignId });

    return cache.getOrFetch(
      cacheKey,
      () =>
        this.request<SingleResponse<Campaign>>("GET", `/campaigns/${campaignId}`),
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getCampaignMessages(campaignId: string): Promise<ListResponse<CampaignMessage>> {
    const cacheKey = createCacheKey("campaign_messages", {
      revision: API_REVISION,
      campaignId,
    });

    return cache.getOrFetch(
      cacheKey,
      () =>
        this.request<ListResponse<CampaignMessage>>(
          "GET",
          `/campaigns/${campaignId}/campaign-messages`,
        ),
      { ttl: TTL.FIFTEEN_MINUTES },
    );
  }

  async getCampaignReport(options: {
    conversionMetricId: string;
    campaignIds?: string[];
    timeframe?: { key: string } | { start: string; end: string };
    statistics?: string[];
  }): Promise<unknown> {
    const cacheKey = createCacheKey("campaign_report", {
      campaignIds: options?.campaignIds?.join(","),
      timeframe: JSON.stringify(options?.timeframe),
      statistics: options?.statistics?.join(","),
      conversionMetricId: options.conversionMetricId,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const defaultStats = [
          "recipients",
          "delivered",
          "delivery_rate",
          "opens",
          "opens_unique",
          "open_rate",
          "clicks",
          "clicks_unique",
          "click_rate",
          "bounced",
          "bounce_rate",
          "unsubscribes",
          "unsubscribe_rate",
          "conversions",
          "conversion_value",
          "revenue_per_recipient",
        ];

        const statistics = options?.statistics || defaultStats;

        const body: ReportRequestBody = {
          data: {
            type: "campaign-values-report",
            attributes: {
              statistics,
              conversion_metric_id: options.conversionMetricId,
            },
          },
        };

        if (options?.timeframe) {
          body.data.attributes.timeframe = options.timeframe;
        }

        if (options?.campaignIds && options.campaignIds.length > 0) {
          body.data.attributes.filter = `any(campaign_id,[${options.campaignIds
            .map((id) => `"${id}"`)
            .join(",")}])`;
        }

        return this.request<unknown>(
          "POST",
          "/campaign-values-reports",
          body,
          60000
        );
      },
      { ttl: TTL.FIVE_MINUTES }
    );
  }

  async findPlacedOrderMetricId(): Promise<string | null> {
    const metrics = await this.getMetrics();
    const placedOrder = metrics.data.find(
      (m: Metric) =>
        m.attributes.name.toLowerCase().includes("placed order") ||
        m.attributes.name.toLowerCase().includes("order placed")
    );
    return placedOrder?.id || null;
  }


  async getFlows(options?: FlowListOptions): Promise<ListResponse<Flow>> {
    const cacheKey = buildFlowsCacheKey(options);

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        const clauses: string[] = [];
        if (options?.filter) {
          clauses.push(options.filter);
        }
        if (options?.updatedSince) {
          const since = toFilterDatetime(options.updatedSince);
          clauses.push(`greater-or-equal(updated,${since})`);
          params.set("sort", "updated");
        }
        const filterStr = combineFilters(clauses);
        if (filterStr) {
          params.set("filter", filterStr);
        }
        if (options?.pageSize) {
          params.set("page[size]", options.pageSize.toString());
        }
        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        params.set(
          "fields[flow]",
          "name,status,archived,trigger_type,created,updated"
        );

        const queryString = params.toString();
        return this.request<ListResponse<Flow>>(
          "GET",
          `/flows${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getFlow(flowId: string): Promise<SingleResponse<Flow>> {
    const cacheKey = createCacheKey("flow", {
      id: flowId,
      revision: API_REVISION,
      additionalFields: "definition",
    });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<Flow>>(
        "GET",
        `/flows/${flowId}?additional-fields[flow]=definition`,
      ),
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getFlowActions(
    flowId: string,
    options?: { cursor?: string }
  ): Promise<ListResponse<FlowAction>> {
    const cacheKey = createCacheKey("flow_actions", {
      flowId,
      cursor: options?.cursor,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        params.set("fields[flow-action]", "definition");

        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        params.set("page[size]", "50");

        const queryString = params.toString();
        return this.request<ListResponse<FlowAction>>(
          "GET",
          `/flows/${flowId}/flow-actions${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getAllFlowActions(flowId: string): Promise<FlowAction[]> {
    const allActions: FlowAction[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined = undefined;

    do {
      const response = await this.getFlowActions(flowId, { cursor });
      allActions.push(...response.data);

      const nextCursor = cursorFromNextLink(response.links?.next);
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(`Klaviyo flow actions pagination repeated cursor "${nextCursor}"`);
      }
      if (nextCursor) seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    return allActions;
  }

  async getFlowMessages(actionId: string): Promise<ListResponse<FlowMessage>> {
    const cacheKey = createCacheKey("flow_messages", { actionId });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();
        params.set("fields[flow-message]", "channel,definition");

        const queryString = params.toString();
        return this.request<ListResponse<FlowMessage>>(
          "GET",
          `/flow-actions/${actionId}/flow-messages${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getFlowMessageTemplate(
    flowMessageId: string
  ): Promise<FlowMessageTemplateResponse> {
    const cacheKey = createCacheKey("flow_message_template", {
      flowMessageId,
      revision: API_REVISION,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        try {
          const template = await this.request<SingleResponse<Template>>(
            "GET",
            `/flow-messages/${flowMessageId}/template`
          );
          const message = await this.request<SingleResponse<FlowMessage>>(
            "GET",
            `/flow-messages/${flowMessageId}?fields[flow-message]=channel,definition`
          );
          return {
            data: message.data,
            included: template.data ? [template.data] : [],
          };
        } catch {
          return this.request<FlowMessageTemplateResponse>(
            "GET",
            `/flow-messages/${flowMessageId}?include=template&fields[flow-message]=channel,definition`
          );
        }
      },
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getSendEmailMessages(
    actionIds: string[],
    options?: { pacingMs?: number; sleepImpl?: (ms: number) => Promise<void> }
  ): Promise<Array<{ actionId: string; messages: FlowMessage[]; error?: string }>> {
    const pacingMs = options?.pacingMs ?? 400;
    const sleepFn = options?.sleepImpl ?? sleep;

    const results: Array<{ actionId: string; messages: FlowMessage[]; error?: string }> = [];

    for (let index = 0; index < actionIds.length; index++) {
      const actionId = actionIds[index];

      const isFirst = index === 0;
      if (!isFirst && pacingMs > 0) {
        await sleepFn(pacingMs);
      }

      try {
        const response = await this.getFlowMessages(actionId);
        results.push({ actionId, messages: response.data ?? [] });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ actionId, messages: [], error: message });
      }
    }

    return results;
  }

  async getFlowReport(options: {
    conversionMetricId: string;
    flowIds?: string[];
    timeframe?: { key: string } | { start: string; end: string };
  }): Promise<unknown> {
    const cacheKey = createCacheKey("flow_report", {
      flowIds: options.flowIds?.join(","),
      timeframe: JSON.stringify(options.timeframe),
      conversionMetricId: options.conversionMetricId,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const body: ReportRequestBody = {
          data: {
            type: "flow-values-report",
            attributes: {
              conversion_metric_id: options.conversionMetricId,
              statistics: [
                "recipients",
                "delivered",
                "opens",
                "opens_unique",
                "clicks",
                "clicks_unique",
                "open_rate",
                "click_rate",
              ],
            },
          },
        };

        if (options.timeframe) {
          body.data.attributes.timeframe = options.timeframe;
        }

        if (options.flowIds && options.flowIds.length > 0) {
          body.data.attributes.filter = `any(flow_id,[${options.flowIds
            .map((id) => `"${id}"`)
            .join(",")}])`;
        }

        return this.request<unknown>(
          "POST",
          "/flow-values-reports",
          body,
          60000
        );
      },
      { ttl: TTL.FIVE_MINUTES }
    );
  }


  async getSegments(options?: {
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Segment>> {
    const cacheKey = createCacheKey("segments", { pageSize: options?.pageSize, cursor: options?.cursor });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        if (options?.pageSize) {
          params.set("page[size]", options.pageSize.toString());
        }
        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        params.set("fields[segment]", "name,definition,created,updated");

        const queryString = params.toString();
        return this.request<ListResponse<Segment>>(
          "GET",
          `/segments${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.HOUR }
    );
  }

  async getSegment(segmentId: string): Promise<SingleResponse<Segment>> {
    const cacheKey = createCacheKey("segment", { id: segmentId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<Segment>>("GET", `/segments/${segmentId}`),
      { ttl: TTL.HOUR }
    );
  }


  async getLists(options?: {
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<List>> {
    const cacheKey = createCacheKey("lists", { pageSize: options?.pageSize, cursor: options?.cursor });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        if (options?.pageSize) {
          params.set("page[size]", options.pageSize.toString());
        }
        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        params.set("fields[list]", "name,created,updated");

        const queryString = params.toString();
        return this.request<ListResponse<List>>(
          "GET",
          `/lists${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.HOUR }
    );
  }

  async getList(listId: string): Promise<SingleResponse<List>> {
    const cacheKey = createCacheKey("list", { id: listId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<List>>("GET", `/lists/${listId}`),
      { ttl: TTL.HOUR }
    );
  }


  async getProfiles(options?: {
    filter?: string;
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Profile>> {
    const cacheKey = createCacheKey("profiles", {
      filter: options?.filter,
      pageSize: options?.pageSize,
      cursor: options?.cursor,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        if (options?.filter) {
          params.set("filter", options.filter);
        }
        if (options?.pageSize) {
          params.set("page[size]", options.pageSize.toString());
        }
        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        params.set(
          "fields[profile]",
          "email,first_name,last_name,phone_number,created,updated"
        );

        const queryString = params.toString();
        return this.request<ListResponse<Profile>>(
          "GET",
          `/profiles${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getProfile(profileId: string): Promise<SingleResponse<Profile>> {
    const cacheKey = createCacheKey("profile", { id: profileId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<Profile>>("GET", `/profiles/${profileId}`),
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }


  async getMetrics(options?: {
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Metric>> {
    const cacheKey = createCacheKey("metrics", { pageSize: options?.pageSize, cursor: options?.cursor });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        if (options?.pageSize) {
          params.set("page[size]", options.pageSize.toString());
        }
        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        params.set("fields[metric]", "name,created,updated");

        const queryString = params.toString();
        return this.request<ListResponse<Metric>>(
          "GET",
          `/metrics${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.HOUR }
    );
  }

  async getMetric(metricId: string): Promise<SingleResponse<Metric>> {
    const cacheKey = createCacheKey("metric", { id: metricId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<Metric>>("GET", `/metrics/${metricId}`),
      { ttl: TTL.HOUR }
    );
  }

  async resolveMetricIdByName(metricName: string): Promise<string> {
    const target = metricName.trim().toLowerCase();
    const matches: Metric[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined = undefined;

    do {
      const response = await this.getMetrics({ cursor });
      for (const metric of response.data ?? []) {
        if (metric.attributes?.name?.trim().toLowerCase() === target) {
          matches.push(metric);
        }
      }

      const nextCursor = cursorFromNextLink(response.links?.next);
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(`Klaviyo metrics pagination repeated cursor "${nextCursor}"`);
      }
      if (nextCursor) seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    if (matches.length === 0) {
      throw new Error(`No Klaviyo metric found named "${metricName}". Use get-metrics to find the metric ID.`);
    }
    if (matches.length > 1) {
      const ids = matches.map((metric) => metric.id).join(", ");
      throw new Error(`Multiple Klaviyo metrics matched "${metricName}" case-insensitively: ${ids}. Pass --metric-id instead.`);
    }

    return matches[0].id;
  }

  async getMetricEventVolume(options: {
    metricId: string;
    start: string;
    end: string;
    interval: MetricAggregateInterval;
    timezone?: string;
  }): Promise<unknown> {
    const cacheKey = createCacheKey("metric_event_volume", {
      metricId: options.metricId,
      start: options.start,
      end: options.end,
      interval: options.interval,
      timezone: options.timezone,
    });

    return cache.getOrFetch(
      cacheKey,
      () =>
        this.request<unknown>(
          "POST",
          "/metric-aggregates",
          buildMetricAggregateBody(options),
          60000,
        ),
      { ttl: TTL.FIVE_MINUTES },
    );
  }


  async getForms(options?: {
    filter?: string;
    pageSize?: number;
    cursor?: string;
    sort?: "created_at" | "-created_at" | "updated_at" | "-updated_at";
  }): Promise<ListResponse<Form>> {
    const cacheKey = createCacheKey("forms", {
      filter: options?.filter,
      cursor: options?.cursor,
      pageSize: options?.pageSize,
      sort: options?.sort,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();
        params.set("fields[form]", "name,status,ab_test,created_at,updated_at");
        if (options?.filter) params.set("filter", options.filter);
        if (options?.pageSize) params.set("page[size]", options.pageSize.toString());
        if (options?.cursor) params.set("page[cursor]", options.cursor);
        if (options?.sort) params.set("sort", options.sort);

        return this.request<ListResponse<Form>>("GET", `/forms?${params.toString()}`);
      },
      { ttl: TTL.FIFTEEN_MINUTES },
    );
  }

  async getForm(formId: string): Promise<SingleResponse<Form>> {
    const cacheKey = createCacheKey("form", { id: formId, fields: "metadata" });
    return cache.getOrFetch(
      cacheKey,
      () =>
        this.request<SingleResponse<Form>>(
          "GET",
          `/forms/${formId}?fields[form]=name,status,ab_test,created_at,updated_at`,
        ),
      { ttl: TTL.FIFTEEN_MINUTES },
    );
  }

  async getFormVersions(formId: string, options?: {
    filter?: string;
    pageSize?: number;
    cursor?: string;
    sort?: "created_at" | "-created_at" | "updated_at" | "-updated_at";
  }): Promise<ListResponse<FormVersion>> {
    const cacheKey = createCacheKey("form_versions", {
      formId,
      filter: options?.filter,
      cursor: options?.cursor,
      pageSize: options?.pageSize,
      sort: options?.sort,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();
        params.set("fields[form-version]", "form_type,ab_test,ab_test.variation_name,status,created_at,updated_at");
        if (options?.filter) params.set("filter", options.filter);
        if (options?.pageSize) params.set("page[size]", options.pageSize.toString());
        if (options?.cursor) params.set("page[cursor]", options.cursor);
        if (options?.sort) params.set("sort", options.sort);

        return this.request<ListResponse<FormVersion>>(
          "GET",
          `/forms/${formId}/form-versions?${params.toString()}`,
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES },
    );
  }

  async getFormVersion(versionId: string): Promise<SingleResponse<FormVersion>> {
    const cacheKey = createCacheKey("form_version", {
      id: versionId,
      fields: "metadata",
    });

    return cache.getOrFetch(
      cacheKey,
      () =>
        this.request<SingleResponse<FormVersion>>(
          "GET",
          `/form-versions/${versionId}?fields[form-version]=form_type,ab_test,ab_test.variation_name,status,created_at,updated_at`,
        ),
      { ttl: TTL.FIFTEEN_MINUTES },
    );
  }


  async getTemplates(options?: {
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Template>> {
    const pageSize = options?.pageSize ?? 10;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10) {
      throw new Error("Klaviyo templates page size must be an integer from 1 to 10");
    }
    const cacheKey = createCacheKey("templates", {
      revision: API_REVISION,
      pageSize,
      cursor: options?.cursor,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();
        params.set("page[size]", pageSize.toString());
        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        return this.request<ListResponse<Template>>(
          "GET",
          `/templates?${params.toString()}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }

  async getAllTemplates(options?: {
    pageSize?: number;
    cursor?: string;
  }): Promise<AllTemplatesResponse> {
    const templates: Template[] = [];
    const seenCursors = new Set<string>();
    let cursor = options?.cursor;
    let pagesFetched = 0;

    if (cursor) seenCursors.add(cursor);

    do {
      const response = await this.getTemplates({
        pageSize: options?.pageSize,
        cursor,
      });
      pagesFetched += 1;
      templates.push(...(response.data ?? []));

      const nextCursor = cursorFromNextLink(response.links?.next);
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(
          `Klaviyo templates pagination repeated cursor "${nextCursor}"`
        );
      }
      if (nextCursor) seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    return { data: templates, pagesFetched };
  }

  async getTemplate(templateId: string): Promise<SingleResponse<Template>> {
    const cacheKey = createCacheKey("template", {
      id: templateId,
      revision: API_REVISION,
    });

    return cache.getOrFetch(
      cacheKey,
      () =>
        this.request<SingleResponse<Template>>(
          "GET",
          `/templates/${templateId}`
        ),
      { ttl: TTL.FIFTEEN_MINUTES }
    );
  }


  async getAccount(): Promise<ListResponse<Account>> {
    return cache.getOrFetch(
      "account",
      () => this.request<ListResponse<Account>>("GET", "/accounts"),
      { ttl: TTL.HOUR }
    );
  }


}

export default KlaviyoClient;
