import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      TABLE_NAME: "test-table",
      BUCKET_NAME: "test-bucket",
      SCAN_QUEUE_URL: "https://sqs.test/queue",
      AWS_REGION: "eu-west-2",
    },
  },
});
