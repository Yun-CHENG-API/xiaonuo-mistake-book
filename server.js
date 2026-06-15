import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const maxBodySize = 30 * 1024 * 1024;

const providerModels = {
  gemini: process.env.GEMINI_MODEL || "gemini-3.5-flash",
  gpt: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  claude: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
  deepseek: process.env.DEEPSEEK_MODEL || "deepseek-chat"
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/test-ai") {
      const body = await readJsonBody(request);
      await testProvider(body);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && request.url === "/api/review") {
      const body = await readJsonBody(request);
      const questions = await reviewHomework(body);
      sendJson(response, 200, { questions });
      return;
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      sendJson(response, 405, { error: "这个请求方式暂时不支持。" });
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    const status = Number(error.status || 500);
    sendJson(response, status, { error: error.message || "服务暂时出错了。" });
  }
}).listen(port, () => {
  console.log(`小诺的错题本已启动：http://localhost:${port}/`);
});

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodySize) {
      throw httpError(413, "照片太大了。先压缩或少传几张再试。");
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw httpError(400, "请求内容不是有效 JSON。");
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const relativePath = safePath === "/" ? "index.html" : safePath.slice(1);
  const filePath = join(rootDir, relativePath.endsWith("/") ? `${relativePath}index.html` : relativePath);

  if (!filePath.startsWith(rootDir)) {
    throw httpError(403, "不能访问这个文件。");
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    throw httpError(404, "没有找到这个页面。");
  }
}

async function testProvider({ provider, apiKey }) {
  assertProvider(provider);
  assertApiKey(apiKey);

  if (provider === "gemini") {
    await callGemini(apiKey, [{ text: "请只回复 OK。" }], 16, false);
    return;
  }

  if (provider === "gpt") {
    await callOpenAI(apiKey, [{ type: "input_text", text: "Reply OK only." }], 16);
    return;
  }

  if (provider === "claude") {
    await callClaude(apiKey, [{ type: "text", text: "Reply OK only." }], 16);
    return;
  }

  if (provider === "deepseek") {
    await callDeepSeek(apiKey, "Reply OK only.", 16);
  }
}

async function reviewHomework({ provider, apiKey, subject, uploads }) {
  assertProvider(provider);
  assertApiKey(apiKey);
  if (!Array.isArray(uploads) || uploads.length === 0) {
    throw httpError(400, "先上传作业照片。");
  }

  const imageUploads = uploads.filter((upload) => (upload.type || "").startsWith("image/"));
  if (imageUploads.length === 0) {
    throw httpError(400, "现在先支持照片批改。PDF 后面再接文档识别。");
  }

  if (provider === "deepseek") {
    throw httpError(400, "DeepSeek 不能直接看作业照片。它需要先接 OCR：照片先转成文字，再把文字交给 DeepSeek 批改。当前请先选 Gemini、GPT 或 Claude。");
  }

  const currentSubject = subject || imageUploads[0].subject || "数学";
  const transcript = await transcribeHomework(provider, apiKey, currentSubject, imageUploads);
  const prompt = buildReviewPrompt(currentSubject, transcript);
  let text = "";

  if (provider === "gemini") {
    const parts = [{ text: prompt }];
    text = await callGemini(apiKey, parts, 4096);
  }

  if (provider === "gpt") {
    const content = [{ type: "input_text", text: prompt }];
    text = await callOpenAI(apiKey, content, 4096);
  }

  if (provider === "claude") {
    const content = [{ type: "text", text: prompt }];
    text = await callClaude(apiKey, content, 4096);
  }

  return parseReviewQuestions(text, currentSubject, imageUploads[0]?.id || "");
}

async function transcribeHomework(provider, apiKey, subject, imageUploads) {
  const prompt = buildTranscriptionPrompt(subject);

  if (provider === "gemini") {
    return callGemini(apiKey, [{ text: prompt }, ...imageUploads.map(toGeminiInlineData)], 4096, false);
  }

  if (provider === "gpt") {
    return callOpenAI(
      apiKey,
      [
        { type: "input_text", text: prompt },
        ...imageUploads.map((upload) => ({
          type: "input_image",
          image_url: upload.dataUrl
        }))
      ],
      4096,
      false
    );
  }

  if (provider === "claude") {
    return callClaude(apiKey, [{ type: "text", text: prompt }, ...imageUploads.map(toClaudeImage)], 4096);
  }

  throw httpError(400, "这个 AI 暂时不能直接看照片。");
}

function buildTranscriptionPrompt(subject) {
  return `你是“小诺的错题本”的作业照片转写助手。请先只做识别，不要批改。

请按照片从上到下、从左到右列出你能看清的题目，特别注意：
1. 空白没写的题必须标出来。
2. 孩子写错、涂改、划掉、老师打叉或红笔标记的地方要标出来。
3. 看不清的题不要编造，写“看不清”。
4. 如果一张图里有多道题，要逐题编号。
5. 红叉、半勾、圈画、订正痕迹、空白答案区域，都要如实记录，不要当作做对。

输出普通文本即可，格式参考：
题1：
题目：
孩子答案：
老师/红笔痕迹：
是否空白：
是否看不清：

学科：${subject}`;
}

function buildReviewPrompt(subject, transcript) {
  return `你是“小诺的错题本”的批改助手。下面是从${subject}作业照片中转写出的内容。请基于转写内容批改，不要编造转写里没有的题目。

【作业转写】
${transcript}

只返回 JSON，不要解释，不要 Markdown。格式如下：
{
  "questions": [
    {
      "result": "wrong | blank | correct",
      "question": "题目内容",
      "childAnswer": "孩子答案；空白题写空着没写",
      "correctAnswer": "正确答案",
      "subject": "${subject}",
      "topic": "知识点",
      "explanation": "给小学生能听懂的解题方法",
      "similarQuestion": "一道相似题"
    }
  ]
}

要求：
1. 错题和空白题一定要放出来，空白题不要忽略。
2. 做对的题也可以放进 JSON，用于统计，但解释要简短。
3. 如果照片看不清，把 result 设为 wrong，question 写“这张照片看不清”，explanation 提醒重新拍清楚。
4. 不要编造转写里没有的具体题目。
5. 对空白题，childAnswer 写“空着没写”，explanation 重点说明第一步怎么开始。
6. 如果转写里出现红叉、半勾、订正痕迹，但无法确定孩子原答案是否正确，result 设为 wrong，并在 explanation 里写“需要家长确认”。`;
}

async function callGemini(apiKey, parts, maxOutputTokens, jsonMode = true) {
  const generationConfig = { maxOutputTokens };
  if (jsonMode) generationConfig.responseMimeType = "application/json";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${providerModels.gemini}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig
      })
    }
  );
  const data = await readProviderResponse(response);
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

async function callOpenAI(apiKey, content, maxOutputTokens, jsonMode = true) {
  const body = {
    model: providerModels.gpt,
    input: [{ role: "user", content }],
    max_output_tokens: maxOutputTokens
  };
  if (jsonMode) {
    body.text = {
      format: { type: "json_object" }
    };
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const data = await readProviderResponse(response);
  return data.output_text || data.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("") || "";
}

async function callClaude(apiKey, content, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: providerModels.claude,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }]
    })
  });
  const data = await readProviderResponse(response);
  return data.content?.map((item) => item.text || "").join("") || "";
}

async function callDeepSeek(apiKey, prompt, maxTokens) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: providerModels.deepseek,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens
    })
  });
  const data = await readProviderResponse(response);
  return data.choices?.[0]?.message?.content || "";
}

async function readProviderResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, data.error?.message || data.error?.error?.message || data.message || "AI 接口调用失败。");
  }
  return data;
}

function parseReviewQuestions(text, subject, sourceUploadId) {
  const parsed = extractJson(text);
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  if (questions.length === 0) {
    throw httpError(502, "AI 没有返回可用的批改结果。换一张更清楚的照片再试。");
  }
  return questions.map((item) => ({
    result: ["wrong", "blank", "correct"].includes(item.result) ? item.result : "wrong",
    question: item.question || "AI 识别到的一道题",
    childAnswer: item.childAnswer || (item.result === "blank" ? "空着没写" : "请家长确认"),
    correctAnswer: item.correctAnswer || "请家长确认",
    subject: item.subject || subject,
    topic: item.topic || "还没分",
    explanation: item.explanation || "请家长确认这道题。",
    similarQuestion: item.similarQuestion || "",
    sourceUploadId
  }));
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  }
}

function toGeminiInlineData(upload) {
  const { mimeType, base64 } = splitDataUrl(upload.dataUrl);
  return {
    inline_data: {
      mime_type: mimeType || upload.type || "image/jpeg",
      data: base64
    }
  };
}

function toClaudeImage(upload) {
  const { mimeType, base64 } = splitDataUrl(upload.dataUrl);
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mimeType || upload.type || "image/jpeg",
      data: base64
    }
  };
}

function splitDataUrl(dataUrl = "") {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw httpError(400, "照片格式不对，请重新上传。");
  }
  return {
    mimeType: match[1],
    base64: match[2]
  };
}

function assertProvider(provider) {
  if (!["gemini", "gpt", "claude", "deepseek"].includes(provider)) {
    throw httpError(400, "请选择支持的 AI。");
  }
}

function assertApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") {
    throw httpError(400, "请先填写 API Key。");
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
