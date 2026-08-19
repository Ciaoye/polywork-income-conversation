/* eslint-disable @typescript-eslint/no-require-imports -- CloudBase Node function entrypoints use CommonJS */
const crypto = require("node:crypto");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_DEFAULT_ENV });
const db = app.database();
const collection = db.collection("polywork_events");
const questionIds = [
  "self-introduction",
  "income-map",
  "choice-spectrum",
  "earning-story",
  "body-memory",
  "one-year-buffer",
  "solo-company",
  "valuable-thing",
  "enough",
  "new-default",
];

const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

// GET snapshots are safe to cache briefly: they contain only the current
// question and anonymous answers, while POST responses always return fresh
// data. This lets the gateway/browser coalesce bursts instead of invoking the
// function for every identical read.
const snapshotHeaders = {
  ...headers,
  "cache-control": "public, max-age=2, stale-while-revalidate=8",
};

function reply(statusCode, value, responseHeaders = headers) {
  return { statusCode, headers: responseHeaders, body: JSON.stringify(value), isBase64Encoded: false };
}

function first(result) {
  if (!result || result.data == null) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data;
}

function rows(result) {
  if (!result || result.data == null) return [];
  return Array.isArray(result.data) ? result.data : [result.data];
}

function stableId(...parts) {
  return crypto.createHash("sha256").update(parts.join(":"), "utf8").digest("hex").slice(0, 32);
}

function boundedQuestion(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < questionIds.length ? parsed : fallback;
}

function parseBody(event) {
  if (!event.body) return {};
  if (typeof event.body === "object") return event.body;
  const source = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(source || "{}");
}

async function getState() {
  const result = await collection.doc("state").get();
  const current = first(result);
  if (current) return current;
  const initial = {
    kind: "state",
    activeQuestion: 0,
    revealAnswers: true,
    updatedAt: new Date().toISOString(),
  };
  await collection.doc("state").set(initial);
  return { _id: "state", ...initial };
}

async function snapshot(participantId, requestedQuestion) {
  const state = await getState();
  const questionIndex = boundedQuestion(requestedQuestion, boundedQuestion(state.activeQuestion));
  const questionId = questionIds[questionIndex];
  const [responseResult, reactionResult] = await Promise.all([
    collection.where({ kind: "response", questionId }).limit(1000).get(),
    collection.where({ kind: "reaction", questionId }).limit(1000).get(),
  ]);
  const reactions = rows(reactionResult);
  const reactionCount = new Map();
  const reacted = new Set();
  for (const reaction of reactions) {
    reactionCount.set(reaction.responseId, (reactionCount.get(reaction.responseId) || 0) + 1);
    if (participantId && reaction.participantId === participantId) reacted.add(reaction.responseId);
  }
  const responses = rows(responseResult)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    .map((response) => ({
      id: response._id,
      questionId: response.questionId,
      participantId: response.participantId,
      data: response.data || {},
      hidden: Boolean(response.hidden),
      highlighted: Boolean(response.highlighted),
      reactionCount: reactionCount.get(response._id) || 0,
      reacted: reacted.has(response._id),
      updatedAt: response.updatedAt,
    }));
  return {
    state: {
      activeQuestion: boundedQuestion(state.activeQuestion),
      revealAnswers: state.revealAnswers !== false,
      updatedAt: state.updatedAt,
    },
    questionIndex,
    totalQuestions: questionIds.length,
    responses,
    joinUrl: process.env.PARTICIPANT_JOIN_URL || "",
  };
}

function assertHost(payload) {
  const expected = process.env.HOST_KEY || "";
  if (!expected || payload.hostKey !== expected) {
    const error = new Error("主持操作未授权");
    error.statusCode = 401;
    throw error;
  }
}

async function act(payload) {
  const now = new Date().toISOString();
  const viewQuestion = boundedQuestion(payload.viewQuestionIndex);

  if (payload.action === "submit") {
    const participantId = String(payload.participantId || "").slice(0, 100);
    const questionId = String(payload.questionId || "");
    if (!participantId || !questionIds.includes(questionId) || typeof payload.data !== "object" || payload.data === null) {
      return reply(400, { error: "回答内容不完整" });
    }
    const id = stableId(questionId, participantId);
    const existing = first(await collection.doc(id).get());
    await collection.doc(id).set({
      kind: "response",
      questionId,
      participantId,
      data: payload.data,
      hidden: existing ? Boolean(existing.hidden) : false,
      highlighted: existing ? Boolean(existing.highlighted) : false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    return reply(200, await snapshot(participantId, viewQuestion));
  }

  if (payload.action === "react") {
    const participantId = String(payload.participantId || "").slice(0, 100);
    const responseId = String(payload.responseId || "").slice(0, 100);
    if (!participantId || !responseId) return reply(400, { error: "互动信息不完整" });
    const response = first(await collection.doc(responseId).get());
    if (!response || response.kind !== "response") return reply(404, { error: "这条回答不存在" });
    const reactionId = stableId("reaction", responseId, participantId);
    const existing = first(await collection.doc(reactionId).get());
    if (existing) {
      await collection.doc(reactionId).remove();
    } else {
      await collection.doc(reactionId).set({ kind: "reaction", responseId, questionId: response.questionId, participantId, createdAt: now });
    }
    return reply(200, await snapshot(participantId, viewQuestion));
  }

  if (payload.action === "setQuestion") {
    assertHost(payload);
    const state = await getState();
    await collection.doc("state").set({
      kind: "state",
      activeQuestion: boundedQuestion(payload.index, boundedQuestion(state.activeQuestion)),
      revealAnswers: state.revealAnswers !== false,
      updatedAt: now,
    });
    return reply(200, await snapshot("host", boundedQuestion(payload.index)));
  }

  if (payload.action === "setReveal") {
    assertHost(payload);
    const state = await getState();
    await collection.doc("state").set({
      kind: "state",
      activeQuestion: boundedQuestion(state.activeQuestion),
      revealAnswers: Boolean(payload.value),
      updatedAt: now,
    });
    return reply(200, await snapshot("host", boundedQuestion(state.activeQuestion)));
  }

  if (payload.action === "moderate") {
    assertHost(payload);
    const responseId = String(payload.responseId || "").slice(0, 100);
    const response = first(await collection.doc(responseId).get());
    if (!response || response.kind !== "response") return reply(404, { error: "这条回答不存在" });
    const patch = { updatedAt: now };
    if (payload.field === "hidden") patch.hidden = Boolean(payload.value);
    else if (payload.field === "highlighted") patch.highlighted = Boolean(payload.value);
    else return reply(400, { error: "不支持的主持操作" });
    await collection.doc(responseId).update(patch);
    return reply(200, await snapshot("host", viewQuestion));
  }

  return reply(400, { error: "不支持的操作" });
}

exports.main = async (event) => {
  const method = String(event.httpMethod || event.requestContext?.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") return reply(204, {});
  try {
    if (method === "GET") {
      const query = event.queryStringParameters || {};
      return reply(200, await snapshot(String(query.participant || ""), query.question), snapshotHeaders);
    }
    if (method === "POST") return await act(parseBody(event));
    return reply(405, { error: "不支持的请求方式" });
  } catch (error) {
    console.error(error);
    return reply(error.statusCode || 500, { error: error.statusCode ? error.message : "现场数据暂时不可用" });
  }
};
