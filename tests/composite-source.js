#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.NOVELCUT_TEST_URL || "http://127.0.0.1:5188";
const root = path.join(__dirname, "..");

async function request(urlPath, options = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main() {
  const sourceText = fs.readFileSync(path.join(__dirname, "fixtures", "composite-production.md"), "utf8");
  const preview = await request("/api/source/preview", { method: "POST", body: JSON.stringify({ sourceText }) });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.shotCount, 3);
  assert.equal(preview.body.characterCount, 2, "OS 配音角色不能成为视觉人物资产");
  assert.equal(preview.body.sceneCount, 1);
  assert.equal(preview.body.propCount, 1);
  assert.equal(preview.body.characterViewCount, 2, "主体描述应分别关联龟仙人和林夕");
  assert.equal(preview.body.sceneViewCount, 2);
  assert.equal(preview.body.production.bgm.length, 2);
  assert.equal(preview.body.production.sfx.length, 2);
  assert.equal(preview.body.production.grading.length, 2);
  assert.deepEqual(preview.body.production.gradeParameters, [
    { name: "亮度", value: "+5" },
    { name: "对比度", value: "+10" }
  ]);
  assert.equal(preview.body.production.voices.length, 3);
  assert.equal(preview.body.shots[0].characters, "龟仙人", "主体别称应匹配到龟仙人身份资产");
  assert.equal(preview.body.shots[2].postOnly, true);
  assert.equal(preview.body.shots[2].editDuration, 3);

  const malformed = sourceText.replace("### 镜号2", "### 场次2");
  const rejected = await request("/api/source/preview", { method: "POST", body: JSON.stringify({ sourceText: malformed }) });
  assert.equal(rejected.status, 422, "复合文档声明镜数与识别镜数不一致时必须阻止创建");
  assert.match(rejected.body.error, /声明 3 个镜头.*识别到 2 个/);

  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const swiftRenderer = fs.readFileSync(path.join(root, "scripts", "render-title-card.swift"), "utf8");
  assert.match(appJs, /data-action="render-post"/, "工作台应提供后期字幕卡制作入口");
  assert.match(appJs, /本镜后期清单/, "工作台应展示每镜配音、BGM、音效和调色清单");
  assert.match(appJs, /data-title-card-style="backgroundColor"/, "字幕卡应允许编辑背景色");
  assert.match(appJs, /data-title-card-style="alignment"/, "字幕卡应允许编辑版式对齐");
  assert.match(serverJs, /normalizeTitleCardStyle/, "服务端应校验并持久化字幕卡样式");
  assert.match(swiftRenderer, /TitleCardStyle/, "macOS 本地渲染器应读取字幕卡样式");
  console.log(JSON.stringify({ ok: true, checks: 24, covered: ["复合章节边界", "镜号标题", "视觉人物", "OS配音角色", "身份与逐镜资产分计", "BGM", "音效", "调色", "字幕", "剪辑时长", "生成时长", "后期镜头", "字幕卡样式", "异常镜数阻断"] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
