"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- vinext RSC prefetch crashes on deployed internal links */
/* eslint-disable @next/next/no-img-element -- the QR code is a generated data URL and the component is also reused by the static participant build */

import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { questions, type Question } from "../lib/questions";
import { sitePath } from "../lib/site-paths";

type Mode = "landing" | "participant" | "host";
type AnswerData = Record<string, string | number>;
type EventResponse = {
  id: string;
  questionId: string;
  participantId: string;
  data: AnswerData;
  hidden: boolean;
  highlighted: boolean;
  reactionCount: number;
  reacted: boolean;
  updatedAt: string;
};
type Snapshot = {
  state: { activeQuestion: number; revealAnswers: boolean; updatedAt?: string };
  question: Question;
  questionIndex: number;
  totalQuestions: number;
  responses: EventResponse[];
  joinUrl?: string;
};
type EventMode = "static" | "live";
type ExportRow = {
  _id: string;
  kind: "state" | "response" | "reaction";
  questionId?: string;
  participantId?: string;
  responseId?: string;
  data?: AnswerData;
  hidden?: boolean;
  highlighted?: boolean;
  createdAt?: string;
  updatedAt?: string;
  activeQuestion?: number;
  revealAnswers?: boolean;
};

const emptySnapshot: Snapshot = {
  state: { activeQuestion: 0, revealAnswers: true },
  question: questions[0],
  questionIndex: 0,
  totalQuestions: questions.length,
  responses: [],
};

declare global {
  interface Window {
    __POLYWORK_API_URL__?: string;
    __POLYWORK_STATIC_DATA_URL__?: string;
    __POLYWORK_BASE_URL__?: string;
  }
}

function participantApiEndpoint() {
  if (typeof window === "undefined") return "/api/event";
  return window.__POLYWORK_API_URL__ || "/api/event";
}

function normalizeSnapshot(data: Partial<Snapshot>): Snapshot {
  const questionIndex = Math.max(0, Math.min(questions.length - 1, Number(data.questionIndex ?? data.state?.activeQuestion ?? 0)));
  return {
    ...emptySnapshot,
    ...data,
    state: { ...emptySnapshot.state, ...data.state },
    question: data.question ?? questions[questionIndex],
    questionIndex,
    totalQuestions: data.totalQuestions ?? questions.length,
    responses: data.responses ?? [],
  };
}

function staticDataEndpoint() {
  if (typeof window === "undefined") return "/polywork-events.json";
  return window.__POLYWORK_STATIC_DATA_URL__ || "/polywork-events.json";
}

function eventMode(): EventMode {
  if (typeof window === "undefined") return "static";
  return new URLSearchParams(window.location.search).get("mode") === "live" ? "live" : "static";
}

function staticSnapshot(text: string, participantId: string, requestedQuestion?: number): Snapshot {
  const rows = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ExportRow);
  const savedState = rows.find((row) => row.kind === "state");
  const activeQuestion = Math.max(0, Math.min(questions.length - 1, Number(savedState?.activeQuestion ?? 0)));
  const questionIndex = requestedQuestion === undefined
    ? activeQuestion
    : Math.max(0, Math.min(questions.length - 1, requestedQuestion));
  const question = questions[questionIndex];
  const reactionCount = new Map<string, number>();
  const reacted = new Set<string>();
  rows.filter((row) => row.kind === "reaction" && row.responseId).forEach((row) => {
    reactionCount.set(row.responseId!, (reactionCount.get(row.responseId!) || 0) + 1);
    if (row.participantId === participantId) reacted.add(row.responseId!);
  });
  return normalizeSnapshot({
    state: { activeQuestion: questionIndex, revealAnswers: savedState?.revealAnswers !== false, updatedAt: savedState?.updatedAt },
    questionIndex,
    question,
    totalQuestions: questions.length,
    responses: rows.filter((row) => row.kind === "response" && row.questionId === question.id && row.data).map((row) => ({
      id: row._id,
      questionId: row.questionId!,
      participantId: row.participantId || "",
      data: row.data!,
      hidden: Boolean(row.hidden),
      highlighted: Boolean(row.highlighted),
      reactionCount: reactionCount.get(row._id) || 0,
      reacted: reacted.has(row._id),
      updatedAt: row.updatedAt || row.createdAt || "",
    })),
  });
}

async function sendAction(payload: Record<string, unknown>) {
  const response = await fetch(participantApiEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as Partial<Snapshot> & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作没有完成");
  return normalizeSnapshot(data);
}

async function sendHostAction(payload: Record<string, unknown>) {
  const response = await fetch("/api/host-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as Partial<Snapshot> & { error?: string };
  if (!response.ok) throw new Error(data.error || "主持操作没有完成");
  return normalizeSnapshot(data);
}

function useSnapshot(participantId: string, endpoint = "/api/event", questionIndex?: number, mode: EventMode = "live") {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try {
      if (mode === "static") {
        const response = await fetch(staticDataEndpoint(), { cache: "force-cache" });
        if (!response.ok) throw new Error("历史数据文件暂时无法读取");
        setSnapshot(staticSnapshot(await response.text(), participantId, questionIndex));
        setError("");
        setReady(true);
        return;
      }
      const params = new URLSearchParams({ participant: participantId });
      if (questionIndex !== undefined) params.set("question", String(questionIndex));
      // Allow the short server/browser cache window to coalesce duplicate reads.
      // Writes still return a fresh snapshot immediately through POST.
      const response = await fetch(`${endpoint}?${params.toString()}`, { cache: "default" });
      const data = (await response.json()) as Partial<Snapshot> & { error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法连接现场");
      setSnapshot(normalizeSnapshot(data));
      setError("");
      setReady(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "暂时无法连接现场");
    }
  }, [endpoint, mode, participantId, questionIndex]);

  useEffect(() => {
    // The activity is now archived. Read once on entry; subsequent reads are
    // explicit so an open tab never creates background CloudBase traffic.
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(initial);
    };
  }, [refresh]);

  return { snapshot, setSnapshot, error, ready, refresh };
}

function WindowFrame({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`os-window win-outset ${className}`}>
      <div className="title-bar">
        <div className="title-copy"><span aria-hidden="true">✦</span><strong>{title}</strong></div>
        <div className="window-buttons" aria-hidden="true"><span>_</span><span>□</span><span>×</span></div>
      </div>
      {children}
    </section>
  );
}

function Taskbar({ mode }: { mode: Mode }) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()));
    tick();
    const timer = window.setInterval(tick, 10000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <footer className="taskbar">
      <a className="start-button win-outset" href={sitePath("/")}><span className="start-orb">✦</span><b>开始</b></a>
      <span className="task-divider" />
      <div className="active-task win-outset">{mode === "host" ? "主持展示" : mode === "participant" ? "共同回答" : "活动说明"}</div>
      <div className="tray win-inset"><span className="signal-dot" /> LIVE&nbsp;&nbsp;{clock}</div>
    </footer>
  );
}

function Landing() {
  return (
    <main className="desktop landing-desktop">
      <div className="desktop-noise" />
      <div className="desktop-icons" aria-label="快速入口">
        <a href={sitePath("/join")} className="desktop-icon"><span className="pixel-icon">✎</span><span>加入讨论</span></a>
        <a href={sitePath("/host")} className="desktop-icon"><span className="pixel-icon">▣</span><span>主持展示</span></a>
        <a href={sitePath("/archive")} className="desktop-icon"><span className="pixel-icon">▤</span><span>历史回答</span></a>
        <a href="#questions" className="desktop-icon"><span className="pixel-icon">?</span><span>十个问题</span></a>
      </div>

      <WindowFrame title="多元工作与收入探索.exe" className="hero-window">
        <div className="menu-row"><span>活动</span><span>问题</span><span>关于</span></div>
        <div className="hero-content">
          <p className="kicker">A CONVERSATION ABOUT HOW WE LIVE</p>
          <h1>你在做什么？<br /><em>怎么做？</em></h1>
          <p className="subtitle">一场关于多元工作、多元收入，以及我们正在怎样活着的聊天</p>
          <div className="intro-panel win-inset">
            <p>越来越难用一句「我是做什么的」来描述一个人了。</p>
            <p>有人还在公司里，同时接项目、做内容、做自己的产品；有人 gap，有人在失业；也有人做着零零碎碎的小事，它们拼在一起，构成了一种生活。</p>
            <p>这次我们不歌颂自由职业，也不急着预测 AI 会不会让人失业。我们先把每个人真实的工作、收入、时间、风险、选择和关系摊开来看。</p>
          </div>
          <div className="hero-actions">
            <a className="os-button primary" href={sitePath("/join")}>✎ 我来回答</a>
            <a className="os-button" href={sitePath("/host")}>▣ 打开主持屏</a>
            <a className="os-button" href={sitePath("/archive")}>▤ 查看历史回答</a>
          </div>
          <p className="hero-note">先让观点出现，再决定哪些人需要说话。</p>
        </div>
      </WindowFrame>

      <aside className="sticky-note">
        <b>现场使用说明</b>
        <p>1. 主持人打开「主持展示」</p>
        <p>2. 大家扫码进入</p>
        <p>3. 回答先匿名出现</p>
        <p>4. 点「想听展开」</p>
      </aside>

      <section className="question-map" id="questions">
        <WindowFrame title="十个问题 — 从生存现场走向新的默认答案">
          <div className="question-list">
            {questions.map((question) => (
              <div className="question-file" key={question.id}>
                <span className="file-number">{question.number}</span>
                <div><small>{question.eyebrow}</small><strong>{question.title}</strong></div>
              </div>
            ))}
          </div>
          <div className="closing-copy">
            <p>我们先把每个人真实的经验放在一起。</p>
            <strong>未来的工作可能还没有名字，<br />但新的生活方式，已经零零碎碎地发生了。</strong>
          </div>
        </WindowFrame>
      </section>
      <Taskbar mode="landing" />
    </main>
  );
}

function getParticipantId() {
  if (typeof window === "undefined") return "";
  const key = "polywork-participant-id";
  let id = window.localStorage.getItem(key);
  if (!id) {
    if (globalThis.crypto?.randomUUID) {
      id = globalThis.crypto.randomUUID();
    } else if (globalThis.crypto?.getRandomValues) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    } else {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
    window.localStorage.setItem(key, id);
  }
  return id;
}

function initialData(question: Question): AnswerData {
  if (question.type === "spectrum") return { value: 50, reason: "" };
  if (question.type === "dual") return { comfortable: "", tired: "" };
  if (question.type === "earning") return { story: "", amount: "", again: "" };
  if (question.type === "poll") return { choice: "", note: "" };
  if (question.type === "value") return { value: "", ai: "" };
  return { text: "" };
}

function ResponseContent({ response, question }: { response: EventResponse; question: Question }) {
  const data = response.data;
  if (question.type === "dual") return <><p><b>舒服：</b>{String(data.comfortable || "—")}</p><p><b>真累：</b>{String(data.tired || "—")}</p></>;
  if (question.type === "earning") return <><p><b>这件事：</b>{String(data.story || "—")}</p><p><b>赚了：</b>{String(data.amount || "—")}</p><p className="muted-line">还想再做吗：{String(data.again || "还没回答")}</p></>;
  if (question.type === "spectrum") return <><p className="spectrum-answer"><b>{Number(data.value) < 50 ? "更接近被逼无奈" : Number(data.value) > 50 ? "更接近主动选择" : "就在中间"}</b><span>{String(data.value)} / 100</span></p>{data.reason ? <p>{String(data.reason)}</p> : null}</>;
  if (question.type === "poll") return <><p><b>{String(data.choice || "未选择")}</b></p>{data.note ? <p>{String(data.note)}</p> : null}</>;
  if (question.type === "value") return <><p><b>最值钱：</b>{String(data.value || "—")}</p><p className="muted-line">AI：{String(data.ai || "还没判断")}</p></>;
  return <p>{String(data.text || "")}</p>;
}

function ResponseCard({ response, question, participantId, host, readOnly, onAction }: {
  response: EventResponse;
  question: Question;
  participantId: string;
  host?: boolean;
  readOnly?: boolean;
  onAction: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const own = response.participantId === participantId;
  return (
    <article className={`response-card ${response.highlighted ? "highlighted" : ""} ${response.hidden ? "hidden-card" : ""}`}>
      <div className="card-topline">
        <span>{response.highlighted ? "★ 主持人正在看这条" : own ? "这是我的回答" : "匿名回答"}</span>
        {response.hidden ? <span>已隐藏</span> : null}
      </div>
      <ResponseContent response={response} question={question} />
      <div className="card-actions">
        {!host && !readOnly && !response.hidden ? (
          <button className={`listen-button ${response.reacted ? "active" : ""}`} onClick={() => onAction({ action: "react", responseId: response.id, participantId })}>
            ◉ 想听展开 <b>{response.reactionCount || ""}</b>
          </button>
        ) : null}
        {host && !readOnly ? <>
          <button className="tiny-button" onClick={() => onAction({ action: "moderate", responseId: response.id, field: "highlighted", value: !response.highlighted })}>{response.highlighted ? "取消高亮" : "高亮"}</button>
          <button className="tiny-button" onClick={() => onAction({ action: "moderate", responseId: response.id, field: "hidden", value: !response.hidden })}>{response.hidden ? "恢复" : "隐藏"}</button>
          <span className="host-votes">◉ {response.reactionCount}</span>
        </> : null}
      </div>
    </article>
  );
}

function PollSummary({ question, responses }: { question: Question; responses: EventResponse[] }) {
  const key = question.type === "value" ? "ai" : "choice";
  const options = question.options ?? [];
  const visible = responses.filter((response) => !response.hidden);
  const counts = options.map((option) => visible.filter((response) => response.data[key] === option).length);
  const max = Math.max(...counts, 1);
  return <div className="poll-summary">{options.map((option, index) => <div className="poll-row" key={option}>
    <div className="poll-label"><span>{option}</span><b>{counts[index]}</b></div>
    <div className="poll-track win-inset"><span style={{ width: `${(counts[index] / max) * 100}%` }} /></div>
  </div>)}</div>;
}

function SpectrumSummary({ responses }: { responses: EventResponse[] }) {
  const visible = responses.filter((response) => !response.hidden);
  const average = visible.length ? Math.round(visible.reduce((sum, response) => sum + Number(response.data.value || 0), 0) / visible.length) : 0;
  return <div className="spectrum-summary">
    <div className="spectrum-labels"><span>被逼无奈</span><span>主动选择</span></div>
    <div className="spectrum-line win-inset">
      {visible.map((response, index) => <span className="spectrum-dot" key={response.id} style={{ left: `${response.data.value}%`, top: `${8 + (index % 3) * 19}px` }} title={String(response.data.value)} />)}
    </div>
    <p>{visible.length ? `现场平均位置：${average} / 100` : "还没有人放下自己的位置"}</p>
  </div>;
}

function Participant() {
  const [participantId] = useState(getParticipantId);
  const [selectedQuestion, setSelectedQuestion] = useState<number | undefined>(undefined);
  const [mode] = useState<EventMode>(eventMode);
  const { snapshot, setSnapshot, error, ready, refresh } = useSnapshot(participantId, participantApiEndpoint(), selectedQuestion, mode);
  const [form, setForm] = useState<AnswerData>(initialData(snapshot.question));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const hydratedRef = useRef("");
  const own = snapshot.responses.find((response) => response.participantId === participantId);

  useEffect(() => {
    if (!ready || selectedQuestion !== undefined) return;
    const timer = window.setTimeout(() => setSelectedQuestion(snapshot.questionIndex), 0);
    return () => window.clearTimeout(timer);
  }, [ready, selectedQuestion, snapshot.questionIndex]);

  useEffect(() => {
    const key = `${snapshot.question.id}:${own?.updatedAt ?? "new"}`;
    if (hydratedRef.current !== key) {
      setForm(own?.data ?? initialData(snapshot.question));
      setSaved(Boolean(own));
      hydratedRef.current = key;
    }
  }, [snapshot.question, own]);

  const act = async (payload: Record<string, unknown>) => {
    setSnapshot(await sendAction({ ...payload, viewQuestionIndex: snapshot.questionIndex }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "static") return;
    if (!participantId) return;
    setSaving(true);
    try {
      setSnapshot(await sendAction({ action: "submit", participantId, questionId: snapshot.question.id, data: form, viewQuestionIndex: snapshot.questionIndex }));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="desktop participant-desktop">
      <div className="mobile-shell">
        <header className="mobile-header">
          <a href={sitePath("/")} aria-label="返回活动首页">✦</a>
          <div><b>共同回答</b><span>我在第 {snapshot.questionIndex + 1} 题 / 共 {snapshot.totalQuestions} 题</span></div>
          <div className="participant-header-actions">
            <span className={`live-pill ${error ? "offline" : ""}`}>{error ? "读取失败" : "已读取"}</span>
            <button className="refresh-button" type="button" onClick={() => void refresh()}>刷新</button>
          </div>
        </header>
        <div className="progress-track"><span style={{ width: `${((snapshot.questionIndex + 1) / snapshot.totalQuestions) * 100}%` }} /></div>
        {!ready ? <div className="connecting win-outset">正在进入现场……</div> : <>
          <nav className="participant-question-nav win-outset" aria-label="选择要回答的问题">
            <div className="participant-question-nav-copy">
              <b>你可以自由选择回答哪一题</b>
              <span>主持人切题不会打断你正在写的内容</span>
            </div>
            <div className="participant-question-picker">
              {questions.map((question, index) => (
                <button
                  className={index === snapshot.questionIndex ? "active" : ""}
                  key={question.id}
                  type="button"
                  onClick={() => setSelectedQuestion(index)}
                  aria-label={`查看第 ${index + 1} 题：${question.title}`}
                >{index + 1}</button>
              ))}
            </div>
          </nav>
          <section className="participant-question">
            <p className="question-eyebrow">{snapshot.question.number} / {snapshot.question.eyebrow}</p>
            <h1>{snapshot.question.title}</h1>
            <p className="question-prompt">{snapshot.question.prompt}</p>
            <p className="short-intro">{snapshot.question.intro[0]}</p>
          </section>
          <form className="answer-form win-outset" onSubmit={submit}>
            <div className="title-bar small"><strong>{mode === "static" ? "历史数据只读" : saved ? "修改我的回答" : "写下我的回答"}</strong><span>{mode === "static" ? "活动已结束" : "匿名提交"}</span></div>
            <div className="form-body">
              <fieldset disabled={mode === "static"} className="static-fieldset">
                <QuestionFields question={snapshot.question} form={form} setForm={setForm} />
                <button className="os-button primary submit-button" disabled={saving || mode === "static"}>{mode === "static" ? "活动已结束" : saving ? "正在放到大屏幕……" : saved ? "保存修改" : "匿名提交"}</button>
              </fieldset>
              {mode === "static" ? <p className="saved-note static-note">这是活动结束后的历史档案，当前不接受新回答。</p> : saved ? <p className="saved-note">✓ 已经出现在现场。你可以继续修改。</p> : null}
            </div>
          </form>
          <section className="others-section">
            <div className="section-heading"><div><span>COLLECTIVE RESPONSES</span><h2>大家正在怎么想</h2></div><b>{snapshot.responses.filter((response) => !response.hidden).length} 条</b></div>
            {!snapshot.state.revealAnswers ? <div className="answers-closed win-inset">主持人暂时收起了回答。<br />先留一点安静思考的时间。</div> :
              <div className="response-grid participant-grid">
                {snapshot.responses.filter((response) => !response.hidden).map((response) => <ResponseCard key={response.id} response={response} question={snapshot.question} participantId={participantId} readOnly={mode === "static"} onAction={act} />)}
                {!snapshot.responses.some((response) => !response.hidden) ? <p className="empty-copy">这里还是空的。也许你会写下第一句。</p> : null}
              </div>}
          </section>
          <div className="participant-step-nav">
            <button className="os-button" type="button" disabled={snapshot.questionIndex === 0} onClick={() => setSelectedQuestion(snapshot.questionIndex - 1)}>← 上一题</button>
            <button className="os-button primary" type="button" disabled={snapshot.questionIndex === snapshot.totalQuestions - 1} onClick={() => setSelectedQuestion(snapshot.questionIndex + 1)}>下一题 →</button>
          </div>
        </>}
      </div>
    </main>
  );
}

function QuestionFields({ question, form, setForm }: { question: Question; form: AnswerData; setForm: React.Dispatch<React.SetStateAction<AnswerData>> }) {
  const update = (key: string, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  if (question.type === "dual") return <div className="dual-fields">
    <label><span>☺ 最近一次觉得“真舒服”</span><textarea value={String(form.comfortable ?? "")} onChange={(event) => update("comfortable", event.target.value)} placeholder="写一个具体的瞬间……" maxLength={1000} /></label>
    <label><span>☹ 最近一次觉得“真累”</span><textarea value={String(form.tired ?? "")} onChange={(event) => update("tired", event.target.value)} placeholder="也写一个具体的瞬间……" maxLength={1000} /></label>
  </div>;
  if (question.type === "earning") return <>
    <div className="dual-fields">
      <label><span>这是什么活？为什么让你满意或觉得有趣？</span><textarea value={String(form.story ?? "")} onChange={(event) => update("story", event.target.value)} placeholder={question.placeholder} maxLength={1400} required /></label>
      <label><span>这个活最后赚了多少钱？</span><textarea value={String(form.amount ?? "")} onChange={(event) => update("amount", event.target.value)} placeholder="可以写具体数字，也可以写一个大概范围" maxLength={300} /></label>
    </div>
    <p className="field-question">如果再有一次机会，你还想做吗？</p>
    <div className="option-stack">{["还想再做", "看条件", "不太想", "不知道"].map((option) => <label className={`option-button ${form.again === option ? "selected" : ""}`} key={option}>
      <input type="radio" name="again" value={option} checked={form.again === option} onChange={() => update("again", option)} />
      <span className="radio-dot" />{option}
    </label>)}</div>
  </>;
  if (question.type === "spectrum") return <>
    <div className="range-labels"><span>被逼无奈</span><b>{String(form.value)}</b><span>主动选择</span></div>
    <input className="range-input" type="range" min="0" max="100" value={Number(form.value ?? 50)} onChange={(event) => update("value", Number(event.target.value))} />
    <label className="field-label"><span>为什么把自己放在这里？（可选）</span><textarea value={String(form.reason ?? "")} onChange={(event) => update("reason", event.target.value)} placeholder={question.placeholder} maxLength={1000} /></label>
  </>;
  if (question.type === "poll" || question.type === "value") {
    const textKey = question.type === "value" ? "value" : "note";
    const optionKey = question.type === "value" ? "ai" : "choice";
    return <>
      {question.type === "value" ? <label className="field-label"><span>我最值钱的是</span><textarea value={String(form[textKey] ?? "")} onChange={(event) => update(textKey, event.target.value)} placeholder={question.placeholder} maxLength={1000} /></label> : null}
      <div className="option-stack">{question.options?.map((option) => <label className={`option-button ${form[optionKey] === option ? "selected" : ""}`} key={option}>
        <input type="radio" name={optionKey} value={option} checked={form[optionKey] === option} onChange={() => update(optionKey, option)} />
        <span className="radio-dot" />{option}
      </label>)}</div>
      {question.type === "poll" ? <label className="field-label"><span>如果未来五年的生活费已经有了，你最想怎样重新分配时间？</span><textarea value={String(form.note ?? "")} onChange={(event) => update("note", event.target.value)} placeholder={question.placeholder} maxLength={1000} /></label> : null}
    </>;
  }
  return <label className="field-label"><span>你的回答</span><textarea value={String(form.text ?? "")} onChange={(event) => update("text", event.target.value)} placeholder={question.placeholder} maxLength={1400} required /></label>;
}

function Host() {
  const [mode] = useState<EventMode>(eventMode);
  const [hostQuestionIndex, setHostQuestionIndex] = useState<number | undefined>(undefined);
  const { snapshot, setSnapshot, error, ready, refresh } = useSnapshot("host", "/api/host-action", hostQuestionIndex, mode);
  const [showHome, setShowHome] = useState(true);
  const [qr, setQr] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [hostError, setHostError] = useState("");
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      setCols(width <= 640 ? 1 : width <= 980 ? 2 : 3);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    if (!snapshot.joinUrl) return;
    const timer = window.setTimeout(() => setJoinUrl(snapshot.joinUrl ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, [snapshot.joinUrl]);
  useEffect(() => {
    if (!joinUrl) return;
    void QRCode.toDataURL(joinUrl, { width: 260, margin: 1, color: { dark: "#271744", light: "#ffffff" } }).then(setQr);
  }, [joinUrl]);
  const act = async (payload: Record<string, unknown>) => {
    if (mode === "static") return;
    try {
      setSnapshot(await sendHostAction(payload));
      setHostError("");
    } catch (nextError) {
      setHostError(nextError instanceof Error ? nextError.message : "主持操作没有完成");
    }
  };
  const goToQuestion = async (index: number) => {
    setShowHome(false);
    if (mode === "static") {
      setHostQuestionIndex(index);
      return;
    }
    await act({ action: "setQuestion", index });
  };
  const goPrevious = async () => {
    if (showHome) return;
    if (snapshot.state.activeQuestion === 0) {
      setShowHome(true);
      return;
    }
    await goToQuestion(snapshot.state.activeQuestion - 1);
  };
  const goNext = async () => {
    if (showHome) {
      await goToQuestion(0);
      return;
    }
    await goToQuestion(snapshot.state.activeQuestion + 1);
  };
  const visibleResponses = useMemo(() => snapshot.responses.filter((response) => !response.hidden), [snapshot.responses]);
  const distributeColumns = (items: EventResponse[]) => {
    const buckets: EventResponse[][] = Array.from({ length: cols }, () => []);
    items.forEach((item, index) => buckets[index % cols].push(item));
    return buckets;
  };

  return (
    <main className="desktop host-desktop">
      <div className="host-layout">
        <section className="host-stage">
          <div className="host-topline">
            <span className={`live-pill ${error ? "offline" : ""}`}>{error ? "读取失败" : mode === "static" ? "历史只读" : "手动读取"}</span>
            <span>{showHome ? "先从我们为什么来到这里开始" : `${visibleResponses.length} 人已经回答`}</span>
            <button className="text-button" onClick={() => void refresh()}>刷新现场 ↻</button>
            <button className="text-button" onClick={() => document.documentElement.requestFullscreen?.()}>全屏展示 ↗</button>
          </div>
          {showHome ? <section className="host-home">
            <p className="question-eyebrow">POLYWORK · INCOME · LIFE</p>
            <h1>你在做什么？<br />怎么做？</h1>
            <h2>一场关于多元工作、多元收入，以及我们正在怎样活着的聊天</h2>
            <div className="host-home-copy">
              <p>越来越难用一句“我是做什么的”来描述一个人了。有人还在公司里，同时接项目、做内容、做自己的产品；有人 gap、失业或主动离开公司；也有人做着许多无法被一个职业名称概括的小事。</p>
              <p>这些变化不完全是主动选择。经济环境、就业市场和 AI 正在一起改变工作的组织方式。一个人可以完成的事情变多了，原来由公司提供的收入、身份、客户、协作关系、保险与风险承担，也越来越多地落回个人身上。</p>
              <p>所以，我们不准备歌颂某一种自由职业，也不急着预测 AI 会不会让人失业。我们想先把在场每个人真实的工作、收入、时间、选择、风险和关系摊开来看。</p>
              <p>有人正在主动离开组织，有人正在寻找进入组织的机会；有人试验新的方式，也有人暂时掉在旧系统和新系统之间。这些状态都真实存在。</p>
            </div>
            <blockquote>未来的工作可能还没有名字，但新的生活方式，已经零零碎碎地发生了。</blockquote>
            <button className="home-start-button os-button primary" type="button" onClick={() => void goToQuestion(0)}>从第 01 题开始 →</button>
          </section> : <>
            <div className="host-question">
              <p className="question-eyebrow">QUESTION {snapshot.question.number} / {snapshot.question.eyebrow}</p>
              <h1>{snapshot.question.title}</h1>
              <div className="host-intro">{snapshot.question.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              <blockquote>{snapshot.question.prompt}</blockquote>
            </div>

            <section className="host-results">
              <div className="section-heading host-heading"><div><span>COLLECTIVE RESPONSES</span><h2>{snapshot.state.revealAnswers ? "大家的回答正在长出来" : "先各自想一想"}</h2></div><b>{visibleResponses.length} 条</b></div>
              {!snapshot.state.revealAnswers ? <div className="answers-closed large win-inset">回答暂时藏起来了。<br /><small>主持人可以在大家提交后一起揭晓。</small></div> : <>
                {snapshot.question.type === "spectrum" ? <SpectrumSummary responses={snapshot.responses} /> : null}
                {snapshot.question.type === "poll" || snapshot.question.type === "value" ? <PollSummary question={snapshot.question} responses={snapshot.responses} /> : null}
                <div className="response-grid host-grid">
                  {distributeColumns(snapshot.responses).map((columnItems, columnIndex) => <div className="host-col" key={columnIndex}>
                    {columnItems.map((response) => <ResponseCard key={response.id} response={response} question={snapshot.question} participantId="host" host readOnly={mode === "static"} onAction={act} />)}
                  </div>)}
                  {!snapshot.responses.length ? <div className="empty-stage">等待第一条回答<span className="blink-cursor">▮</span></div> : null}
                </div>
              </>}
            </section>
          </>}
        </section>

        <aside className="host-sidebar">
          <WindowFrame title="主持控制台">
            <div className="control-body">
              <div className="qr-block win-inset">{mode === "static" ? <span className="static-qr-label">历史档案<br />只读展示</span> : qr ? <img src={qr} alt={`参与者入口二维码：${joinUrl}`} width={174} height={174} /> : null}</div>
              <p className="join-label">{mode === "static" ? "活动已结束 · 不接受新回答" : "扫码加入 · 无需注册"}</p>
              {mode === "live" ? <>
                <input className="join-url-input win-inset" aria-label="参与者网址" value={joinUrl} onChange={(event) => setJoinUrl(event.target.value)} />
                {joinUrl.includes("localhost") ? <p className="network-warning">手机无法打开 localhost。现场使用时，请把这里换成这台电脑的局域网网址。</p> : null}
              </> : <p className="static-mode-note">当前页面只读取项目中保存的现场数据，不会访问腾讯云。</p>}
              <div className="control-divider" />
              <p className="control-label">当前问题</p>
              <div className="question-picker">
                <button className={`home-picker-button ${showHome ? "active" : ""}`} type="button" onClick={() => setShowHome(true)}>首页</button>
                {questions.map((question, index) => <button className={!showHome && index === snapshot.state.activeQuestion ? "active" : ""} key={question.id} onClick={() => void goToQuestion(index)} title={question.title}>{question.number}</button>)}
              </div>
              <div className="nav-controls">
                <button className="os-button" disabled={showHome} onClick={() => void goPrevious()}>← {snapshot.state.activeQuestion === 0 ? "回首页" : "上一题"}</button>
                <button className="os-button primary" disabled={!showHome && snapshot.state.activeQuestion === snapshot.totalQuestions - 1} onClick={() => void goNext()}>{showHome ? "开始 →" : "下一题 →"}</button>
              </div>
              {!showHome && mode === "live" ? <button className="os-button wide-button" onClick={() => act({ action: "setReveal", value: !snapshot.state.revealAnswers })}>{snapshot.state.revealAnswers ? "◉ 暂时收起所有回答" : "◎ 展示所有回答"}</button> : null}
              {hostError ? <p className="host-error">{hostError}</p> : null}
              <div className="control-divider" />
              <details className="discussion-prompts" open>
                <summary>{showHome ? "这场活动怎样进行" : "可以继续聊"}</summary>
                <ul>{showHome ? <>
                  <li>主持人提出问题，大家先在手机上同时思考和匿名回答。</li>
                  <li>回答进入公共屏幕以后，我们一起寻找重复、差异和意外。</li>
                  <li>先让观点出现，再邀请愿意的人把某条回答展开。</li>
                </> : snapshot.question.discussion.map((item) => <li key={item}>{item}</li>)}</ul>
              </details>
              {!ready ? <p className="control-status">正在准备现场数据……</p> : <p className="control-status">✓ {mode === "static" ? "当前是历史数据只读模式" : showHome ? "准备好后，从第 01 题开始" : "参与者可自由选择题目"}</p>}
            </div>
          </WindowFrame>
        </aside>
      </div>
    </main>
  );
}

export default function EventApp({ mode }: { mode: Mode }) {
  if (mode === "participant") return <Participant />;
  if (mode === "host") return <Host />;
  return <Landing />;
}
