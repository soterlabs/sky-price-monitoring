import { defineRailway, postgres, project, service, volume, fn, github } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "us-west2" });
  Postgres.deploy = { multiRegionConfig: { "us-west2": { numReplicas: 1 } } };
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 50000 });

  const web = service("sky-price-monitoring", {
    source: github("soterlabs/token-price-monitoring"),
    replicas: { "us-west2": 1 },
    healthcheck: "/healthz",
    healthcheckTimeout: 60,
  });
  const collector = fn("sky-collector", {
    source: github("soterlabs/token-price-monitoring"),
    start: "npm run collect",
    deploy: { cronSchedule: "*/5 * * * *", restartPolicyType: "NEVER" },
  });
  const daily = fn("sky-daily-rollups", {
    source: github("soterlabs/token-price-monitoring"),
    start: "npm run rollup",
    deploy: { cronSchedule: "25 0 * * *", restartPolicyType: "NEVER" },
  });

  const stusdsWeb = service("stusds-price-monitoring", {
    source: github("soterlabs/token-price-monitoring"), replicas: { "us-west2": 1 },
    healthcheck: "/healthz", healthcheckTimeout: 60,
  });
  const stusdsCollector = fn("stusds-collector", {
    source: github("soterlabs/token-price-monitoring"), start: "npm run collect",
    deploy: { cronSchedule: "*/5 * * * *", restartPolicyType: "NEVER" },
  });
  const stusdsDaily = fn("stusds-daily-rollups", {
    source: github("soterlabs/token-price-monitoring"), start: "npm run rollup",
    deploy: { cronSchedule: "35 0 * * *", restartPolicyType: "NEVER" },
  });

  return project("sky-price-monitoring", {
    variables: { managed: false },
    resources: [Postgres, postgresVolume, web, collector, daily, stusdsWeb, stusdsCollector, stusdsDaily],
  });
});
