import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

const apiKey = process.env.OPENAI_API_KEY || "";
const model = process.env.OPENAI_MODEL || "gpt-5-nano";
const endpoint = "responses";

console.log(JSON.stringify({ openaiKeyLoaded: Boolean(apiKey), model, endpoint }, null, 2));

if (!apiKey) {
  process.exitCode = 1;
} else {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "Ты FruitFit Coach. Отвечай кратко на русском, максимум 5 предложений.",
        },
        {
          role: "user",
          content: "Что делать если плохо восстановился?",
        },
      ],
      max_output_tokens: 600,
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data.error || {};
    console.error(JSON.stringify({
      status: response.status,
      endpoint,
      model,
      message: error.message || "OpenAI API error",
      code: error.code || null,
      type: error.type || null,
    }, null, 2));
    process.exitCode = 1;
  } else {
    const text = data.output_text || (data.output || [])
      .flatMap((item) => item.content || [])
      .map((item) => item.text || "")
      .filter(Boolean)
      .join("\n");

    console.log(JSON.stringify({
      status: response.status,
      endpoint,
      model,
      answer: text.trim(),
    }, null, 2));
  }
}
