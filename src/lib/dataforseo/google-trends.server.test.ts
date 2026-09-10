import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleTrendsTask,
  DataForSeoError,
  fetchGoogleTrends,
  getGoogleTrendsTask,
} from "./google-trends.server";

const graphItem = {
  type: "google_trends_graph",
  data: {
    data: [{ timestamp: 1700000000, date: "2023-11-14", values: [100], averages: [100] }],
  },
};

function successfulResponse(items: unknown[]) {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items }] }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("DataForSEO Google Trends client", () => {
  beforeEach(() => {
    process.env.DATAFORSEO_LOGIN = "login@example.test";
    process.env.DATAFORSEO_PASSWORD = "password-for-test";
  });

  it("fetches and normalizes one keyword with related data", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      successfulResponse([
        graphItem,
        {
          type: "google_trends_queries_list",
          data: { top: [{ query: "marketing", value: "100" }], rising: [] },
        },
        {
          type: "google_trends_topics_list",
          data: {
            top: [
              { topic_id: "/m/abc", topic_title: "Marketing", topic_type: "Topic", value: "100" },
            ],
          },
        },
      ]),
    );

    const result = await fetchGoogleTrends(
      { keywords: ["AI marketing"], location: "United States", language: "en" },
      fetchMock,
    );
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(request[0]).toMatchObject({
      keywords: ["AI marketing"],
      location_name: "United States",
      language_code: "en",
    });
    expect(request[0].item_types).toContain("google_trends_queries_list");
    expect(result.interestOverTime).toHaveLength(1);
    expect(result.relatedQueries[0]?.query).toBe("marketing");
    expect(result.relatedTopics[0]?.topicTitle).toBe("Marketing");
  });

  it("supports comparison requests and omits unsupported related lists", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse([graphItem]));

    const result = await fetchGoogleTrends(
      { keywords: ["AI marketing", "AI advertising", "marketing automation"] },
      fetchMock,
    );
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(request[0].keywords).toHaveLength(3);
    expect(request[0].item_types).not.toContain("google_trends_queries_list");
    expect(result.relatedQueries).toEqual([]);
  });

  it("normalizes the direct Standard API item shapes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      successfulResponse([
        {
          type: "google_trends_graph",
          data: [{ timestamp: 1700000000, date: "2023-11-14", values: [42] }],
          averages: [21],
        },
        {
          type: "google_trends_map",
          data: [{ geo_id: "US-CA", geo_name: "California", values: [88] }],
        },
        {
          type: "google_trends_topics_list",
          data: {
            top: [
              { topic_id: "/m/abc", topic_title: "Marketing", topic_type: "Topic", value: "100" },
            ],
          },
        },
        {
          type: "google_trends_queries_list",
          data: { rising: [{ query: "marketing tools", value: "Breakout" }] },
        },
      ]),
    );

    const result = await fetchGoogleTrends({ keywords: ["AI marketing"] }, fetchMock);

    expect(result.interestOverTime[0]).toMatchObject({ values: [42], averages: [21] });
    expect(result.regionalInterest[0]).toMatchObject({ geoId: "US-CA", values: [88] });
    expect(result.relatedTopics[0]?.topicTitle).toBe("Marketing");
    expect(result.relatedQueries[0]?.query).toBe("marketing tools");
  });

  it("creates a Standard task with the documented payload", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status_code: 20000, tasks: [{ id: "task-1", status_code: 20100 }] }),
          { status: 200 },
        ),
      );

    await expect(
      createGoogleTrendsTask(
        { keywords: ["AI marketing"], location: "United States", language: "en" },
        fetchMock,
      ),
    ).resolves.toEqual({ taskId: "task-1" });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/explore/task_post");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))[0]).toMatchObject({
      keywords: ["AI marketing"],
      location_name: "United States",
      language_code: "en",
    });
  });

  it("reports pending, completed, and failed task states", async () => {
    const pending = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20100 }] }), {
        status: 200,
      }),
    );
    await expect(getGoogleTrendsTask("pending", ["AI marketing"], pending)).resolves.toMatchObject({
      status: "pending",
    });

    const failed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{ status_code: 40200, status_message: "Provider failed" }],
        }),
        { status: 200 },
      ),
    );
    await expect(getGoogleTrendsTask("failed", ["AI marketing"], failed)).resolves.toMatchObject({
      status: "failed",
      statusMessage: "Provider failed",
    });

    const completed = vi.fn<typeof fetch>().mockResolvedValue(
      successfulResponse([
        {
          type: "google_trends_graph",
          data: [{ timestamp: 1, date: "2024-01-01", values: [7] }],
        },
      ]),
    );
    await expect(
      getGoogleTrendsTask("complete", ["AI marketing"], completed),
    ).resolves.toMatchObject({
      status: "completed",
      data: { interestOverTime: [{ values: [7] }] },
    });
  });

  it("fails safely when credentials are missing", async () => {
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;

    await expect(fetchGoogleTrends({ keywords: ["AI marketing"] })).rejects.toMatchObject({
      name: "DataForSeoError",
      status: 503,
    } satisfies Partial<DataForSeoError>);
  });
});
