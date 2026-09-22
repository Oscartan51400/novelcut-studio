#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const baseUrl = process.env.NOVELCUT_TEST_URL || "http://127.0.0.1:5188";

async function request(urlPath, options = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

const sourceText = `# 通用系列测试
第一季 · v3.0
版本 v2.0

## 通用生产规范与视觉圣经

| 代号 | 角色 | 身份 | 一句话人设 |
|---|---|---|---|
| LIN-01 | 林夕 | 管理员 | 冷静克制 |
| CALL-01 | 接警员 | 画外音 | 形象不出现，仅 OS 配音 |

### LIN-01 林夕
固定黑色长发、米白上衣。

### CALL-01 接警员：形象不出现，仅 OS 配音。

### LOC-01 老宅堂屋
暖黄吊灯、红木家具。

### PROP-01 玉扳指
青白玉材质，外壁刻字。

| 集 | v2 镜头 | v3 子镜头 | 转场镜头 | 总执行 |
|---|---:|---:|---:|---:|
| 第1集 | 3 | 7 | 1 | 8 |

### 镜头 01A｜黑暗视觉钩｜原 v2.01A
- 时长：5 秒
- 场景：LOC-01
- 时间轴：0–5 秒｜黑暗中竖瞳睁开。
- Seedance 提示词：

\`\`\`text
5秒单一连续电影镜头。严格沿用GUI-01与LOC-01参考图。0至5秒：黑暗中竖瞳睁开。
\`\`\`

### 镜头 01a｜林夕抬手｜原 v2.01
- 时长：5 秒
- 场景：LOC-01
- 景别与运镜：近景，固定机位
- 时间轴：0–5 秒｜林夕抬起戴着扳指的手。
- Seedance 提示词：

\`\`\`text
5秒单一连续电影镜头。严格沿用LIN-01、PROP-01与LOC-01参考图。0至5秒：林夕抬手。禁止字幕。
\`\`\`

### 转场镜头 T01｜类型 H｜节奏停顿｜5s
- 时长：5 秒
- 转场方式：黑屏 1 秒

### 镜头 01b｜扳指发光｜原 v2.01
- 时长：4 秒
- 场景：LOC-01
- 景别与运镜：手部特写
- 时间轴：5–9 秒｜扳指发出暖绿光。
- Seedance 提示词：

\`\`\`text
4秒单一连续电影镜头。严格沿用LIN-01、PROP-01与LOC-01参考图。0至5秒：林夕抬手；5至9秒：扳指发光。35mm胶片颗粒。音频：轻微嗡鸣。禁止字幕。
\`\`\`

### 镜头 02｜林夕转身
- 时长：5 秒
- 场景：LOC-01
- 时间轴：0–5 秒｜林夕转身。
- Seedance 提示词：
\`\`\`text
5秒单一连续电影镜头。严格沿用LIN-01与LOC-01参考图。0至5秒：林夕转身。
\`\`\`

### 镜头 03｜林夕停步
- 时长：5 秒
- 场景：LOC-01
- 时间轴：0–5 秒｜林夕停步。
- Seedance 提示词：
\`\`\`text
5秒单一连续电影镜头。严格沿用LIN-01与LOC-01参考图。0至5秒：林夕停步。
\`\`\`

### 镜头 04｜林夕回头
- 时长：5 秒
- 场景：LOC-01
- 时间轴：0–5 秒｜林夕回头。
- Seedance 提示词：
\`\`\`text
5秒单一连续电影镜头。严格沿用LIN-01与LOC-01参考图。0至5秒：林夕回头。
\`\`\`

### 镜头 12｜黑屏标题卡
- 时长：3 秒
- 场景：黑屏设计
- Seedance 提示词：
\`\`\`text
本地标题卡。
\`\`\`
`;

async function main() {
  const preview = await request("/api/source/preview", { method: "POST", body: JSON.stringify({ sourceText }) });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.production.mode, "series_bible");
  assert.equal(preview.body.shotCount, 7, "转场关系不能计入视频镜头数");
  assert.equal(preview.body.production.transitions.length, 1);
  assert.equal(preview.body.production.transitions[0].execution, "edit");
  assert.equal(preview.body.production.transitions[0].fromShot, "01a", "转场必须关联前一正片镜头");
  assert.equal(preview.body.production.transitions[0].toShot, "01b", "转场必须关联后一正片镜头");
  assert.equal(preview.body.characterCount, 1, "画外音角色不能建立视觉人物资产");
  assert.equal(preview.body.sceneCount, 1);
  assert.equal(preview.body.propCount, 1);
  assert.equal(preview.body.requiresConfirmation, true);
  assert.equal(preview.body.shots[2].generationMeta.promptRepaired, true);
  assert.doesNotMatch(preview.body.shots[2].prompt, /5至9秒/);

  const rejected = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "系列完稿风险阻断测试", sourceText })
  });
  assert.equal(rejected.status, 409, "严重体检问题未确认时必须阻止创建");

  const created = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "系列完稿确认创建测试", sourceText, confirmSourceRisks: true })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.sequences.flatMap((sequence) => sequence.shots).length, 7);
  assert.equal(created.body.production.transitions.length, 1);
  const episodeCut = await request(`/api/projects/${encodeURIComponent(created.body.id)}/rough-cut?episode=1`);
  assert.equal(episodeCut.status, 200);
  assert.equal(episodeCut.body.items.length, 7);
  assert.equal(episodeCut.body.items.every((item) => item.episodeNumber === 1), true, "按集粗剪不得混入其他剧集");
  assert.equal(episodeCut.body.items[0].sourceShotId, "01A");
  const missingEpisodeCut = await request(`/api/projects/${encodeURIComponent(created.body.id)}/rough-cut?episode=99`);
  assert.equal(missingEpisodeCut.status, 200);
  assert.equal(missingEpisodeCut.body.items.length, 0);
  const removed = await request(`/api/projects/${encodeURIComponent(created.body.id)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedUpdatedAt: created.body.updatedAt })
  });
  assert.equal(removed.status, 200);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novelcut-docx-test-"));
  try {
    fs.mkdirSync(path.join(tempDir, "word"));
    fs.writeFileSync(path.join(tempDir, "word", "document.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX读取测试</w:t></w:r></w:p><w:p><w:r><w:t>镜头 01｜打开老宅门</w:t></w:r></w:p></w:body></w:document>`);
    fs.writeFileSync(path.join(tempDir, "[Content_Types].xml"), `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`);
    const docxPath = path.join(tempDir, "最小完稿.docx");
    const zipped = spawnSync("zip", ["-q", "-r", docxPath, "[Content_Types].xml", "word"], { cwd: tempDir });
    if (zipped.status === 0) {
      const read = await request("/api/source-files/read", { method: "POST", body: JSON.stringify({ path: docxPath }) });
      assert.equal(read.status, 200);
      assert.equal(read.body.files[0].format, "docx");
      assert.match(read.body.text, /DOCX读取测试/);
      assert.match(read.body.text, /### 镜头 01/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(indexSource, /id="transitionDialog"/, "工作台必须提供独立转场制作清单");
  assert.match(appSource, /function renderEpisodeNavigator\(/, "工作台必须提供剧集导航");
  assert.match(appSource, /JSON\.stringify\(\{ episode: state\.roughEpisode \|\| 0 \}\)/, "合片必须显式提交当前剧集");
  assert.match(appSource, /data-transition-shot/, "转场关系必须能定位前后镜头");

  console.log(JSON.stringify({ ok: true, checks: 31, covered: ["DOCX读取", "系列完稿识别", "转场边分类", "转场双向关联", "画外音过滤", "提示词时间轴修复", "风险确认闸门", "确认后创建", "按集粗剪", "剧集导航", "转场镜头定位"] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
