"use strict";

const fs = require("fs");
const path = require("path");

const fetchLive = require("../electron/fetch-live");
const generateBrief = require("../electron/generate-brief");

const ROOT = path.resolve(__dirname, "..");
const DOCS_ROOT = path.join(ROOT, "docs");
const DATA_ROOT = path.join(DOCS_ROOT, "data");

const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requireApiKey(provider) {
  const envName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const apiKey = process.env[envName];
  if (!apiKey) {
    throw new Error(`Missing ${envName} in the environment.`);
  }
  return apiKey;
}

async function main() {
  const provider = String(process.env.MACRO_BRIEF_PROVIDER || "anthropic").toLowerCase();
  if (!DEFAULT_MODELS[provider]) {
    throw new Error(`Unsupported MACRO_BRIEF_PROVIDER: ${provider}`);
  }

  const model = process.env.MACRO_BRIEF_MODEL || DEFAULT_MODELS[provider];
  const apiKey = requireApiKey(provider);
  const historyPath = path.join(DATA_ROOT, "history.json");
  const livePath = path.join(DATA_ROOT, "live.json");

  console.log(`Publishing site data with ${provider}/${model}...`);
  await fetchLive.run({ historyPath, outPath: livePath });

  if (process.env.MACRO_BRIEF_SKIP_BRIEF === "1") {
    console.log("Skipped brief generation because MACRO_BRIEF_SKIP_BRIEF=1.");
    return;
  }

  const liveJson = readJson(livePath);
  const historyJson = readJson(historyPath);

  const result = await generateBrief.generate({
    docsRoot: DOCS_ROOT,
    userDocsRoot: DOCS_ROOT,
    liveJson,
    historyJson,
    provider,
    model,
    apiKey,
    onStatus: (msg) => console.log(msg),
  });

  console.log(`Published brief ${result.slug} (${result.title}).`);
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exitCode = 1;
});
