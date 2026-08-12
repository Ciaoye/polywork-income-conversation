import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function render(pathname) {
  workerUrl.searchParams.set("test", `${pathname}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the activity landing page with both live entry points", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>你在做什么？怎么做？｜多元工作与多元收入聊天会<\/title>/);
  assert.match(html, /一场关于多元工作、多元收入/);
  assert.match(html, /href="\/join"/);
  assert.match(html, /href="\/host"/);
  assert.match(html, /九个问题/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("renders participant and host presentation shells", async () => {
  const [joinResponse, hostResponse] = await Promise.all([render("/join"), render("/host")]);
  assert.equal(joinResponse.status, 200);
  assert.equal(hostResponse.status, 200);
  const joinHtml = await joinResponse.text();
  const hostHtml = await hostResponse.text();
  assert.match(joinHtml, /共同回答/);
  assert.match(joinHtml, /正在进入现场/);
  assert.match(hostHtml, /主持控制台/);
  assert.match(hostHtml, /全屏展示/);
  assert.match(hostHtml, /可以继续聊/);
});

test("ships an absolute share-card URL derived from the request host", async () => {
  const response = await render("/");
  const html = await response.text();
  assert.match(html, /property="og:image" content="http:\/\/localhost\/og.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
});
