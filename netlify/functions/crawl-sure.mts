import type { Config, Handler } from "@netlify/functions";
import { runSureCrawl } from "../../src/lib/crawl";

/**
 * Scheduled every 20 minutes via netlify.toml [functions."crawl-sure"].schedule
 */
export const handler: Handler = async () => {
  try {
    const result = await runSureCrawl();
    return {
      statusCode: result.ok ? 200 : 500,
      body: JSON.stringify(result),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
    };
  }
};

export const config: Config = {
  schedule: "*/20 * * * *",
};
