"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- this app uses plain internal anchors for the static participant build */

import { useEffect, useMemo, useState } from "react";
import { questions, type Question } from "../lib/questions";
import { sitePath } from "../lib/site-paths";

type ArchiveRow = {
  _id: string;
  kind: "state" | "response" | "reaction";
  questionId?: string;
  participantId?: string;
  responseId?: string;
  data?: Record<string, string | number>;
  hidden?: boolean;
  highlighted?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const interpretations: Record<string, string> = {
  "self-introduction": "自我介绍里出现了学生、老师、无业游民、研究者、做很多零碎事情的人等说法。职业名称无法覆盖这些人的真实活动，大家更常用正在做的事、兴趣和关系来描述自己。",
  "income-map": "生存来源包含工资、项目、教育服务、家庭支持、存款和资源交换。回答把“收入”扩展成一张生活条件的地图：谁提供支持、哪些资源托底、哪些工作承担现金流，都属于活着的方式。",
  "choice-spectrum": "35 个位置的平均值是 62.8 / 100，整体略偏向主动选择，仍有一批回答停留在中间位置。主动性和环境推力同时存在，工作方式往往是长期调整后的结果。",
  "earning-story": "具体赚钱经验从体力劳动、教育服务到临时项目都有。满意感经常来自过程、关系和自由度，金额只是评价这段经历的一部分。",
  "body-memory": "舒服的时刻集中在自主安排、拿到报酬、与合适的人合作；疲惫更多来自等待、关系消耗、面对家人和失去控制感。工作体验与组织方式紧密相连。",
  "one-year-buffer": "当生存压力被拿开五年，8 人选择几乎不变，9 人会减少或重新组合工作，4 人会换一种活法，另有 2 人仍不确定。安全感带来选择空间，也带来重新分配时间的问题。",
  "solo-company": "回答里频繁出现写代码、做网站、做研究、剪视频和内容生产。一个人承担的生产环节变多了，客户、信用、协作、保险和风险分担仍需要新的组织方式。",
  "valuable-thing": "22 个回答里有 16 个认为最值钱的能力暂时不太容易被 AI 替代。被反复提到的是想象力、审美、判断、沟通、信任与共情，这些能力依赖长期经验和具体关系。",
  enough: "大家对“成了”的描述集中在托底、拒绝权、时间控制和不被单一客户绑住。目标经常是一种可持续的身体感受与选择权，数字收入只是其中一个指标。",
  "new-default": "新的默认答案还没有收敛：有人想要项目制和合作网络，有人重视基本保障、公共支持与互相依赖。共同方向是让生活不再只围绕一份职位来组织。",
};

function responseText(question: Question, data: Record<string, string | number>) {
  if (question.type === "dual") return `舒服：${data.comfortable || "—"}\n真累：${data.tired || "—"}`;
  if (question.type === "earning") return `这件事：${data.story || "—"}\n赚了：${data.amount || "—"}\n还想再做：${data.again || "未回答"}`;
  if (question.type === "spectrum") return `${data.value ?? "—"} / 100${data.reason ? `\n${data.reason}` : ""}`;
  if (question.type === "poll") return `${data.choice || "未选择"}${data.note ? `\n${data.note}` : ""}`;
  if (question.type === "value") return `最值钱：${data.value || "—"}\nAI：${data.ai || "未判断"}`;
  return String(data.text || "");
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function ArchivePollSummary({ question, rows }: { question: Question; rows: ArchiveRow[] }) {
  const key = question.type === "value" ? "ai" : "choice";
  const options = question.options ?? [];
  const visible = rows.filter((row) => !row.hidden);
  const counts = options.map((option) => visible.filter((row) => row.data![key] === option).length);
  const max = Math.max(...counts, 1);
  return <div className="poll-summary">{options.map((option, index) => <div className="poll-row" key={option}>
    <div className="poll-label"><span>{option}</span><b>{counts[index]}</b></div>
    <div className="poll-track win-inset"><span style={{ width: `${(counts[index] / max) * 100}%` }} /></div>
  </div>)}</div>;
}

function ArchiveSpectrumSummary({ rows }: { rows: ArchiveRow[] }) {
  const visible = rows.filter((row) => !row.hidden);
  const average = visible.length ? Math.round(visible.reduce((sum, row) => sum + Number(row.data!.value || 0), 0) / visible.length) : 0;
  return <div className="spectrum-summary">
    <div className="spectrum-labels"><span>被逼无奈</span><span>主动选择</span></div>
    <div className="spectrum-line win-inset">
      {visible.map((row, index) => <span className="spectrum-dot" key={row._id} style={{ left: `${Number(row.data!.value) || 0}%`, top: `${8 + (index % 3) * 19}px` }} title={String(row.data!.value)} />)}
    </div>
    <p>{visible.length ? `现场平均位置：${average} / 100` : "还没有人放下自己的位置"}</p>
  </div>;
}

export default function ArchiveApp() {
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [selected, setSelected] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});
  const [cols, setCols] = useState(3);

  useEffect(() => {
    fetch(typeof window === "undefined" ? "/polywork-events.json" : (window.__POLYWORK_STATIC_DATA_URL__ || sitePath("/polywork-events.json")))
      .then((response) => {
        if (!response.ok) throw new Error("历史数据文件暂时无法读取");
        return response.text();
      })
      .then((text) => {
        // CloudBase exported newline-delimited JSON (one document per line).
        const parsed = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ArchiveRow);
        setRows(parsed);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "历史数据暂时无法读取"));
  }, []);

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      setCols(width <= 640 ? 1 : width <= 980 ? 2 : 3);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const responses = useMemo(() => rows.filter((row) => row.kind === "response" && row.questionId && row.data), [rows]);
  const reactions = useMemo(() => {
    const counts = new Map<string, number>();
    rows.filter((row) => row.kind === "reaction" && row.responseId).forEach((row) => counts.set(row.responseId!, (counts.get(row.responseId!) || 0) + 1));
    return counts;
  }, [rows]);
  const participants = useMemo(() => new Set(responses.map((row) => row.participantId)).size, [responses]);
  const visibleQuestions = selected === "all" ? questions : questions.filter((question) => question.id === selected);
  const query = search.trim().toLowerCase();
  const matches = (row: ArchiveRow) => !query || responseText(questions.find((question) => question.id === row.questionId)!, row.data!).toLowerCase().includes(query);
  const distributeColumns = (items: ArchiveRow[]) => {
    const buckets: ArchiveRow[][] = Array.from({ length: cols }, () => []);
    items.forEach((item, index) => buckets[index % cols].push(item));
    return buckets;
  };

  return (
    <main className="archive-page">
      <header className="archive-header">
        <div className="archive-topline"><a href={sitePath("/")}>← 回到活动首页</a><span>POLYWORK · INCOME · LIFE / ARCHIVE</span></div>
        <p className="question-eyebrow">历史回答 · 现场回看</p>
        <h1>大家是怎么活着的？</h1>
        <p className="archive-lead">这里保存了活动现场留下的回答。它们按照十个问题重新排在一起，方便回看每个人的具体经验，也方便从重复出现的词语、差异和停顿里，继续理解这场讨论。</p>
        <div className="archive-stats">
          <div><b>{responses.length}</b><span>条回答</span></div>
          <div><b>{participants}</b><span>位参与者</span></div>
          <div><b>10</b><span>个问题</span></div>
          <div><b>2026</b><span>现场记录</span></div>
        </div>
      </header>

      <section className="archive-summary">
        <p className="archive-label">整体观察 / READING NOTES</p>
        <h2>从职业标签，走向生活结构</h2>
        <div className="archive-summary-grid">
          <p>回答里的“工作”很少是一条单线。工资、项目、家庭支持、存款、关系和兴趣交叠在一起，构成了每个人当下的生存结构。</p>
          <p>大家谈论自由时，常常同时谈到风险、等待、关系消耗和照顾责任。舒服与疲惫来自工作的组织方式，也来自谁在提供托底。</p>
          <p>AI 让一个人能完成更多生产环节，稀缺性却逐渐转向判断、信任、审美、共情和长期经验。新的协作与保障仍在寻找形状。</p>
        </div>
      </section>

      <section className="archive-controls" aria-label="筛选历史回答">
        <label>查看问题
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="all">全部十个问题</option>
            {questions.map((question) => <option key={question.id} value={question.id}>{question.number} {question.title}</option>)}
          </select>
        </label>
        <label>搜索回答
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工作、钱、AI……" />
        </label>
      </section>

      {error ? <p className="archive-error">{error}</p> : null}
      {!rows.length && !error ? <p className="archive-loading">正在打开历史档案……</p> : null}
      <section className="archive-sections">
        {visibleQuestions.map((question) => {
          const questionResponses = responses.filter((row) => row.questionId === question.id && matches(row));
          const orderedResponses = [...questionResponses].sort((left, right) => {
            const reactionDifference = (reactions.get(right._id) || 0) - (reactions.get(left._id) || 0);
            if (reactionDifference) return reactionDifference;
            const highlightedDifference = Number(Boolean(right.highlighted)) - Number(Boolean(left.highlighted));
            if (highlightedDifference) return highlightedDifference;
            return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
          });
          const expanded = Boolean(expandedQuestions[question.id]);
          const displayedResponses = expanded ? orderedResponses : orderedResponses.slice(0, 6);
          return <article className="archive-question" key={question.id}>
            <div className="archive-question-heading"><div><p className="question-eyebrow">{question.number} / {question.eyebrow}</p><h2>{question.title}</h2></div><b>{questionResponses.length} 条</b></div>
            <div className="archive-question-copy">
              <div className="archive-question-intro">{question.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              <blockquote className="archive-question-prompt">{question.prompt}</blockquote>
            </div>
            <p className="archive-interpretation"><b>回看这组回答：</b>{interpretations[question.id]}</p>
            <details className="archive-discussion">
              <summary>这个问题还可以怎么继续聊</summary>
              <ul>{question.discussion.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
            {question.type === "spectrum" ? <ArchiveSpectrumSummary rows={questionResponses} /> : null}
            {question.type === "poll" || question.type === "value" ? <ArchivePollSummary question={question} rows={questionResponses} /> : null}
            <div className="archive-response-grid">
              {distributeColumns(displayedResponses).map((columnItems, columnIndex) => <div className="archive-response-col" key={columnIndex}>
                {columnItems.map((row) => <article className={`archive-response ${row.highlighted ? "is-highlighted" : ""}`} key={row._id}>
                  <div className="archive-response-meta"><span>{row.highlighted ? "★ 现场高亮" : "匿名回答"}</span><span>{formatDate(row.createdAt)}</span></div>
                  <p>{responseText(question, row.data!)}</p>
                  <div className="archive-response-foot"><span>◉ {reactions.get(row._id) || 0} 次回应</span></div>
                </article>)}
              </div>)}
              {!questionResponses.length ? <p className="archive-empty">没有匹配的回答。</p> : null}
            </div>
            {orderedResponses.length > 6 ? <button className="archive-more-button" type="button" onClick={() => setExpandedQuestions((current) => ({ ...current, [question.id]: !expanded }))}>{expanded ? "收起回答 ↑" : `查看更多（还有 ${orderedResponses.length - 6} 条） ↓`}</button> : null}
          </article>;
        })}
      </section>
      <footer className="archive-footer"><a href={sitePath("/join")}>回到参与者入口</a><span>按十个问题整理的现场回答、背景文字与讨论线索。</span></footer>
    </main>
  );
}
