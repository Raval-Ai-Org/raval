import "server-only";
export type GoogleTrendsInput = {
  keywords: string[];
  location?: string;
  language?: string;
  dateFrom?: string;
  dateTo?: string;
  timeRange?:
    | "past_hour"
    | "past_4_hours"
    | "past_day"
    | "past_7_days"
    | "past_30_days"
    | "past_90_days"
    | "past_12_months"
    | "past_5_years"
    | "2004_present";
};

export type InterestOverTimePoint = {
  timestamp: number;
  date: string;
  values: number[];
  averages?: number[];
  missingData?: boolean;
};

export type RelatedQuery = { query: string; value: string; kind: "top" | "rising" };
export type RelatedTopic = {
  topicId: string;
  topicTitle: string;
  topicType: string;
  value: string;
  kind: "top" | "rising";
};
export type RegionalInterest = {
  geoId: string;
  geoName: string;
  values: number[];
  maxValueIndex?: number;
};

export type GoogleTrendsData = {
  keywords: string[];
  interestOverTime: InterestOverTimePoint[];
  relatedQueries: RelatedQuery[];
  relatedTopics: RelatedTopic[];
  regionalInterest: RegionalInterest[];
};

export class DataForSeoError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    /** Transport-level failure (timeout, network, HTTP 429/5xx) worth retrying later. */
    public readonly transient = false,
  ) {
    super(message);
    this.name = "DataForSeoError";
  }
}

type DataForSeoItem = {
  type?: unknown;
  data?: unknown;
  averages?: unknown;
};

const GOOGLE_TRENDS_LIVE_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live";
const GOOGLE_TRENDS_TASK_POST_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_post";
const GOOGLE_TRENDS_TASK_GET_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_get/";
const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : [];
}

export function normalizeGoogleTrendsItems(items: unknown[], keywords: string[]): GoogleTrendsData {
  const data: GoogleTrendsData = {
    keywords,
    interestOverTime: [],
    relatedQueries: [],
    relatedTopics: [],
    regionalInterest: [],
  };

  for (const rawItem of items) {
    if (!isRecord(rawItem)) continue;
    const item = rawItem as DataForSeoItem;
    const type = stringValue(item.type);
    const itemData = isRecord(item.data) ? item.data : undefined;
    const itemRows = Array.isArray(item.data)
      ? item.data
      : itemData && Array.isArray(itemData.data)
        ? itemData.data
        : [];

    if (type === "google_trends_graph") {
      for (const rawRow of itemRows) {
        if (!isRecord(rawRow) || typeof rawRow.timestamp !== "number") continue;
        data.interestOverTime.push({
          timestamp: rawRow.timestamp,
          date: stringValue(rawRow.date) ?? "",
          values: numberArray(rawRow.values),
          averages: numberArray(rawRow.averages ?? item.averages),
          missingData: typeof rawRow.missing_data === "boolean" ? rawRow.missing_data : undefined,
        });
      }
    }

    if (type === "google_trends_map") {
      for (const rawRow of itemRows) {
        if (!isRecord(rawRow)) continue;
        const geoId = stringValue(rawRow.geo_id);
        const geoName = stringValue(rawRow.geo_name);
        if (!geoId || !geoName) continue;
        data.regionalInterest.push({
          geoId,
          geoName,
          values: numberArray(rawRow.values),
          maxValueIndex:
            typeof rawRow.max_value_index === "number" ? rawRow.max_value_index : undefined,
        });
      }
    }

    if (type === "google_trends_queries_list" && itemData) {
      for (const kind of ["top", "rising"] as const) {
        const rows = Array.isArray(itemData[kind]) ? itemData[kind] : [];
        for (const rawRow of rows) {
          if (!isRecord(rawRow)) continue;
          const query = stringValue(rawRow.query);
          const value = stringValue(rawRow.value);
          if (query && value) data.relatedQueries.push({ query, value, kind });
        }
      }
    }

    if (type === "google_trends_topics_list" && itemData) {
      for (const kind of ["top", "rising"] as const) {
        const rows = Array.isArray(itemData[kind]) ? itemData[kind] : [];
        for (const rawRow of rows) {
          if (!isRecord(rawRow)) continue;
          const topicId = stringValue(rawRow.topic_id);
          const topicTitle = stringValue(rawRow.topic_title);
          const topicType = stringValue(rawRow.topic_type);
          const value = stringValue(rawRow.value);
          if (topicId && topicTitle && topicType && value) {
            data.relatedTopics.push({ topicId, topicTitle, topicType, value, kind });
          }
        }
      }
    }
  }

  return data;
}

// DataForSEO reports errors inside a 200 body: a top-level status_code/message
// for account-level failures (auth, balance, rate limit), then one per task.
function assertEnvelopeOk(
  payload: unknown,
  context: string,
): asserts payload is {
  status_code: 20000;
  tasks: unknown[];
} {
  if (!isRecord(payload)) {
    throw new DataForSeoError(`DataForSEO returned an unreadable ${context} response`, 502);
  }
  if (payload.status_code !== 20000) {
    const code = typeof payload.status_code === "number" ? payload.status_code : undefined;
    const message = stringValue(payload.status_message) ?? "request rejected";
    throw new DataForSeoError(`DataForSEO ${context} failed: ${message}`, 502, code);
  }
  if (!Array.isArray(payload.tasks) || payload.tasks.length === 0) {
    throw new DataForSeoError(`DataForSEO returned no task in the ${context} response`, 502);
  }
}

/** True when a normalized collection carries any measured signal at all. */
export function hasTrendSignal(data: GoogleTrendsData): boolean {
  return (
    data.interestOverTime.some((point) => point.values.some((value) => value > 0)) ||
    data.regionalInterest.some((region) => region.values.some((value) => value > 0)) ||
    data.relatedQueries.length > 0 ||
    data.relatedTopics.length > 0
  );
}

function parseResultPayload(payload: unknown, keywords: string[]): GoogleTrendsData {
  if (!isRecord(payload) || payload.status_code !== 20000 || !Array.isArray(payload.tasks)) {
    throw new DataForSeoError("DataForSEO returned an unexpected response", 502);
  }
  const task = payload.tasks[0];
  if (!isRecord(task) || task.status_code !== 20000 || !Array.isArray(task.result)) {
    const taskMessage = isRecord(task) ? stringValue(task.status_message) : undefined;
    throw new DataForSeoError(taskMessage ?? "DataForSEO returned an error", 502);
  }
  const result = task.result[0];
  if (!isRecord(result) || !Array.isArray(result.items)) {
    throw new DataForSeoError("DataForSEO returned no Google Trends data", 502);
  }
  return normalizeGoogleTrendsItems(result.items, keywords);
}

function buildTask(input: GoogleTrendsInput) {
  const task: Record<string, unknown> = {
    keywords: input.keywords,
    item_types: [
      "google_trends_graph",
      "google_trends_map",
      ...(input.keywords.length === 1
        ? ["google_trends_topics_list", "google_trends_queries_list"]
        : []),
    ],
  };
  if (input.location) task.location_name = input.location;
  if (input.language) task.language_code = input.language;
  if (input.dateFrom) task.date_from = input.dateFrom;
  if (input.dateTo) task.date_to = input.dateTo;
  if (input.timeRange) task.time_range = input.timeRange;
  return task;
}

export type GoogleTrendsTask = {
  id: string;
  /** "completed" without `data` means the task finished with no search results. */
  status: "pending" | "completed" | "failed";
  statusCode: number;
  statusMessage?: string;
  data?: GoogleTrendsData;
};

function credentials(): { login: string; password: string } {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new DataForSeoError("DataForSEO is not configured", 503);
  return { login, password };
}

async function dataForSeoRequest(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const { login, password } = credentials();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = isRecord(payload) ? stringValue(payload.status_message) : undefined;
      throw new DataForSeoError(
        `DataForSEO request failed (HTTP ${response.status}${message ? `: ${message}` : ""})`,
        502,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof DataForSeoError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DataForSeoError("DataForSEO request timed out", 504, undefined, true);
    }
    throw new DataForSeoError("Unable to reach DataForSEO", 502, undefined, true);
  } finally {
    clearTimeout(timer);
  }
}

export async function createGoogleTrendsTask(
  input: GoogleTrendsInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ taskId: string }> {
  const payload = await dataForSeoRequest(
    GOOGLE_TRENDS_TASK_POST_URL,
    { method: "POST", body: JSON.stringify([buildTask(input)]) },
    fetchImpl,
  );
  assertEnvelopeOk(payload, "task creation");
  const task = payload.tasks[0];
  const taskId = isRecord(task) ? stringValue(task.id) : undefined;
  const statusCode =
    isRecord(task) && typeof task.status_code === "number" ? task.status_code : undefined;
  // 20100 "Task Created." is the only success; a rejected task still carries an id.
  if (!taskId || (statusCode !== undefined && statusCode !== 20100 && statusCode !== 20000)) {
    const message = isRecord(task) ? stringValue(task.status_message) : undefined;
    throw new DataForSeoError(
      `DataForSEO rejected the task: ${message ?? "no task ID returned"}`,
      502,
      statusCode,
    );
  }
  return { taskId };
}

export async function getGoogleTrendsTask(
  taskId: string,
  keywords: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTrendsTask> {
  const payload = await dataForSeoRequest(
    `${GOOGLE_TRENDS_TASK_GET_URL}${encodeURIComponent(taskId)}`,
    { method: "GET" },
    fetchImpl,
  );
  assertEnvelopeOk(payload, "task status");
  const task = payload.tasks[0];
  if (!isRecord(task) || typeof task.status_code !== "number") {
    throw new DataForSeoError("DataForSEO returned an invalid task response", 502);
  }
  const statusCode = task.status_code;
  const statusMessage = stringValue(task.status_message);
  if (statusCode === 20000 && Array.isArray(task.result)) {
    const result = task.result[0];
    // A finished task whose result carries no items found no search interest.
    if (!isRecord(result) || !Array.isArray(result.items) || result.items.length === 0) {
      return { id: taskId, status: "completed", statusCode, statusMessage };
    }
    return {
      id: taskId,
      status: "completed",
      statusCode,
      statusMessage,
      data: parseResultPayload({ status_code: 20000, tasks: [task] }, keywords),
    };
  }
  // 40102 "No Search Results." is a finished task with nothing to report.
  if (statusCode === 40102) {
    return { id: taskId, status: "completed", statusCode, statusMessage };
  }
  if (
    statusCode === 20100 ||
    statusCode === 40601 ||
    statusCode === 40602 ||
    (statusCode >= 10000 && statusCode < 20000)
  ) {
    return { id: taskId, status: "pending", statusCode, statusMessage };
  }
  return { id: taskId, status: "failed", statusCode, statusMessage };
}

export async function fetchGoogleTrends(
  input: GoogleTrendsInput,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTrendsData> {
  try {
    const payload = await dataForSeoRequest(
      GOOGLE_TRENDS_LIVE_URL,
      { method: "POST", body: JSON.stringify([buildTask(input)]) },
      fetchImpl,
    );
    return parseResultPayload(payload, input.keywords);
  } catch (error) {
    if (error instanceof DataForSeoError) throw error;
    throw new DataForSeoError("Unable to reach DataForSEO", 502);
  }
}
