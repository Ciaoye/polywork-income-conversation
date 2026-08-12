import { env } from "cloudflare:workers";
import { questions } from "../../../lib/questions";

type EventRow = { active_question: number; reveal_answers: number; updated_at: string };
type ResponseRow = {
  id: string;
  question_id: string;
  participant_id: string;
  data: string;
  hidden: number;
  highlighted: number;
  created_at: string;
  updated_at: string;
  reaction_count: number;
};

const HOST_ACTIONS = new Set(["setQuestion", "setReveal", "moderate"]);

function hostKey() {
  return String((env as unknown as Record<string, unknown>).HOST_KEY ?? "");
}

function isAuthorizedHost(body: Record<string, unknown>) {
  const expected = hostKey();
  const received = String(body.hostKey ?? "");
  if (!expected || expected.length < 8 || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return difference === 0;
}

function db() {
  if (!env.DB) throw new Error("本地数据库尚未连接");
  return env.DB as D1Database;
}

async function ensureSchema() {
  const database = db();
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS event_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), active_question INTEGER NOT NULL DEFAULT 0,
      reveal_answers INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL, participant_id TEXT NOT NULL,
      data TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, highlighted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(question_id, participant_id)
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS reactions (
      response_id TEXT NOT NULL, participant_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(response_id, participant_id),
      FOREIGN KEY(response_id) REFERENCES responses(id) ON DELETE CASCADE
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_responses_question ON responses(question_id, hidden)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_reactions_response ON reactions(response_id)"),
    database.prepare("INSERT OR IGNORE INTO event_state (id, active_question, reveal_answers) VALUES (1, 0, 1)"),
  ]);
}

async function snapshot(participantId = "") {
  await ensureSchema();
  const database = db();
  const state = await database.prepare("SELECT * FROM event_state WHERE id = 1").first<EventRow>();
  const index = Math.max(0, Math.min(questions.length - 1, state?.active_question ?? 0));
  const question = questions[index];
  const result = await database.prepare(`SELECT r.*, COUNT(x.participant_id) AS reaction_count
    FROM responses r LEFT JOIN reactions x ON x.response_id = r.id
    WHERE r.question_id = ? GROUP BY r.id
    ORDER BY r.highlighted DESC, reaction_count DESC, r.created_at ASC`)
    .bind(question.id).all<ResponseRow>();

  let reacted = new Set<string>();
  if (participantId) {
    const own = await database.prepare("SELECT response_id FROM reactions WHERE participant_id = ?")
      .bind(participantId).all<{ response_id: string }>();
    reacted = new Set(own.results.map((row) => row.response_id));
  }

  return {
    state: { activeQuestion: index, revealAnswers: Boolean(state?.reveal_answers), updatedAt: state?.updated_at },
    question,
    totalQuestions: questions.length,
    responses: result.results.map((row) => ({
      id: row.id,
      questionId: row.question_id,
      participantId: row.participant_id,
      data: JSON.parse(row.data),
      hidden: Boolean(row.hidden),
      highlighted: Boolean(row.highlighted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reactionCount: Number(row.reaction_count),
      reacted: reacted.has(row.id),
    })),
  };
}

export async function GET(request: Request) {
  try {
    const participantId = new URL(request.url).searchParams.get("participant") ?? "";
    return Response.json(await snapshot(participantId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const database = db();
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (HOST_ACTIONS.has(action) && !isAuthorizedHost(body)) {
      return Response.json({ error: "主持人口令不正确" }, { status: 401 });
    }

    if (action === "submit") {
      const participantId = String(body.participantId ?? "").slice(0, 100);
      const questionId = String(body.questionId ?? "");
      if (!participantId || !questions.some((question) => question.id === questionId) || !body.data) {
        return Response.json({ error: "回答内容不完整" }, { status: 400 });
      }
      await database.prepare(`INSERT INTO responses (id, question_id, participant_id, data)
        VALUES (?, ?, ?, ?) ON CONFLICT(question_id, participant_id) DO UPDATE SET
        data = excluded.data, hidden = 0, updated_at = CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(), questionId, participantId, JSON.stringify(body.data).slice(0, 8000)).run();
    } else if (action === "react") {
      const responseId = String(body.responseId ?? "");
      const participantId = String(body.participantId ?? "").slice(0, 100);
      if (!responseId || !participantId) return Response.json({ error: "缺少投票信息" }, { status: 400 });
      const exists = await database.prepare("SELECT 1 FROM reactions WHERE response_id = ? AND participant_id = ?")
        .bind(responseId, participantId).first();
      if (exists) {
        await database.prepare("DELETE FROM reactions WHERE response_id = ? AND participant_id = ?")
          .bind(responseId, participantId).run();
      } else {
        await database.prepare("INSERT OR IGNORE INTO reactions (response_id, participant_id) VALUES (?, ?)")
          .bind(responseId, participantId).run();
      }
    } else if (action === "setQuestion") {
      const index = Math.max(0, Math.min(questions.length - 1, Number(body.index ?? 0)));
      await database.prepare("UPDATE event_state SET active_question = ?, reveal_answers = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
        .bind(index).run();
    } else if (action === "setReveal") {
      await database.prepare("UPDATE event_state SET reveal_answers = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
        .bind(body.value ? 1 : 0).run();
    } else if (action === "moderate") {
      const field = body.field === "hidden" ? "hidden" : "highlighted";
      await database.prepare(`UPDATE responses SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(body.value ? 1 : 0, String(body.responseId ?? "")).run();
    } else {
      return Response.json({ error: "未知操作" }, { status: 400 });
    }
    return Response.json(await snapshot(String(body.participantId ?? "")));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 500 });
  }
}
