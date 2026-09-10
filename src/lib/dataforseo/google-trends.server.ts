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
    if (!response.ok) throw new DataForSeoError("DataForSEO request failed", 502, response.status);
    return payload;
  } catch (error) {
    if (error instanceof DataForSeoError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DataForSeoError("DataForSEO request timed out", 504);
    }
    throw new DataForSeoError("Unable to reach DataForSEO", 502);
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
  if (!isRecord(payload) || payload.status_code !== 20000 || !Array.isArray(payload.tasks)) {
    throw new DataForSeoError("DataForSEO returned an unexpected task response", 502);
  }
  const task = payload.tasks[0];
  const taskId = isRecord(task) ? stringValue(task.id) : undefined;
  if (!taskId) {
    const message = isRecord(task) ? stringValue(task.status_message) : undefined;
    throw new DataForSeoError(message ?? "DataForSEO did not return a task ID", 502);
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
  if (!isRecord(payload) || payload.status_code !== 20000 || !Array.isArray(payload.tasks)) {
    throw new DataForSeoError("DataForSEO returned an unexpected task response", 502);
  }
  const task = payload.tasks[0];
  if (!isRecord(task) || typeof task.status_code !== "number") {
    throw new DataForSeoError("DataForSEO returned an invalid task response", 502);
  }
  const statusCode = task.status_code;
  const statusMessage = stringValue(task.status_message);
  if (statusCode === 20000 && Array.isArray(task.result)) {
    return {
      id: taskId,
      status: "completed",
      statusCode,
      statusMessage,
      data: parseResultPayload({ status_code: 20000, tasks: [task] }, keywords),
    };
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
