#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { readConfig } from "../lib/config.js";
import { SimpleExpensesStack } from "../lib/simple-expenses-stack.js";

const app = new App();
const config = readConfig(app);

new SimpleExpensesStack(app, "SimpleExpenses", {
  config,
  env: {
    account: process.env["CDK_DEFAULT_ACCOUNT"],
    region: process.env["CDK_DEFAULT_REGION"] ?? process.env["AWS_REGION"] ?? "eu-west-2",
  },
  description: "Serverless personal expenses app: receipts, AI extraction, cataloguing, reports.",
});
