/**
 * Klaviyo API Client
 *
 * Direct client for the Klaviyo REST API v2024-10-15 using Private API Key authentication.
 * Handles email marketing campaigns, flows, segments, lists, and profiles.
 * Configuration from config.json with API key.
 *
 * Key features:
 * - Campaign management and performance reports
 * - Automation flow tracking
 * - Segment and list management
 * - Profile lookup and filtering
 * - Metric tracking for conversion attribution
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Klaviyo API revision version
const API_REVISION = "2024-10-15";
const BASE_URL = "https://a.klaviyo.com/api";
const DEFAULT_TIMEOUT = 30000; // 30 seconds

interface KlaviyoConfig {
  apiKey: string;
}

interface ConfigFile {
  klaviyo?: KlaviyoConfig;
  // Support legacy MCP config format for migration
  mcpServer?: {
    env?: {
      PRIVATE_API_KEY?: string;
    };
  };
}

interface Campaign {
  id: string;
  type: string;
  attributes: {
    name: string;
    status: string;
    archived: boolean;
    audiences?: any;
    send_options?: any;
    created_at?: string;
    updated_at?: string;
    scheduled_at?: string;
    send_time?: string;
  };
  relationships?: any;
}

interface Flow {
  id: string;
  type: string;
  attributes: {
    name: string;
    status: string;
    archived: boolean;
    trigger_type?: string;
    created?: string;
    updated?: string;
  };
}

interface FlowAction {
  id: string;
  type: string;
  attributes: {
    action_type: string;
    status: string;
    created?: string;
    updated?: string;
    settings?: {
      delay_seconds?: number;
      [key: string]: any;
    };
    tracking_options?: any;
    send_options?: any;
    render_options?: any;
  };
  relationships?: {
    flow?: { data: { id: string; type: string } };
    "flow-messages"?: { data: Array<{ id: string; type: string }> };
  };
}

interface Segment {
  id: string;
  type: string;
  attributes: {
    name: string;
    definition?: any;
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

interface Account {
  id: string;
  type: string;
  attributes: {
    test_account: boolean;
    contact_information?: any;
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

// Initialize cache with namespace
const cache = new PluginCache({
  namespace: "klaviyo-marketing-manager",
  defaultTTL: TTL.FIFTEEN_MINUTES,
});

export class KlaviyoClient {
  private apiKey: string;
  private cacheDisabled: boolean = false;
  private timeout: number = DEFAULT_TIMEOUT;

  constructor() {
    // Try multiple locations for config.json:
    // 1. Same directory (when running tsx directly from scripts/)
    // 2. Parent directory (when running compiled from dist/)
    const possiblePaths = [
      join(__dirname, "config.json"),
      join(__dirname, "..", "config.json"),
    ];

    let configFile: ConfigFile | null = null;
    for (const path of possiblePaths) {
      try {
        configFile = JSON.parse(readFileSync(path, "utf-8"));
        break;
      } catch {
        continue;
      }
    }

    if (!configFile) {
      throw new Error(`Config file not found. Tried: ${possiblePaths.join(", ")}`);
    }

    // Support both new direct format and legacy MCP format
    if (configFile.klaviyo?.apiKey) {
      this.apiKey = configFile.klaviyo.apiKey;
    } else if (configFile.mcpServer?.env?.PRIVATE_API_KEY) {
      // Legacy MCP config - extract API key from env
      this.apiKey = configFile.mcpServer.env.PRIVATE_API_KEY;
    } else {
      throw new Error(
        "Missing required config: klaviyo.apiKey or mcpServer.env.PRIVATE_API_KEY"
      );
    }
  }

  // ============================================
  // CACHE CONTROL
  // ============================================

  /**
   * Disables caching for all subsequent requests.
   * Useful for debugging or when fresh data is required.
   */
  disableCache(): void {
    this.cacheDisabled = true;
    cache.disable();
  }

  /**
   * Re-enables caching after it was disabled.
   */
  enableCache(): void {
    this.cacheDisabled = false;
    cache.enable();
  }

  /**
   * Returns cache statistics including hit/miss counts.
   * @returns Cache stats object with hits, misses, and entry count
   */
  getCacheStats() {
    return cache.getStats();
  }

  /**
   * Clears all cached data.
   * @returns Number of cache entries cleared
   */
  clearCache(): number {
    return cache.clear();
  }

  /**
   * Invalidates a specific cache entry by key.
   * @param key - The cache key to invalidate
   * @returns true if entry was found and removed, false otherwise
   */
  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }

  /**
   * Sets the request timeout.
   * @param ms - Timeout in milliseconds
   */
  setTimeout(ms: number): void {
    this.timeout = ms;
  }

  // ============================================
  // HTTP LAYER
  // ============================================

  /**
   * Makes an HTTP request to the Klaviyo API.
   *
   * @param method - HTTP method (GET, POST)
   * @param endpoint - API endpoint path
   * @param body - Request body for POST
   * @param customTimeout - Override default timeout
   * @returns Parsed JSON response
   * @throws {Error} If API returns non-2xx status
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, any>,
    customTimeout?: number
  ): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${this.apiKey}`,
      revision: API_REVISION,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      customTimeout || this.timeout
    );

    try {
      const options: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Klaviyo API error (${response.status}): ${errorText}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Builds a Klaviyo filter string for message channel.
   * @param channel - Channel type: "email", "sms", or "mobile_push"
   * @returns Klaviyo filter string
   */
  private buildChannelFilter(channel: "email" | "sms" | "mobile_push"): string {
    return `equals(messages.channel,'${channel}')`;
  }

  // ============================================
  // CAMPAIGN OPERATIONS
  // ============================================

  /**
   * Lists marketing campaigns with optional filtering.
   *
   * @param options - Filter options
   * @param options.channel - Channel type: "email" (default), "sms", or "mobile_push"
   * @param options.filter - Additional Klaviyo filter expression
   * @param options.pageSize - Results per page
   * @param options.cursor - Pagination cursor
   * @returns Paginated list of campaigns
   *
   * @cached TTL: 15 minutes
   *
   * @example
   * // Get email campaigns
   * const { data: campaigns } = await client.getCampaigns();
   *
   * @example
   * // Get SMS campaigns
   * const { data: smsCampaigns } = await client.getCampaigns({ channel: "sms" });
   */
  async getCampaigns(options?: {
    channel?: "email" | "sms" | "mobile_push";
    filter?: string;
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Campaign>> {
    const channel = options?.channel || "email";
    const cacheKey = createCacheKey("campaigns", {
      channel,
      filter: options?.filter,
      cursor: options?.cursor,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        // Channel filter is required
        let filterStr = this.buildChannelFilter(channel);
        if (options?.filter) {
          filterStr = `and(${filterStr},${options.filter})`;
        }
        params.set("filter", filterStr);

        if (options?.pageSize) {
          params.set("page[size]", options.pageSize.toString());
        }
        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        // Request common fields
        params.set(
          "fields[campaign]",
          "name,status,archived,audiences,send_options,created_at,updated_at,scheduled_at,send_time"
        );

        return this.request<ListResponse<Campaign>>(
          "GET",
          `/campaigns?${params.toString()}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets a single campaign by ID.
   *
   * @param campaignId - Klaviyo campaign ID
   * @returns Campaign object with details
   *
   * @cached TTL: 15 minutes
   */
  async getCampaign(campaignId: string): Promise<SingleResponse<Campaign>> {
    const cacheKey = createCacheKey("campaign", { id: campaignId });

    return cache.getOrFetch(
      cacheKey,
      () =>
        this.request<SingleResponse<Campaign>>("GET", `/campaigns/${campaignId}`),
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets campaign performance report with metrics.
   *
   * Retrieves detailed performance statistics including opens, clicks,
   * bounces, unsubscribes, and conversion metrics.
   *
   * @param options - Report options
   * @param options.conversionMetricId - Metric ID for conversion tracking (required)
   * @param options.campaignIds - Filter to specific campaigns
   * @param options.timeframe - Time range: { key: "last_30_days" } or { start: "2025-01-01", end: "2025-01-31" }
   * @param options.statistics - Specific metrics to include (defaults to common metrics)
   * @returns Campaign performance report with statistics
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * // Get report for all campaigns
   * const metricId = await client.findPlacedOrderMetricId();
   * const report = await client.getCampaignReport({
   *   conversionMetricId: metricId,
   *   timeframe: { key: "last_30_days" }
   * });
   */
  async getCampaignReport(options: {
    conversionMetricId: string;
    campaignIds?: string[];
    timeframe?: { key: string } | { start: string; end: string };
    statistics?: string[];
  }): Promise<any> {
    const cacheKey = createCacheKey("campaign_report", {
      campaignIds: options?.campaignIds?.join(","),
      timeframe: JSON.stringify(options?.timeframe),
      statistics: options?.statistics?.join(","),
      conversionMetricId: options.conversionMetricId,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        // Default statistics for campaign reports
        // Valid values: recipients, delivered, delivery_rate, opens, opens_unique,
        // open_rate, clicks, clicks_unique, click_rate, click_to_open_rate,
        // bounced, bounce_rate, bounced_or_failed, bounced_or_failed_rate,
        // failed, failed_rate, spam_complaints, spam_complaint_rate,
        // unsubscribes, unsubscribe_uniques, unsubscribe_rate,
        // conversions, conversion_uniques, conversion_rate, conversion_value,
        // average_order_value, revenue_per_recipient
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

        // Build the request body for campaign values report
        const body: Record<string, any> = {
          data: {
            type: "campaign-values-report",
            attributes: {
              statistics,
              conversion_metric_id: options.conversionMetricId,
            },
          },
        };

        // Add timeframe if provided (object, not string)
        if (options?.timeframe) {
          body.data.attributes.timeframe = options.timeframe;
        }

        // Filter by campaign IDs if provided
        if (options?.campaignIds && options.campaignIds.length > 0) {
          body.data.attributes.filter = `any(campaign_id,[${options.campaignIds
            .map((id) => `"${id}"`)
            .join(",")}])`;
        }

        return this.request<any>(
          "POST",
          "/campaign-values-reports",
          body,
          60000 // 60s timeout for reports
        );
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Finds the "Placed Order" metric ID for conversion tracking.
   *
   * Searches metrics for common order placement names.
   * Used as the conversionMetricId parameter in campaign reports.
   *
   * @returns Metric ID if found, null otherwise
   *
   * @example
   * const metricId = await client.findPlacedOrderMetricId();
   * if (metricId) {
   *   const report = await client.getCampaignReport({ conversionMetricId: metricId });
   * }
   */
  async findPlacedOrderMetricId(): Promise<string | null> {
    const metrics = await this.getMetrics();
    const placedOrder = metrics.data.find(
      (m: Metric) =>
        m.attributes.name.toLowerCase().includes("placed order") ||
        m.attributes.name.toLowerCase().includes("order placed")
    );
    return placedOrder?.id || null;
  }

  // ============================================
  // FLOW OPERATIONS
  // ============================================

  /**
   * Lists automation flows with optional filtering.
   *
   * @param options - Filter options
   * @param options.filter - Klaviyo filter expression
   * @param options.pageSize - Results per page
   * @param options.cursor - Pagination cursor
   * @returns Paginated list of flows
   *
   * @cached TTL: 15 minutes
   *
   * @example
   * const { data: flows } = await client.getFlows();
   * const activeFlows = flows.filter(f => f.attributes.status === "live");
   */
  async getFlows(options?: {
    filter?: string;
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Flow>> {
    const cacheKey = createCacheKey("flows", {
      filter: options?.filter,
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
          "fields[flow]",
          "name,status,archived,trigger_type,created,updated"
        );

        const queryString = params.toString();
        return this.request<ListResponse<Flow>>(
          "GET",
          `/flows${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets a single flow by ID.
   *
   * @param flowId - Klaviyo flow ID
   * @returns Flow object with details
   *
   * @cached TTL: 15 minutes
   */
  async getFlow(flowId: string): Promise<SingleResponse<Flow>> {
    const cacheKey = createCacheKey("flow", { id: flowId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<Flow>>("GET", `/flows/${flowId}`),
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets all actions (steps) for a flow.
   *
   * Flow actions describe the sequence of steps in an automation flow,
   * including triggers, conditions, delays, and message sends.
   *
   * @param flowId - Klaviyo flow ID
   * @param options - Pagination options
   * @param options.cursor - Pagination cursor for next page
   * @returns Paginated list of flow actions
   *
   * @cached TTL: 15 minutes
   *
   * @example
   * const { data: actions } = await client.getFlowActions("FLOW_ID");
   * for (const action of actions) {
   *   console.log(action.attributes.action_type, action.attributes.settings?.delay_seconds);
   * }
   */
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

        // Request common fields for flow actions
        params.set(
          "fields[flow-action]",
          "action_type,status,created,updated,settings,tracking_options,send_options,render_options"
        );

        if (options?.cursor) {
          params.set("page[cursor]", options.cursor);
        }

        // Max 50 per page per API docs
        params.set("page[size]", "50");

        const queryString = params.toString();
        return this.request<ListResponse<FlowAction>>(
          "GET",
          `/flows/${flowId}/flow-actions${queryString ? `?${queryString}` : ""}`
        );
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets all actions for a flow with automatic pagination.
   *
   * Fetches all pages of flow actions for a given flow.
   * Use with caution on flows with many actions.
   *
   * @param flowId - Klaviyo flow ID
   * @returns All flow actions
   *
   * @example
   * const actions = await client.getAllFlowActions("FLOW_ID");
   * console.log(`Flow has ${actions.length} actions`);
   */
  async getAllFlowActions(flowId: string): Promise<FlowAction[]> {
    const allActions: FlowAction[] = [];
    let cursor: string | undefined = undefined;

    do {
      const response = await this.getFlowActions(flowId, { cursor });
      allActions.push(...response.data);

      // Extract cursor from next link if present
      if (response.links?.next) {
        const url = new URL(response.links.next);
        cursor = url.searchParams.get("page[cursor]") || undefined;
      } else {
        cursor = undefined;
      }
    } while (cursor);

    return allActions;
  }

  /**
   * Gets flow performance report.
   *
   * Retrieves engagement statistics for automation flows.
   *
   * @param options - Report options
   * @param options.flowIds - Filter to specific flows
   * @param options.timeframe - Time range: { key: "last_30_days" } or { start, end }
   * @returns Flow performance report with statistics
   *
   * @cached TTL: 5 minutes
   */
  async getFlowReport(options?: {
    flowIds?: string[];
    timeframe?: { key: string } | { start: string; end: string };
  }): Promise<any> {
    const cacheKey = createCacheKey("flow_report", {
      flowIds: options?.flowIds?.join(","),
      timeframe: JSON.stringify(options?.timeframe),
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const body: Record<string, any> = {
          data: {
            type: "flow-values-report",
            attributes: {
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

        if (options?.timeframe) {
          body.data.attributes.timeframe = options.timeframe;
        }

        if (options?.flowIds && options.flowIds.length > 0) {
          body.data.attributes.filter = `any(flow_id,[${options.flowIds
            .map((id) => `"${id}"`)
            .join(",")}])`;
        }

        return this.request<any>(
          "POST",
          "/flow-values-reports",
          body,
          60000 // 60s timeout for reports
        );
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // SEGMENT OPERATIONS
  // ============================================

  /**
   * Lists audience segments.
   *
   * @param options - Pagination options
   * @param options.pageSize - Results per page
   * @param options.cursor - Pagination cursor
   * @returns Paginated list of segments
   *
   * @cached TTL: 1 hour
   */
  async getSegments(options?: {
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Segment>> {
    const cacheKey = createCacheKey("segments", { cursor: options?.cursor });

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
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets a single segment by ID.
   *
   * @param segmentId - Klaviyo segment ID
   * @returns Segment object with definition
   *
   * @cached TTL: 1 hour
   */
  async getSegment(segmentId: string): Promise<SingleResponse<Segment>> {
    const cacheKey = createCacheKey("segment", { id: segmentId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<Segment>>("GET", `/segments/${segmentId}`),
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // LIST OPERATIONS
  // ============================================

  /**
   * Lists subscriber lists.
   *
   * @param options - Pagination options
   * @param options.pageSize - Results per page
   * @param options.cursor - Pagination cursor
   * @returns Paginated list of subscriber lists
   *
   * @cached TTL: 1 hour
   */
  async getLists(options?: {
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<List>> {
    const cacheKey = createCacheKey("lists", { cursor: options?.cursor });

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
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets a single list by ID.
   *
   * @param listId - Klaviyo list ID
   * @returns List object with details
   *
   * @cached TTL: 1 hour
   */
  async getList(listId: string): Promise<SingleResponse<List>> {
    const cacheKey = createCacheKey("list", { id: listId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<List>>("GET", `/lists/${listId}`),
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // PROFILE OPERATIONS
  // ============================================

  /**
   * Lists profiles (customers/subscribers) with optional filtering.
   *
   * @param options - Filter options
   * @param options.filter - Klaviyo filter expression (e.g., "equals(email,'test@example.com')")
   * @param options.pageSize - Results per page
   * @param options.cursor - Pagination cursor
   * @returns Paginated list of profiles
   *
   * @cached TTL: 15 minutes
   *
   * @example
   * // Search by email
   * const { data: profiles } = await client.getProfiles({
   *   filter: "equals(email,'john@example.com')"
   * });
   */
  async getProfiles(options?: {
    filter?: string;
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Profile>> {
    const cacheKey = createCacheKey("profiles", {
      filter: options?.filter,
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
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets a single profile by ID.
   *
   * @param profileId - Klaviyo profile ID
   * @returns Profile object with contact details
   *
   * @cached TTL: 15 minutes
   */
  async getProfile(profileId: string): Promise<SingleResponse<Profile>> {
    const cacheKey = createCacheKey("profile", { id: profileId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<Profile>>("GET", `/profiles/${profileId}`),
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // METRIC OPERATIONS
  // ============================================

  /**
   * Lists tracked metrics.
   *
   * Metrics track events like "Placed Order", "Opened Email", etc.
   *
   * @param options - Pagination options
   * @param options.pageSize - Results per page
   * @param options.cursor - Pagination cursor
   * @returns Paginated list of metrics
   *
   * @cached TTL: 1 hour
   *
   * @example
   * const { data: metrics } = await client.getMetrics();
   * for (const metric of metrics) {
   *   console.log(metric.attributes.name);
   * }
   */
  async getMetrics(options?: {
    pageSize?: number;
    cursor?: string;
  }): Promise<ListResponse<Metric>> {
    const cacheKey = createCacheKey("metrics", { cursor: options?.cursor });

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
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets a single metric by ID.
   *
   * @param metricId - Klaviyo metric ID
   * @returns Metric object with details
   *
   * @cached TTL: 1 hour
   */
  async getMetric(metricId: string): Promise<SingleResponse<Metric>> {
    const cacheKey = createCacheKey("metric", { id: metricId });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<SingleResponse<Metric>>("GET", `/metrics/${metricId}`),
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // ACCOUNT OPERATIONS
  // ============================================

  /**
   * Gets account information.
   *
   * @returns Account object with timezone, currency, and API key info
   *
   * @cached TTL: 1 hour
   */
  async getAccount(): Promise<ListResponse<Account>> {
    return cache.getOrFetch(
      "account",
      () => this.request<ListResponse<Account>>("GET", "/accounts"),
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // UTILITY
  // ============================================

  /**
   * Returns list of available CLI commands for this client.
   * Used for CLI help text generation.
   *
   * @returns Array of tool definitions with name and description
   */
  getTools(): Array<{ name: string; description: string }> {
    return [
      { name: "get-campaigns", description: "List campaigns (email/SMS/push)" },
      { name: "get-campaign", description: "Get a specific campaign by ID" },
      { name: "get-campaign-report", description: "Get campaign performance metrics" },
      { name: "get-flows", description: "List automation flows" },
      { name: "get-flow", description: "Get a specific flow by ID" },
      { name: "get-flow-actions", description: "Get actions (steps) for a flow" },
      { name: "get-flow-report", description: "Get flow performance metrics" },
      { name: "get-segments", description: "List audience segments" },
      { name: "get-segment", description: "Get a specific segment by ID" },
      { name: "get-lists", description: "List subscriber lists" },
      { name: "get-list", description: "Get a specific list by ID" },
      { name: "get-profiles", description: "List profiles with optional filter" },
      { name: "get-profile", description: "Get a specific profile by ID" },
      { name: "get-metrics", description: "List tracked metrics" },
      { name: "get-metric", description: "Get a specific metric by ID" },
      { name: "get-account", description: "Get account details" },
      { name: "cache-stats", description: "Show cache statistics" },
      { name: "cache-clear", description: "Clear all cached data" },
      { name: "cache-invalidate", description: "Invalidate a specific cache key" },
    ];
  }
}

export default KlaviyoClient;
