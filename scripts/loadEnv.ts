import { loadEnvConfig } from "@next/env";

// Same .env / .env.local resolution as `next dev`, so scripts see identical config.
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
