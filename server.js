#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { loadKnowledgeBase, analyzeShot, buildKnowledgeDirectives, getKnowledgeSummary } = require("./lib/prompt-knowledge");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const outputsDir = path.join(rootDir, "outputs");
const promptKnowledge = loadKnowledgeBase();
const promptKnowledgeSummary = getKnowledgeSummary(promptKnowledge);

loadEnv(path.join(rootDir, ".env"));
const sharedEnv = process.env.NOVELCUT_SHARED_ENV
  ? path.resolve(rootDir, process.env.NOVELCUT_SHARED_ENV)
  : path.resolve(rootDir, "../../zaojing-ai-canvas/.env");
loadEnv(sharedEnv, {
  onlyMissing: true,
  allowKeys: new Set([
    "ARK_BASE_URL", "ARK_API_KEY", "SEEDANCE_API_KEY", "SEEDANCE_MODEL",
    "SEEDANCE_RESOLUTION", "SEEDANCE_SUBMIT_PATH", "SEEDANCE_STATUS_PATH",
    "SEEDANCE_TIMEOUT_MS", "SEEDREAM_API_KEY", "SEEDREAM_MODEL", "SEEDREAM_SIZE",
    "SEEDREAM_TIMEOUT_MS"
  ])
});

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(outputsDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "novelcut.db"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_text TEXT NOT NULL DEFAULT '',
    story_summary TEXT NOT NULL DEFAULT '',
    visual_style TEXT NOT NULL DEFAULT '电影级生活写实摄影，自然表演，统一人物与场景，稳定镜头',
    aspect_ratio TEXT NOT NULL DEFAULT '9:16',
    resolution TEXT NOT NULL DEFAULT '720p',
    audio_strategy TEXT NOT NULL DEFAULT 'post_dub',
    assets_json TEXT NOT NULL DEFAULT '[]',
    production_json TEXT NOT NULL DEFAULT '{}',
    source_manifest_json TEXT NOT NULL DEFAULT '[]',
    deleted_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sequences (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    scene TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS shots (
    id TEXT PRIMARY KEY,
    sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    shot_no INTEGER NOT NULL,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    duration_sec INTEGER NOT NULL DEFAULT 5,
    edit_duration_sec REAL NOT NULL DEFAULT 5,
    generation_meta_json TEXT NOT NULL DEFAULT '{}',
    characters TEXT NOT NULL DEFAULT '',
    scene TEXT NOT NULL DEFAULT '',
    asset_bindings_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'ready',
    preferred_take_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS takes (
    id TEXT PRIMARY KEY,
    shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    take_no INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    video_url TEXT NOT NULL DEFAULT '',
    local_url TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    task_id TEXT NOT NULL DEFAULT '',
    approved INTEGER NOT NULL DEFAULT 0,
    rejected INTEGER NOT NULL DEFAULT 0,
    change_request TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    take_id TEXT NOT NULL REFERENCES takes(id) ON DELETE CASCADE,
    provider_task_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'local_queued',
    request_json TEXT NOT NULL DEFAULT '{}',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sequences_project ON sequences(project_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_shots_sequence ON shots(sequence_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_takes_shot ON takes(shot_id, take_no);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, updated_at);
`);
const projectColumns = db.prepare("PRAGMA table_info(projects)").all();
if (!projectColumns.some((column) => column.name === "source_manifest_json")) {
  db.exec("ALTER TABLE projects ADD COLUMN source_manifest_json TEXT NOT NULL DEFAULT '[]'");
}
if (!projectColumns.some((column) => column.name === "deleted_at")) {
  db.exec("ALTER TABLE projects ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
}
if (!projectColumns.some((column) => column.name === "production_json")) {
  db.exec("ALTER TABLE projects ADD COLUMN production_json TEXT NOT NULL DEFAULT '{}'");
}
const shotColumns = db.prepare("PRAGMA table_info(shots)").all();
if (!shotColumns.some((column) => column.name === "asset_bindings_json")) {
  db.exec("ALTER TABLE shots ADD COLUMN asset_bindings_json TEXT NOT NULL DEFAULT '{}'");
}
if (!shotColumns.some((column) => column.name === "edit_duration_sec")) {
  db.exec("ALTER TABLE shots ADD COLUMN edit_duration_sec REAL NOT NULL DEFAULT 5");
  db.exec("UPDATE shots SET edit_duration_sec = duration_sec");
}
if (!shotColumns.some((column) => column.name === "generation_meta_json")) {
  db.exec("ALTER TABLE shots ADD COLUMN generation_meta_json TEXT NOT NULL DEFAULT '{}'");
}

const PORT = Number(process.env.PORT || 5188);
const HOST = process.env.HOST || "127.0.0.1";
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
let polling = false;

function loadEnv(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const index = clean.indexOf("=");
    if (index < 1) continue;
    const key = clean.slice(0, index).trim();
    if (options.allowKeys && !options.allowKeys.has(key)) continue;
    let value = clean.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (options.onlyMissing && process.env[key]) continue;
    process.env[key] = value;
  }
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function normalizeShotDuration(value) {
  const number = clamp(value, 3, 15);
  if (number <= 5) return 5;
  if (number <= 10) return 10;
  return 15;
}

function parseChineseNumber(value) {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[String(value || "").trim()] || 0;
}

function cleanMarkdown(text) {
  return String(text || "")
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractField(text, labels) {
  for (const label of labels) {
    const match = String(text || "").match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${label}\\s*[:：]\\s*([^\\n]+)`, "i"));
    if (match) return match[1].trim();
  }
  return "";
}

function splitMarkdownRow(line) {
  return String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((item) => item.trim());
}

function parseMarkdownTables(source) {
  const lines = String(source || "").split(/\r?\n/);
  const tables = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|")) continue;
    const headers = splitMarkdownRow(lines[index]);
    const separator = splitMarkdownRow(lines[index + 1]);
    if (!headers.length || separator.length !== headers.length || !separator.every((item) => /^:?-{3,}:?$/.test(item))) continue;
    const rows = [];
    let rowIndex = index + 2;
    for (; rowIndex < lines.length; rowIndex += 1) {
      if (!lines[rowIndex].includes("|")) break;
      const cells = splitMarkdownRow(lines[rowIndex]);
      if (!cells.some(Boolean)) continue;
      const row = {};
      headers.forEach((header, cellIndex) => { row[header] = cells[cellIndex] || ""; });
      rows.push(row);
    }
    tables.push({ headers, rows });
    index = rowIndex - 1;
  }
  return tables;
}

function tableCell(row, pattern) {
  return Object.entries(row || {}).find(([key]) => pattern.test(key))?.[1] || "";
}

function parseMarkdownTable(source) {
  const table = parseMarkdownTables(source).find(({ headers }) => headers.some((item) => /镜头|镜号|编号|^#$/.test(item)));
  if (!table) return [];
  const rows = [];
  for (const row of table.rows) {
    const get = (pattern) => tableCell(row, pattern);
    const number = parseChineseNumber(get(/镜号|编号|序号|^#|镜头$/)) || rows.length + 1;
    const promptFields = Object.entries(row)
      .filter(([key, value]) => value && /画面|状态|空间|视线|景别|运镜|起始|起势|核心动作|结束|落点|对白|声音|转场|连续性|补充|提示词|Prompt/i.test(key))
      .map(([key, value]) => `${key}：${value}`);
    const prompt = promptFields.join("；") || get(/画面|核心动作|内容|提示词|Prompt/i);
    if (!prompt) continue;
    rows.push({
      no: number,
      title: get(/标题|镜头名/) || prompt.slice(0, 18),
      prompt,
      duration: Number((get(/时长|秒数|duration/i).match(/[\d.]+/) || [5])[0]),
      characters: get(/出场角色/) || get(/角色|人物/),
      primaryCharacter: get(/主角色|主人物|主体/),
      scene: get(/场景|地点/),
      sourceRow: row
    });
  }
  return rows;
}

function markdownSection(source, titlePattern, level = 2) {
  const lines = String(source || "").split("\n");
  let start = -1;
  let headingLevel = level;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s*(.+)$/);
    if (!match || !titlePattern.test(match[2])) continue;
    start = index + 1;
    headingLevel = match[1].length;
    break;
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= headingLevel) { end = index; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}

function subsectionBlocks(section, headingPattern) {
  const lines = String(section || "").split("\n");
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^(#{3,6})\s*(.+)$/);
    if (match && headingPattern.test(match[2])) {
      if (current) blocks.push(current);
      current = { heading: match[2].trim(), lines: [] };
    } else if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((block) => ({ ...block, body: block.lines.join("\n").trim() }));
}

function fencedAfter(block, labelPattern) {
  const text = String(block || "");
  const label = text.search(labelPattern);
  if (label < 0) return "";
  const match = text.slice(label).match(/```[^\n]*\n([\s\S]*?)```/);
  return match ? cleanMarkdown(match[1]) : "";
}

function firstFence(block) {
  const match = String(block || "").match(/```[^\n]*\n([\s\S]*?)```/);
  return match ? cleanMarkdown(match[1]) : "";
}

function cleanArchiveName(value, prefixPattern) {
  return String(value || "")
    .replace(prefixPattern, "")
    .replace(/[（(][^）)]*[）)]\s*$/, "")
    .trim();
}

function parseShotRange(value) {
  const numbers = [...String(value || "").matchAll(/\d+/g)].map((match) => Number(match[0]));
  return numbers.length ? { start: numbers[0], end: numbers[1] || numbers[0] } : { start: 0, end: 0 };
}

function shotTargetIncludes(value, shotNo) {
  const text = String(value || "");
  const number = Number(shotNo);
  const range = text.match(/镜?\s*(\d+)\s*[-–—~至]\s*(\d+)/);
  if (range) return number >= Number(range[1]) && number <= Number(range[2]);
  return [...text.matchAll(/镜?\s*(\d+)/g)].some((match) => Number(match[1]) === number);
}

function shotSubjectText(prompt) {
  const text = String(prompt || "");
  const boundary = text.search(/^\s*(?:动作|镜头|环境|场景|光影|风格|节奏|画质)[：:]/m);
  return boundary >= 0 ? text.slice(0, boundary) : text;
}

function characterAppearsInSubject(character, subject) {
  if (subject.includes(character.name)) return true;
  const description = String(character.description || "");
  if (/乌龟|龟仙人/.test(subject) && /乌龟|龟仙人/.test(description)) return true;
  if (/女性|女子|女人/.test(subject) && /女性|女子|女人/.test(description)) return true;
  return false;
}

function parseCompositeSource(source) {
  const shotSection = markdownSection(source, /(?:\d+\s*[、.]\s*)?\d+\s*个镜头.*Seedance提示词|镜头Seedance提示词|分镜.*完整版/i);
  if (!shotSection || !/^#{3,6}\s*镜号\s*\d+/m.test(shotSection)) return null;

  const characterSection = markdownSection(source, /(?:角色|人物)档案/);
  const sceneSection = markdownSection(source, /场景档案/);
  const propSection = markdownSection(source, /道具.*特效档案|道具档案/);
  const voiceSection = markdownSection(source, /配音脚本/);
  const postSection = markdownSection(source, /后期合成/);

  const characterEntries = subsectionBlocks(characterSection, /^角色\s*\d*\s*[:：]/).map(({ heading, body }) => {
    const name = cleanArchiveName(heading, /^角色\s*\d*\s*[:：]\s*/);
    const audioOnly = /无需定妆照|仅出声音|OS角色/i.test(`${heading}\n${body}`);
    return {
      name,
      audioOnly,
      description: fencedAfter(body, /基础外观设定|基础设定/) || firstFence(body) || cleanMarkdown(body).slice(0, 1600),
      prompt: fencedAfter(body, /定妆照生成提示词/) || ""
    };
  }).filter((item) => item.name);

  const sceneEntries = subsectionBlocks(sceneSection, /^场景\s*\d*\s*[:：]/).map(({ heading, body }) => ({
    name: cleanArchiveName(heading, /^场景\s*\d*\s*[:：]\s*/),
    description: fencedAfter(body, /场景描述/) || firstFence(body) || cleanMarkdown(body).slice(0, 1600),
    prompt: fencedAfter(body, /场景Seedance提示词|生成提示词/) || ""
  })).filter((item) => item.name);

  const propEntries = subsectionBlocks(propSection, /^道具\s*\d*\s*[:：]/).map(({ heading, body }) => ({
    name: cleanArchiveName(heading, /^道具\s*\d*\s*[:：]\s*/),
    description: fencedAfter(body, /道具Seedance提示词|生成提示词/) || firstFence(body) || cleanMarkdown(body).slice(0, 1200)
  })).filter((item) => item.name);

  const visualCharacters = characterEntries.filter((item) => !item.audioOnly);
  const sceneAliases = new Map();
  sceneEntries.forEach((item) => {
    const aliases = [];
    if (/老宅堂屋/.test(item.name)) aliases.push("老宅堂屋", "民国老宅堂屋", "武汉民国老宅堂屋");
    if (/地下市场|妖怪市场/.test(item.name)) aliases.push("地下市场", "地下妖怪市场", "汉口地下妖怪市场");
    if (/楼梯/.test(item.name)) aliases.push("老宅楼梯", "地下楼梯");
    sceneAliases.set(item.name, [...new Set(aliases.filter((alias) => alias !== item.name))]);
  });

  const shotBlocks = subsectionBlocks(shotSection, /^镜号\s*\d+/);
  const shots = shotBlocks.map(({ heading, body }, index) => {
    const number = Number((heading.match(/^镜号\s*(\d+)/) || [0, index + 1])[1]);
    const meta = (heading.match(/[（(]([^）)]*)[）)]/) || [0, ""])[1];
    const metaParts = meta.split(/[·•・]/).map((item) => item.trim()).filter(Boolean);
    const shotSize = metaParts.find((item) => /特写|近景|中景|全景|远景|反打/.test(item)) || "";
    const editDuration = Number((meta.match(/(\d+(?:\.\d+)?)秒/) || [0, 5])[1]);
    const beat = metaParts.filter((item) => !/^\d+(?:\.\d+)?秒$/.test(item) && item !== shotSize).join("·");
    const postOnly = /不需Seedance|直接后期制作|字幕卡/.test(`${heading}\n${body}`);
    const prompt = fencedAfter(body, /Seedance提示词/) || fencedAfter(body, /画面设计/) || firstFence(body);
    const negativePrompt = fencedAfter(body, /负面提示词/);
    const modePart = body.match(/\*\*图生视频模式\*\*[：:]([\s\S]*?)(?=\n\*\*|$)/)?.[1] || "";
    const generationRequested = Number((modePart.match(/时长[：:]\s*(\d+(?:\.\d+)?)秒/) || [0, editDuration])[1]);
    const subject = shotSubjectText(prompt);
    const characters = visualCharacters.filter((item) => characterAppearsInSubject(item, subject)).map((item) => item.name);
    let scene = "";
    if (!postOnly) {
      scene = sceneEntries.find((item) => /(?:地下市场|妖怪市场)/.test(prompt) && /(?:地下市场|妖怪市场)/.test(item.name))?.name
        || sceneEntries.find((item) => /楼梯/.test(prompt) && /楼梯/.test(item.name))?.name
        || sceneEntries.find((item) => /老宅|堂屋|青砖地面/.test(prompt) && /老宅|堂屋/.test(item.name))?.name
        || "未指定场景";
    }
    const dialogue = [...body.matchAll(/(?:武汉话原版|普通话字幕|武汉话OS|普通话OS|普通话)[：:]\s*`([^`]+)`/g)].map((match) => match[1]);
    const inlineSfx = (body.match(/\*\*音效\*\*[：:]([\s\S]*?)(?=\n\*\*|$)/)?.[1] || "")
      .split("\n").map((line) => cleanMarkdown(line)).filter(Boolean);
    return {
      no: number,
      title: beat || meta || `镜头 ${number}`,
      prompt: prompt || `后期镜头：${beat || heading}`,
      duration: postOnly ? 5 : normalizeShotDuration(generationRequested),
      requestedDuration: generationRequested,
      editDuration,
      characters: characters.join("、"),
      scene,
      sourceRow: {},
      generationMeta: { postOnly, shotSize, beat, editDuration, generationRequested, negativePrompt, dialogue, inlineSfx }
    };
  });

  const characterAssets = visualCharacters.map((item) => ({
    id: id("asset"), type: "character", role: "identity", parentAssetId: "", shotNos: [], name: item.name,
    aliases: [], description: item.description, prompt: item.prompt, status: "draft", referenceUrl: "", version: 1
  }));
  const sceneAssets = sceneEntries.map((item) => ({
    id: id("asset"), type: "scene", role: "identity", parentAssetId: "", shotNos: [], name: item.name,
    aliases: sceneAliases.get(item.name) || [], description: item.description, prompt: item.prompt, status: "draft", referenceUrl: "", version: 1
  }));
  const propAssets = propEntries.map((item) => ({
    id: id("asset"), type: "prop", role: "identity", parentAssetId: "", shotNos: [], name: item.name,
    aliases: [], description: item.description, status: "draft", referenceUrl: "", version: 1
  }));
  const characterByName = new Map(characterAssets.map((asset) => [asset.name, asset]));
  const sceneByName = new Map(sceneAssets.map((asset) => [asset.name, asset]));
  const viewAssets = [];
  shots.filter((shot) => !shot.generationMeta.postOnly).forEach((shot) => {
    const label = String(shot.no).padStart(2, "0");
    const sceneParent = sceneByName.get(shot.scene);
    if (sceneParent) viewAssets.push({
      id: id("asset"), type: "scene", role: "view", parentAssetId: sceneParent.id, shotNos: [shot.no],
      name: `${sceneParent.name} · 镜头${label}视角`, aliases: [],
      description: `对应镜头：${shot.title}；剪辑时长：${shot.editDuration}秒；生成时长：${shot.duration}秒；${shot.prompt}`.slice(0, 1600),
      status: "draft", referenceUrl: "", version: 1
    });
    splitAssetNames(shot.characters).forEach((name) => {
      const parent = characterByName.get(name);
      if (!parent) return;
      viewAssets.push({
        id: id("asset"), type: "character", role: "view", parentAssetId: parent.id, shotNos: [shot.no],
        name: `${parent.name} · 镜头${label}造型`, aliases: [],
        description: `身份基准：${parent.name}；对应镜头：${shot.title}；景别：${shot.generationMeta.shotSize || "按提示词"}；${shot.prompt}`.slice(0, 1600),
        status: "draft", referenceUrl: "", version: 1
      });
    });
  });

  const effectTable = parseMarkdownTables(propSection).find(({ headers }) => headers.some((header) => /特效类型/.test(header)));
  const effects = (effectTable?.rows || []).map((row) => ({ name: tableCell(row, /特效类型/), description: tableCell(row, /描述/), implementation: tableCell(row, /Seedance|实现/) }));
  const bgmSection = markdownSection(postSection, /BGM清单/i, 3);
  const bgmTable = parseMarkdownTables(bgmSection)[0];
  const bgm = (bgmTable?.rows || []).map((row) => {
    const rangeText = tableCell(row, /段落|镜号/); const range = parseShotRange(rangeText);
    return { range: rangeText, shotStart: range.start, shotEnd: range.end, time: tableCell(row, /时长|时间/), style: tableCell(row, /BGM风格|风格/), source: tableCell(row, /曲库|来源|推荐/) };
  });
  const sfxSection = markdownSection(postSection, /音效清单/, 3);
  const sfxTable = parseMarkdownTables(sfxSection)[0];
  const sfx = (sfxTable?.rows || []).map((row) => ({ shotNo: Number((tableCell(row, /镜号|镜头/) || "0").match(/\d+/)?.[0] || 0), description: tableCell(row, /音效/) }));
  const gradingSection = markdownSection(postSection, /调色方案/, 3);
  const gradeTable = parseMarkdownTables(gradingSection)[0];
  const grading = (gradeTable?.rows || []).map((row) => ({ target: tableCell(row, /场景|镜号/), primary: tableCell(row, /主色调/), secondary: tableCell(row, /辅色|氛围/) }));
  const gradeParameters = [...gradingSection.matchAll(/^[-*][ \t]+([^\n:：]+)[：:][ \t]*(.+)$/gm)].map((match) => ({ name: match[1].trim(), value: match[2].trim() }));
  const subtitleSection = markdownSection(postSection, /字幕叠加规范/, 3);
  const subtitleTable = parseMarkdownTables(subtitleSection)[0];
  const subtitles = Object.fromEntries((subtitleTable?.rows || []).map((row) => [tableCell(row, /元素/), tableCell(row, /样式/)]).filter(([key]) => key));
  const voices = characterEntries.map((item) => ({ name: item.name, audioOnly: item.audioOnly }));
  const voiceTables = parseMarkdownTables(voiceSection).filter(({ headers }) => headers.some((header) => /镜号/.test(header)));
  const voiceLines = voiceTables.flatMap((table) => table.rows.map((row) => ({
    shotNo: Number((tableCell(row, /镜号/) || "0").match(/\d+/)?.[0] || 0),
    dialect: tableCell(row, /武汉话/), standard: tableCell(row, /普通话|台词/)
  }))).filter((item) => item.shotNo);
  const expectedShotCount = Number((source.match(/(\d+)个镜头/) || [0, 0])[1]);
  const replacementCharacters = (source.match(/\uFFFD/g) || []).length;
  const production = { mode: "composite", expectedShotCount, bgm, sfx, grading, gradeParameters, subtitles, effects, voices, voiceLines, replacementCharacters };
  return {
    summary: cleanMarkdown(source).slice(0, 800),
    shots,
    assets: [...characterAssets, ...sceneAssets, ...propAssets, ...viewAssets],
    production
  };
}

function cleanListedPropName(value) {
  return String(value || "").trim()
    .replace(/^(?:位于|放在|摆在|挂在)?[^，,；;]{0,16}?(?:一|两|三|四|五|六|\d+)(?:个|盏|把|只|枚|封|根|面|辆|件|台|张|条|本|支)\s*/, "")
    .replace(/^(?:一个|一盏|一把|一只|一枚|一封|一根|一面|一辆|一件|一台|一张|一条|一本|一支)\s*/, "")
    .replace(/^(?:唯一的?|固定的?|同一(?:个|只|件|辆)?)\s*/, "")
    .trim();
}

function propDescriptionFromSource(source, names) {
  const fragments = [];
  const normalizedNames = names.map((name) => String(name || "").trim()).filter(Boolean);
  String(source || "").split(/\r?\n/).forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^\|?\s*:?-{3,}/.test(trimmed)) return;
    const parts = trimmed.includes("|") ? splitMarkdownRow(trimmed) : trimmed.split(/[。！？!?]/);
    for (const part of parts) {
      const text = cleanMarkdown(part).replace(/^[-*]\s*/, "").trim();
      if (!text || text.length > 320 || !normalizedNames.some((name) => text.includes(name))) continue;
      const withoutNames = text.replace(new RegExp(normalizedNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"), "").replace(/[、,，/\s]/g, "");
      if (!withoutNames || /^(?:乘客群|人物|角色|道具|主角)$/.test(withoutNames)) continue;
      const detailScore = /(?:固定|保持|为|外观|材质|颜色|纹样|身穿|携带|手持|暗红|金色|深蓝|木质|补丁)/.test(text) ? 4 : 0;
      fragments.push({ text, score: detailScore + (text.length <= 160 ? 2 : 0), lineIndex });
    }
  });
  const unique = [...new Map(fragments.map((item) => [item.text, item])).values()]
    .sort((a, b) => b.score - a.score || a.lineIndex - b.lineIndex)
    .slice(0, 3)
    .map((item) => item.text);
  return unique.join("；").slice(0, 600);
}

function parseSource(sourceText) {
  const source = String(sourceText || "").replace(/\r\n/g, "\n").trim();
  if (!source) {
    throw Object.assign(new Error("分镜内容不能为空，请粘贴内容或导入 Markdown/TXT 文件"), { statusCode: 422 });
  }
  const composite = parseCompositeSource(source);
  if (composite) {
    if (composite.production.expectedShotCount && composite.production.expectedShotCount !== composite.shots.length) {
      throw Object.assign(new Error(`文档声明 ${composite.production.expectedShotCount} 个镜头，但只识别到 ${composite.shots.length} 个；请修正镜号标题后再创建项目。`), { statusCode: 422 });
    }
    return composite;
  }
  const tableShots = parseMarkdownTable(source);
  let shots = tableShots;
  if (!shots.length) {
    const lines = source.split("\n");
    const heading = /^(?:#{1,6}\s*)?(?:镜头|分镜)\s*([0-9一二三四五六七八九十]+)\s*(?:[｜|:：—-]\s*)?(.*)$/i;
    const blocks = [];
    let current = null;
    for (const line of lines) {
      const match = line.trim().match(heading);
      if (match) {
        if (current) blocks.push(current);
        current = { no: parseChineseNumber(match[1]) || blocks.length + 1, title: match[2].trim(), lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) blocks.push(current);
    shots = blocks.map((block, index) => {
      const body = cleanMarkdown(block.lines.join("\n"));
      const prompt = extractField(body, ["Seedance 提示词", "视频提示词", "生成提示词", "画面", "核心动作"] ) || body;
      const durationText = extractField(body, ["时长", "镜头时长"]);
      return {
        no: block.no || index + 1,
        title: block.title || prompt.slice(0, 18) || `镜头 ${index + 1}`,
        prompt: prompt.slice(0, 5000),
        duration: Number((durationText.match(/[\d.]+/) || body.match(/(\d+)\s*秒/) || [5])[1] || (durationText.match(/[\d.]+/) || [5])[0]),
        characters: extractField(body, ["出场角色", "主角色", "人物", "角色"]),
        scene: extractField(body, ["场景", "地点"])
      };
    });
  }
  if (!shots.length) {
    const paragraphs = source.split(/\n\s*\n/).map(cleanMarkdown).filter((item) => item.length >= 12);
    shots = paragraphs.map((paragraph, index) => ({
      no: index + 1,
      title: paragraph.replace(/^#+\s*/, "").slice(0, 18),
      prompt: paragraph.slice(0, 3000),
      duration: 5,
      characters: "",
      scene: ""
    }));
  }
  if (!shots.length) {
    shots = [{ no: 1, title: "第一个镜头", prompt: source || "描述这个镜头里发生的事情。", duration: 5, characters: "", scene: "" }];
  }

  const shotCharacterCounts = new Map();
  shots.forEach((shot) => String(shot.characters || "").split(/[、,，/]+/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
    shotCharacterCounts.set(item, Number(shotCharacterCounts.get(item) || 0) + 1);
  }));
  const explicitCharacters = new Map();
  const explicitCharacterAliases = new Map();
  const explicitScenes = new Map();
  const explicitProps = new Map();
  const explicitPropAliases = new Map();
  const addProp = (rawName, description = "", aliases = []) => {
    const name = cleanListedPropName(rawName);
    if (!name || name.length > 30) return;
    const aliasList = aliases.map(cleanListedPropName).filter(Boolean);
    const existingName = [...explicitProps.keys()].find((candidate) => candidate === name || candidate.includes(name) || name.includes(candidate)
      || aliasList.some((alias) => candidate.includes(alias) || alias.includes(candidate)));
    const key = existingName || name;
    explicitProps.set(key, [explicitProps.get(key), description].filter(Boolean).join("；").slice(0, 1200));
    explicitPropAliases.set(key, [...new Set([...(explicitPropAliases.get(key) || []), ...(existingName && existingName !== name ? [name] : []), ...aliasList].filter((item) => item !== key))]);
  };
  for (const table of parseMarkdownTables(source)) {
    for (const row of table.rows) {
      const characterName = tableCell(row, /^(?:角色名|人物名|姓名)$/);
      if (characterName) {
        const description = Object.entries(row).filter(([key, value]) => value && !/^(?:角色名|人物名|姓名|别名|曾用名)$/.test(key)).map(([key, value]) => `${key}：${value}`).join("；");
        explicitCharacters.set(characterName.trim(), description);
        const aliases = tableCell(row, /^(?:别名|曾用名)$/).split(/[、,，/]+/).map((item) => item.trim()).filter(Boolean);
        explicitCharacterAliases.set(characterName.trim(), aliases);
        continue;
      }
      const sceneName = tableCell(row, /^(?:场景名|地点名)$/);
      if (sceneName) {
        const description = Object.entries(row).filter(([key, value]) => value && !/^(?:场景名|地点名|关键道具|固定道具)$/.test(key)).map(([key, value]) => `${key}：${value}`).join("；");
        explicitScenes.set(sceneName.trim(), description);
        const propText = tableCell(row, /关键道具|固定道具/);
        propText.split(/[、,，；;]+/).map((item) => item.trim()).filter(Boolean)
          .forEach((item) => addProp(item, `${sceneName.trim()}中的固定道具：${item}`));
        continue;
      }
      const propName = tableCell(row, /^(?:道具名|物品名|载具名)$/);
      if (propName) {
        const description = Object.entries(row).filter(([key, value]) => value && !/^(?:道具名|物品名|载具名|别名)$/.test(key)).map(([key, value]) => `${key}：${value}`).join("；");
        addProp(propName, description, tableCell(row, /^别名$/).split(/[、,，/]+/));
      }
    }
  }
  const sourceLines = source.split("\n");
  let section = "";
  let sectionLevel = 0;
  let currentCharacter = "";
  for (const line of sourceLines) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(#{1,6})\s*(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/^\d+[.、]\s*/, "").trim();
      if (/^(?:固定)?(?:人物|角色).*(?:卡|设定|介绍)?$/.test(title)) {
        section = "character";
        sectionLevel = level;
        currentCharacter = "";
        continue;
      }
      if (/^(?:固定)?(?:场景|地点).*(?:卡|设定|介绍)?$/.test(title)) {
        section = "scene";
        sectionLevel = level;
        currentCharacter = "";
        continue;
      }
      if (/^(?:固定)?(?:道具|物品|载具).*(?:卡|表|设定|介绍)?$/.test(title)) {
        section = "prop";
        sectionLevel = level;
        currentCharacter = "";
        continue;
      }
      if (section === "character" && level > sectionLevel) {
        const alias = [...shotCharacterCounts.keys()].find((name) => title.includes(name));
        currentCharacter = alias || title.split(/[/／]/)[0].trim();
        if (currentCharacter) {
          explicitCharacters.set(currentCharacter, explicitCharacters.get(currentCharacter) || "");
          const aliases = title.split(/[/／]/).map((item) => item.trim()).filter((item) => item && item !== currentCharacter);
          explicitCharacterAliases.set(currentCharacter, [...new Set([...(explicitCharacterAliases.get(currentCharacter) || []), ...aliases])]);
        }
        continue;
      }
      if (level <= sectionLevel) {
        section = "";
        currentCharacter = "";
      }
    }
    const item = line.trim().match(/^(?:[-*]|\d+[.、])\s*([^：:，,]{2,24})[:：]\s*(.+)$/);
    if (item && section === "character" && !currentCharacter) explicitCharacters.set(item[1].trim(), item[2].trim());
    if (item && section === "scene") explicitScenes.set(item[1].trim(), item[2].trim());
    if (item && section === "prop") addProp(item[1].trim(), item[2].trim());
    if (section === "character" && currentCharacter && /^[-*]\s+/.test(trimmed)) {
      const detail = cleanMarkdown(trimmed.replace(/^[-*]\s+/, ""));
      explicitCharacters.set(currentCharacter, [explicitCharacters.get(currentCharacter), detail].filter(Boolean).join("；"));
    }
  }
  const nonHumanPrimary = /(?:车流|列车|汽车|车辆|金箍棒|盾|餐袋|信封|台灯|武器|道具|筋斗云|金云)$/;
  const normalizeParticipant = (value) => String(value || "").trim()
    .replace(/^(?:电视|手机|屏幕|镜子|回忆|照片|画面|背景)(?:中的?|里的?)/, "")
    .replace(/^(?:少量|一群|多名|若干)/, "")
    .replace(/(?:远景|近景|背景|剪影)$/, "")
    .trim();
  const characterMap = new Map(explicitCharacters);
  const findExistingCharacter = (rawName) => {
    const name = normalizeParticipant(rawName).replace(/分身$/, "");
    const candidates = [...characterMap.keys()].filter((candidate) => candidate === name || candidate.includes(name) || name.includes(candidate)
      || (explicitCharacterAliases.get(candidate) || []).some((alias) => alias === name || alias.includes(name) || name.includes(alias)));
    return candidates.length === 1 ? candidates[0] : "";
  };
  const normalizedCounts = new Map();
  for (const [rawName, count] of shotCharacterCounts) {
    const name = normalizeParticipant(rawName);
    normalizedCounts.set(name, Number(normalizedCounts.get(name) || 0) + count);
  }
  shots.forEach((shot) => {
    const primary = normalizeParticipant(shot.primaryCharacter);
    const names = [...String(shot.characters || "").split(/[、,，/]+/), primary].map(normalizeParticipant).filter(Boolean);
    for (const name of names) {
      const existing = findExistingCharacter(name);
      if (existing) {
        if (name.endsWith("分身") && name !== existing) explicitCharacterAliases.set(existing, [...new Set([...(explicitCharacterAliases.get(existing) || []), name])]);
        continue;
      }
      if (name === "分身" && [...characterMap.keys()].some((candidate) => /悟空/.test(candidate))) {
        const owner = [...characterMap.keys()].find((candidate) => /悟空/.test(candidate));
        explicitCharacterAliases.set(owner, [...new Set([...(explicitCharacterAliases.get(owner) || []), "分身", "悟空分身"])]);
        continue;
      }
      if (nonHumanPrimary.test(name)) continue;
      characterMap.set(name, propDescriptionFromSource(source, [name]) || `分镜中出现的${name}，需要固定外观、服装、体型和群体构成。` );
    }
  });

  const commonPropCatalog = [
    { name: "金箍棒", aliases: [], pattern: /金箍棒/g },
    { name: "筋斗云", aliases: ["金云"], pattern: /筋斗云|金云/g },
    { name: "外卖餐袋", aliases: ["餐袋"], pattern: /外卖餐袋|餐袋/g },
    { name: "圆形合金盾", aliases: ["合金盾", "圆盾", "盾牌"], pattern: /圆形合金盾|合金盾|圆盾|盾牌/g },
    { name: "长柄漏勺", aliases: ["漏勺"], pattern: /长柄漏勺|漏勺/g },
    { name: "地铁列车", aliases: ["失控列车", "列车"], pattern: /地铁列车|失控列车|列车/g },
    { name: "牛皮纸信封", aliases: ["信封"], pattern: /牛皮纸信封|信封/g },
    { name: "红色台灯", aliases: ["台灯"], pattern: /红色台灯|台灯/g },
    { name: "手机", aliases: [], pattern: /手机/g },
    { name: "钥匙", aliases: [], pattern: /钥匙/g },
    { name: "录像机", aliases: [], pattern: /录像机/g },
    { name: "雨伞", aliases: ["伞"], pattern: /雨伞/g }
  ];
  for (const candidate of commonPropCatalog) {
    const count = [...source.matchAll(candidate.pattern)].length;
    if (count < 2 && !candidate.aliases.some((alias) => [...explicitProps.keys()].some((name) => name.includes(alias)))) continue;
    addProp(candidate.name, propDescriptionFromSource(source, [candidate.name, ...candidate.aliases]), candidate.aliases);
  }
  const bigrams = (value) => {
    const text = String(value || "").replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "");
    return [...text].slice(0, -1).map((char, index) => `${char}${[...text][index + 1]}`);
  };
  const findSceneDefinition = (sceneName) => {
    if (explicitScenes.has(sceneName)) return { name: sceneName, description: explicitScenes.get(sceneName), score: Number.MAX_SAFE_INTEGER };
    const scenePairs = new Set(bigrams(sceneName));
    let best = { score: 0, name: "", description: "" };
    for (const [name, description] of explicitScenes) {
      const score = bigrams(`${name}${description}`).filter((pair) => scenePairs.has(pair)).length;
      if (score > best.score) best = { score, name, description };
    }
    return best.score > 0 ? best : null;
  };
  const sceneMap = new Map();
  if (explicitScenes.size) {
    for (const [name, description] of explicitScenes) sceneMap.set(name, { description, aliases: [] });
    shots.forEach((shot) => {
      const scene = String(shot.scene || "").trim();
      if (!scene) return;
      const definition = findSceneDefinition(scene);
      if (definition) {
        const entry = sceneMap.get(definition.name);
        if (scene !== definition.name) entry.aliases.push(scene);
      } else if (!sceneMap.has(scene)) {
        sceneMap.set(scene, { description: "", aliases: [] });
      }
    });
  } else {
    shots.forEach((shot) => {
      const scene = String(shot.scene || "").trim();
      if (scene && !sceneMap.has(scene)) sceneMap.set(scene, { description: "", aliases: [] });
    });
  }
  const characterAssets = [...characterMap].map(([name, description]) => ({
    id: id("asset"), type: "character", role: "identity", name,
    aliases: explicitCharacterAliases.get(name) || [], description,
    status: "draft", referenceUrl: "", version: 1, parentAssetId: "", shotNos: []
  }));
  const sceneAssets = [...sceneMap].map(([name, value]) => ({
    id: id("asset"), type: "scene", role: "identity", name,
    aliases: [...new Set(value.aliases)], description: value.description,
    status: "draft", referenceUrl: "", version: 1, parentAssetId: "", shotNos: []
  }));
  const propAssets = [...explicitProps].map(([name, description]) => ({
    id: id("asset"), type: "prop", role: "identity", name,
    aliases: explicitPropAliases.get(name) || [], description,
    status: "draft", referenceUrl: "", version: 1, parentAssetId: "", shotNos: []
  }));
  const characterByName = new Map(characterAssets.map((asset) => [asset.name, asset]));
  const sceneByName = new Map(sceneAssets.map((asset) => [asset.name, asset]));
  const allCharacterTerms = [...new Set(characterAssets.flatMap((asset) => [asset.name, ...(asset.aliases || [])]).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  const shotCameraGuide = (shot) => tableCell(shot.sourceRow, /景别|运镜|摄影机|角度|机位/) || "按分镜建立准确景别与观察角度";
  const splitVisualClauses = (value) => String(value || "").split(/[；;。\n]|(?<=.{2})[，,](?=.{2})/).map((item) => item.trim()).filter(Boolean);
  const wardrobeSignal = /(?:马甲|战甲|披风|盔甲|甲胄|衣|服|裙|裤|鞋|靴|围裙|制服|战袍|战衣|雨衣|外套|头冠|发箍|帽|头巾|配饰)/;
  const wardrobeContinuity = new Map();
  const clarifyWardrobePalette = (text) => {
    if (/颜色锁定：/.test(text)) return text;
    if (!/(?:橙黑|橙色.*黑色|黑橙).*(?:马甲|外套)|(?:马甲|外套).*(?:橙黑|橙色.*黑色|黑橙)/.test(text)) return text;
    return `${text}；颜色锁定：马甲主体为高饱和橙色（接近 #E85D04），肩部、包边和拉链为哑光黑色；禁止黄色、柠檬黄、土黄或金黄色马甲`;
  };
  const shotWardrobeGuide = (shot, parent, participantSource) => {
    const ownTerms = [parent.name, ...(parent.aliases || [])].filter(Boolean);
    const source = [
      tableCell(shot.sourceRow, /状态/), tableCell(shot.sourceRow, /服装|造型|衣着/),
      tableCell(shot.sourceRow, /连续性/), tableCell(shot.sourceRow, /画面|核心动作|提示词/),
      participantSource
    ].filter(Boolean).join("；");
    const clauses = splitVisualClauses(source).filter((clause) => {
      if (!wardrobeSignal.test(clause) && !/(?:造型|同装).*(?:延续|保持|固定)/.test(clause)) return false;
      const mentionedCharacters = allCharacterTerms.filter((term) => clause.includes(term));
      return !mentionedCharacters.length || mentionedCharacters.some((term) => ownTerms.includes(term));
    });
    const explicit = [...new Set(clauses)].join("；");
    const previous = wardrobeContinuity.get(parent.id) || "";
    const continuityCue = /(?:造型延续|服装延续|仍穿|保持同一|同装|服装不变)/.test(explicit);
    const fullWardrobeChange = /(?:换成|换上|改穿|穿上|恢复|本体|外套[^；]*(?:橙|黄|红|黑|白|蓝|绿|紫|灰|金|银))/.test(explicit);
    const partialDetail = explicit && !fullWardrobeChange;
    let resolved = explicit;
    let stored = explicit;
    if (!resolved) {
      stored = previous || "沿用人物身份基准服装，不新增外层服饰";
      resolved = previous ? `延续上一出场的服装：${previous}` : stored;
    } else if (previous && (continuityCue || partialDetail)) {
      resolved = `${previous}；本镜服装细节：${resolved}`;
      const durableStateChange = /(?:沾灰|沾血|污渍|破损|撕裂|湿透|烧焦|搭在肩)/.test(explicit);
      stored = durableStateChange ? `${previous}；当前持续状态：${explicit}` : previous;
    }
    resolved = clarifyWardrobePalette(resolved);
    stored = clarifyWardrobePalette(stored || resolved);
    wardrobeContinuity.set(parent.id, stored);
    return resolved;
  };
  const participantVisualGuide = (shot, parent) => {
    const ownTerms = [parent.name, ...(parent.aliases || [])].filter(Boolean);
    const source = [
      tableCell(shot.sourceRow, /状态/), tableCell(shot.sourceRow, /空间|视线/),
      tableCell(shot.sourceRow, /起势|起始/), tableCell(shot.sourceRow, /核心动作/),
      tableCell(shot.sourceRow, /落点|结束/), tableCell(shot.sourceRow, /连续性/)
    ].filter(Boolean).join("；") || shot.prompt;
    const clauses = splitVisualClauses(source)
      .filter((clause) => ownTerms.some((term) => clause.includes(term)))
      .map((clause) => allCharacterTerms.reduce((text, term) => ownTerms.includes(term) ? text : text.replaceAll(term, ""), clause))
      .map((clause) => clause.replace(/(?:台词|对白|说|喊|问|回答|命令)[：:]?.*$/, "").trim())
      .filter(Boolean);
    return [...new Set(clauses)].slice(0, 5).join("；") || `${parent.name}在本镜中的表情、姿态和受光保持准确`;
  };
  const sceneVisualGuide = (shot, sceneParent) => {
    const source = [
      tableCell(shot.sourceRow, /状态/), tableCell(shot.sourceRow, /空间|视线/),
      tableCell(shot.sourceRow, /连续性/), tableCell(shot.sourceRow, /提示词补充|补充/)
    ].filter(Boolean).join("；");
    const environmentClauses = splitVisualClauses(source)
      .filter((clause) => !allCharacterTerms.some((term) => clause.includes(term)))
      .filter((clause) => !/(?:对白|口型|说话|尾巴|手指|人物|角色)/.test(clause));
    return [`空间基准：${sceneParent.name}`, `机位与景别：${shotCameraGuide(shot)}`, ...environmentClauses.slice(0, 5)].join("；");
  };
  const viewAssets = [];
  shots.forEach((shot, index) => {
    const shotNo = Number(shot.no || index + 1);
    const shotLabel = String(shotNo).padStart(2, "0");
    const sceneName = String(shot.scene || "未指定场景").trim() || "未指定场景";
    const sceneDefinition = findSceneDefinition(sceneName);
    let sceneParent = sceneDefinition ? sceneByName.get(sceneDefinition.name) : sceneByName.get(sceneName);
    if (!sceneParent) {
      sceneParent = {
        id: id("asset"), type: "scene", role: "identity", name: sceneName, aliases: [],
        description: propDescriptionFromSource(source, [sceneName]) || `分镜中的固定空间“${sceneName}”，需要锁定结构、材质、陈设和光线。`,
        status: "draft", referenceUrl: "", version: 1, parentAssetId: "", shotNos: []
      };
      sceneAssets.push(sceneParent);
      sceneByName.set(sceneName, sceneParent);
    }
    viewAssets.push({
      id: id("asset"), type: "scene", role: "view", parentAssetId: sceneParent.id,
      name: `${sceneName} · 镜头${shotLabel}视角`, aliases: [], shotNos: [shotNo],
      description: [`对应镜头：${shot.title || shotLabel}`, sceneVisualGuide(shot, sceneParent)].join("；").slice(0, 1200),
      status: "draft", referenceUrl: "", version: 1
    });

    const participants = [...new Set([...splitAssetNames(shot.characters), shot.primaryCharacter]
      .map(normalizeParticipant).filter(Boolean))];
    const viewParentIds = new Set();
    for (const participant of participants) {
      if (nonHumanPrimary.test(participant)) continue;
      let parentName = findExistingCharacter(participant);
      if (!parentName && /分身/.test(participant)) parentName = [...characterMap.keys()].find((name) => /悟空/.test(name)) || "";
      const parent = characterByName.get(parentName || participant);
      if (!parent) continue;
      if (viewParentIds.has(parent.id)) continue;
      viewParentIds.add(parent.id);
      const participantGuide = participantVisualGuide(shot, parent);
      const wardrobeGuide = shotWardrobeGuide(shot, parent, participantGuide);
      viewAssets.push({
        id: id("asset"), type: "character", role: "view", parentAssetId: parent.id,
        name: `${parent.name} · 镜头${shotLabel}造型`, aliases: [], shotNos: [shotNo],
        description: [`身份基准：${parent.name}`, `对应镜头：${shot.title || shotLabel}`, `人物角度：${shotCameraGuide(shot)}`, `服装状态：${wardrobeGuide}`, `单人状态：${participantGuide}`, `受光环境：${sceneName}`].join("；").slice(0, 1600),
        status: "draft", referenceUrl: "", version: 1
      });
    }
  });
  const assets = [...characterAssets, ...sceneAssets, ...propAssets, ...viewAssets];
  return {
    summary: cleanMarkdown(source).slice(0, 800),
    shots: shots.map((shot, index) => ({
      ...shot,
      no: shot.no || index + 1,
      requestedDuration: Number(shot.duration) || 5,
      duration: normalizeShotDuration(shot.duration)
    })),
    assets,
    production: { mode: "storyboard", expectedShotCount: shots.length, bgm: [], sfx: [], grading: [], gradeParameters: [], subtitles: {}, effects: [], voices: [], voiceLines: [], replacementCharacters: (source.match(/\uFFFD/g) || []).length }
  };
}

function previewSource(sourceText) {
  const parsed = parseSource(sourceText);
  const warnings = [];
  const knowledgeReviews = [];
  const identityAssets = parsed.assets.filter((asset) => (asset.role || "identity") !== "view");
  const viewAssets = parsed.assets.filter((asset) => asset.role === "view");
  parsed.shots.forEach((shot) => {
    const postOnly = Boolean(shot.generationMeta?.postOnly);
    if (!postOnly && shot.requestedDuration !== shot.duration) {
      warnings.push(`镜头 ${String(shot.no).padStart(2, "0")}：原时长 ${shot.requestedDuration} 秒，已按 Seedance 档位调整为 ${shot.duration} 秒。`);
    }
    if (!String(shot.prompt || "").trim()) warnings.push(`镜头 ${String(shot.no).padStart(2, "0")}：缺少画面或提示词。`);
    if (!postOnly && !String(shot.scene || "").trim()) warnings.push(`镜头 ${String(shot.no).padStart(2, "0")}：未识别到场景。`);
    const review = postOnly
      ? { score: 100, status: "ready", detected: { primaryRecipe: "post-production", recipes: ["post-production"] }, issues: [] }
      : analyzeShot(shot, promptKnowledge);
    knowledgeReviews.push({ no: shot.no, ...review });
    review.issues
      .filter((issue) => issue.level !== "info" && issue.code !== "missing_scene" && issue.code !== "missing_prompt")
      .forEach((issue) => warnings.push(`镜头 ${String(shot.no).padStart(2, "0")}：${issue.message}`));
  });
  const duplicateNumbers = parsed.shots
    .map((shot) => shot.no)
    .filter((value, index, values) => values.indexOf(value) !== index);
  if (duplicateNumbers.length) warnings.push(`存在重复镜号：${[...new Set(duplicateNumbers)].join("、")}。`);
  if (parsed.production?.expectedShotCount && parsed.production.expectedShotCount !== parsed.shots.length) {
    warnings.push(`文档声明 ${parsed.production.expectedShotCount} 个镜头，但实际识别到 ${parsed.shots.length} 个，请检查镜号标题。`);
  }
  if (parsed.production?.replacementCharacters) {
    warnings.push(`原文包含 ${parsed.production.replacementCharacters} 个乱码替换符（�），建议回源修复，以免影响台词和提示词。`);
  }
  const localImageRefs = [...String(sourceText || "").matchAll(/!\[[^\]]*\]\((?!https?:\/\/|data:)([^)]+)\)/gi)];
  if (localImageRefs.length) {
    warnings.push(`检测到 ${localImageRefs.length} 个相对图片引用；当前会保留路径，但不会自动把图片设为人物或场景参考图。`);
  }
  return {
    shotCount: parsed.shots.length,
    characterCount: identityAssets.filter((asset) => asset.type === "character").length,
    sceneCount: identityAssets.filter((asset) => asset.type === "scene").length,
    propCount: identityAssets.filter((asset) => asset.type === "prop").length,
    characterViewCount: viewAssets.filter((asset) => asset.type === "character").length,
    sceneViewCount: viewAssets.filter((asset) => asset.type === "scene").length,
    assets: parsed.assets.map((asset) => ({
      type: asset.type, role: asset.role || "identity", name: asset.name, aliases: asset.aliases,
      description: asset.description, parentAssetId: asset.parentAssetId || "", shotNos: asset.shotNos || []
    })),
    shots: parsed.shots.map((shot) => ({
      no: shot.no,
      title: shot.title,
      duration: shot.duration,
      editDuration: Number(shot.editDuration || shot.duration),
      requestedDuration: shot.requestedDuration,
      postOnly: Boolean(shot.generationMeta?.postOnly),
      generationMeta: shot.generationMeta || {},
      characters: shot.characters,
      scene: shot.scene,
      prompt: shot.prompt,
      promptReview: knowledgeReviews.find((review) => review.no === shot.no)
    })),
    warnings,
    production: parsed.production,
    knowledge: {
      version: promptKnowledge.meta.version,
      averageScore: Math.round(knowledgeReviews.reduce((sum, review) => sum + review.score, 0) / Math.max(1, knowledgeReviews.length)),
      reviewCount: knowledgeReviews.filter((review) => review.status === "review").length,
      blockedCount: knowledgeReviews.filter((review) => review.status === "blocked").length
    }
  };
}

function mergeSourceManifest(existing, incoming) {
  const items = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])];
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item?.path || item?.relativePath || item?.name || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeProduction(existingValue, incomingValue, shotOffset = 0) {
  const existing = existingValue && typeof existingValue === "object" ? existingValue : {};
  const incoming = incomingValue && typeof incomingValue === "object" ? incomingValue : {};
  if (incoming.mode !== "composite") return Object.keys(existing).length ? existing : incoming;
  const shiftRange = (item) => ({
    ...item,
    shotStart: item.shotStart ? Number(item.shotStart) + shotOffset : item.shotStart,
    shotEnd: item.shotEnd ? Number(item.shotEnd) + shotOffset : item.shotEnd,
    shotNo: item.shotNo ? Number(item.shotNo) + shotOffset : item.shotNo
  });
  if (!Object.keys(existing).length || existing.mode !== "composite") {
    return { ...incoming, bgm: (incoming.bgm || []).map(shiftRange), sfx: (incoming.sfx || []).map(shiftRange), voiceLines: (incoming.voiceLines || []).map(shiftRange) };
  }
  return {
    ...existing,
    mode: "composite",
    expectedShotCount: Number(existing.expectedShotCount || 0) + Number(incoming.expectedShotCount || 0),
    bgm: [...(existing.bgm || []), ...(incoming.bgm || []).map(shiftRange)],
    sfx: [...(existing.sfx || []), ...(incoming.sfx || []).map(shiftRange)],
    grading: [...(existing.grading || []), ...(incoming.grading || [])],
    gradeParameters: [...(existing.gradeParameters || []), ...(incoming.gradeParameters || [])],
    effects: [...(existing.effects || []), ...(incoming.effects || [])],
    voices: [...(existing.voices || []), ...(incoming.voices || [])],
    voiceLines: [...(existing.voiceLines || []), ...(incoming.voiceLines || []).map(shiftRange)],
    subtitles: { ...(existing.subtitles || {}), ...(incoming.subtitles || {}) },
    replacementCharacters: Number(existing.replacementCharacters || 0) + Number(incoming.replacementCharacters || 0)
  };
}

function normalizeAssets(value) {
  return (Array.isArray(value) ? value : []).map((asset) => ({
    id: asset.id || id("asset"),
    type: asset.type === "scene" ? "scene" : asset.type === "prop" ? "prop" : "character",
    name: String(asset.name || "未命名资产").trim(),
    aliases: [...new Set((Array.isArray(asset.aliases) ? asset.aliases : String(asset.aliases || "").split(/[、,，/]+/))
      .map((item) => String(item || "").trim()).filter(Boolean))],
    description: String(asset.description || "").trim(),
    prompt: String(asset.prompt || "").trim(),
    role: asset.role === "view" ? "view" : "identity",
    parentAssetId: String(asset.parentAssetId || ""),
    shotNos: [...new Set((Array.isArray(asset.shotNos) ? asset.shotNos : []).map(Number).filter((item) => Number.isFinite(item)))],
    status: asset.status === "approved" ? "approved" : asset.status === "deprecated" ? "deprecated" : "draft",
    referenceUrl: String(asset.referenceUrl || asset.imageUrl || "").trim(),
    version: Number(asset.version || 1),
    updatedAt: asset.updatedAt || ""
  }));
}

function normalizeAssetName(value) {
  return String(value || "").toLowerCase().replace(/[\s·•・_—–:：,，、/／()（）[]【】]/g, "");
}

function assetNames(asset) {
  return [asset.name, ...(asset.aliases || [])].map(normalizeAssetName).filter(Boolean);
}

function resolveAssetName(assets, type, rawName) {
  const name = normalizeAssetName(rawName);
  if (!name) return { asset: null, ambiguous: [] };
  const contextualName = name
    .replace(/^(?:电视|手机|屏幕|镜子|回忆|照片|画面|背景)(?:中的?|里的?)/, "")
    .replace(/(?:远景|近景|背景|剪影|分身)$/, "");
  const queryNames = [...new Set([name, contextualName].filter(Boolean))];
  const candidates = assets.filter((asset) => asset.type === type && asset.role !== "view" && asset.status !== "deprecated");
  const exact = candidates.filter((asset) => assetNames(asset).some((candidate) => queryNames.includes(candidate)));
  if (exact.length === 1) return { asset: exact[0], ambiguous: [] };
  if (exact.length > 1) return { asset: null, ambiguous: exact };
  const partial = candidates.filter((asset) => assetNames(asset).some((candidate) => queryNames.some((query) => candidate.includes(query) || query.includes(candidate))));
  return partial.length === 1 ? { asset: partial[0], ambiguous: [] } : { asset: null, ambiguous: partial };
}

function splitAssetNames(value) {
  return String(value || "").split(/[、,，/]+/).map((item) => item.trim()).filter(Boolean);
}

function isGenericParticipant(value) {
  return /(?:车流|列车|乘客(?:群)?|食客|救援者|救援队|消防员|特警|记者|媒体|伤者|路人|人群|群演|剪影|司机|母亲|老人|儿童|小女孩|分身)$/.test(String(value || "").trim());
}

function normalizeShotBindings(value) {
  const binding = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: binding.mode === "manual" ? "manual" : "auto",
    characterIds: [...new Set(Array.isArray(binding.characterIds) ? binding.characterIds.map(String) : [])],
    sceneId: String(binding.sceneId || ""),
    propIds: [...new Set(Array.isArray(binding.propIds) ? binding.propIds.map(String) : [])],
    unresolved: Array.isArray(binding.unresolved) ? binding.unresolved : [],
    ignored: Array.isArray(binding.ignored) ? binding.ignored : [],
    ambiguous: Array.isArray(binding.ambiguous) ? binding.ambiguous : [],
    updatedAt: binding.updatedAt || ""
  };
}

function buildAutoShotBindings(assetsValue, shot) {
  const assets = normalizeAssets(assetsValue);
  const shotNo = Number(shot.shot_no || shot.no || 0);
  const targetedCharacterViews = assets.filter((asset) => asset.type === "character" && asset.role === "view" && asset.shotNos.includes(shotNo) && asset.status !== "deprecated");
  const targetedSceneViews = assets.filter((asset) => asset.type === "scene" && asset.role === "view" && asset.shotNos.includes(shotNo) && asset.status !== "deprecated");
  const characterIds = [];
  const unresolved = [];
  const ignored = [];
  const ambiguous = [];
  if (targetedCharacterViews.length) {
    characterIds.push(...targetedCharacterViews.map((asset) => asset.id));
  } else {
    for (const name of splitAssetNames(shot.characters)) {
      const resolved = resolveAssetName(assets, "character", name);
      if (resolved.asset) characterIds.push(resolved.asset.id);
      else if (resolved.ambiguous.length) ambiguous.push({ type: "character", name, assetIds: resolved.ambiguous.map((asset) => asset.id) });
      else if (isGenericParticipant(name)) ignored.push({ type: "character", name, reason: "generic_extra" });
      else unresolved.push({ type: "character", name });
    }
  }
  let sceneId = "";
  const sceneName = String(shot.scene || "").trim();
  if (targetedSceneViews.length === 1) {
    sceneId = targetedSceneViews[0].id;
  } else if (targetedSceneViews.length > 1) {
    ambiguous.push({ type: "scene", name: sceneName || `镜头${shotNo}场景`, assetIds: targetedSceneViews.map((asset) => asset.id) });
  } else if (sceneName) {
    const resolved = resolveAssetName(assets, "scene", sceneName);
    if (resolved.asset) sceneId = resolved.asset.id;
    else if (resolved.ambiguous.length) ambiguous.push({ type: "scene", name: sceneName, assetIds: resolved.ambiguous.map((asset) => asset.id) });
    else unresolved.push({ type: "scene", name: sceneName });
  }
  const promptText = normalizeAssetName([shot.title, shot.characters, shot.scene, shot.prompt].filter(Boolean).join(" "));
  const propIds = assets.filter((asset) => asset.type === "prop" && asset.status !== "deprecated" && assetNames(asset).some((name) => name && promptText.includes(name))).map((asset) => asset.id);
  return normalizeShotBindings({ mode: "auto", characterIds, sceneId, propIds, unresolved, ignored, ambiguous, updatedAt: now() });
}

function effectiveShotBindings(assetsValue, shot) {
  const assets = normalizeAssets(assetsValue);
  const stored = normalizeShotBindings(safeJson(shot.asset_bindings_json || "{}", {}));
  const knownIds = new Set(assets.map((asset) => asset.id));
  const hasStoredIds = [...stored.characterIds, stored.sceneId, ...stored.propIds].filter(Boolean).some((assetId) => knownIds.has(assetId));
  if (stored.mode === "manual" || hasStoredIds || stored.updatedAt) return stored;
  return buildAutoShotBindings(assets, shot);
}

function assetsForShot(assetsValue, shot) {
  const assets = normalizeAssets(assetsValue);
  const bindings = effectiveShotBindings(assets, shot);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const orderedIds = [...bindings.characterIds, bindings.sceneId, ...bindings.propIds].filter(Boolean);
  return orderedIds.map((assetId) => byId.get(assetId)).filter(Boolean);
}

function assetReadinessForShot(assetsValue, shot) {
  const generationMeta = safeJson(shot.generation_meta_json || shot.generationMeta || "{}", {});
  if (generationMeta.postOnly) {
    return { ready: true, bindings: normalizeShotBindings({ mode: "auto" }), matched: [], missing: [], ignored: [], ambiguous: [], requiredCount: 0, postOnly: true };
  }
  const assets = normalizeAssets(assetsValue);
  const bindings = effectiveShotBindings(assets, shot);
  const matched = assetsForShot(assets, { ...shot, asset_bindings_json: JSON.stringify(bindings) });
  const missingAssets = matched.filter((asset) => asset.status !== "approved" || !asset.referenceUrl);
  const unresolved = [...bindings.unresolved, ...bindings.ambiguous].map((item) => item.name);
  const requiredCount = bindings.characterIds.length + (bindings.sceneId ? 1 : 0) + bindings.propIds.length;
  return {
    ready: missingAssets.length === 0 && unresolved.length === 0 && requiredCount > 0,
    bindings,
    matched: matched.map((asset) => ({
      id: asset.id, type: asset.type, name: asset.name, aliases: asset.aliases, description: asset.description,
      role: asset.role, parentAssetId: asset.parentAssetId, shotNos: asset.shotNos,
      status: asset.status, referenceUrl: asset.referenceUrl, version: asset.version, updatedAt: asset.updatedAt
    })),
    missing: [...missingAssets.map((asset) => asset.name), ...unresolved],
    ignored: bindings.ignored,
    ambiguous: bindings.ambiguous,
    requiredCount
  };
}

function referenceBindingForAssets(referenceAssets) {
  return referenceAssets.length
    ? `参考图绑定：${referenceAssets.map((asset, assetIndex) => {
      const kind = asset.type === "character" ? "角色" : asset.type === "scene" ? "场景" : "道具";
      const anchor = String(asset.description || "").trim().slice(0, 500);
      return `图片${assetIndex + 1}为${kind}“${asset.name}”（v${asset.version || 1}${anchor ? `，锁定设定：${anchor}` : ""}）`;
    }).join("；")}。每次提到对应主体时保持该参考图中的身份、外观和空间基准。`
    : "纯文本试片：本次未使用已批准参考图，一致性风险较高，不应直接作为跨镜定稿。";
}

function findAssetRecord(assetId) {
  const projects = db.prepare("SELECT id, assets_json FROM projects WHERE deleted_at = ''").all();
  for (const project of projects) {
    const assets = normalizeAssets(safeJson(project.assets_json, []));
    const index = assets.findIndex((asset) => asset.id === assetId);
    if (index >= 0) return { projectId: project.id, assets, index, asset: assets[index] };
  }
  return null;
}

function saveAssetRecord(record, asset) {
  const nextName = String(asset.name ?? record.asset.name).trim();
  const aliases = new Set([...(record.asset.aliases || []), ...(Array.isArray(asset.aliases) ? asset.aliases : [])].map((item) => String(item || "").trim()).filter(Boolean));
  if (nextName !== record.asset.name) aliases.add(record.asset.name);
  aliases.delete(nextName);
  record.assets[record.index] = { ...record.asset, ...asset, name: nextName, aliases: [...aliases], id: record.asset.id, updatedAt: now() };
  db.prepare("UPDATE projects SET assets_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(record.assets), now(), record.projectId);
  return record.assets[record.index];
}

function saveShotBindings(shotId, bindings) {
  const normalized = normalizeShotBindings({ ...bindings, updatedAt: now() });
  db.prepare("UPDATE shots SET asset_bindings_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(normalized), now(), shotId);
  return normalized;
}

function rebindProjectShots(projectId, force = false) {
  const project = db.prepare("SELECT assets_json FROM projects WHERE id = ? AND deleted_at = ''").get(projectId);
  if (!project) return;
  const assets = normalizeAssets(safeJson(project.assets_json, []));
  const shots = db.prepare(`SELECT shots.* FROM shots JOIN sequences ON sequences.id = shots.sequence_id
    WHERE sequences.project_id = ? ORDER BY sequences.sort_order, shots.sort_order`).all(projectId);
  for (const shot of shots) {
    const stored = normalizeShotBindings(safeJson(shot.asset_bindings_json || "{}", {}));
    if (!force && stored.mode === "manual") continue;
    saveShotBindings(shot.id, buildAutoShotBindings(assets, shot));
  }
}

function appendProjectShots(projectId, payload) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at = ''").get(projectId);
  if (!project) throw Object.assign(new Error("项目不存在"), { statusCode: 404 });
  const parsed = parseSource(payload.sourceText || "");
  const createdAt = now();
  const sequenceStart = Number(db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM sequences WHERE project_id = ?").get(projectId).value) + 1;
  const shotStart = Number(db.prepare(`SELECT COALESCE(MAX(shots.sort_order), -1) AS value FROM shots
    JOIN sequences ON sequences.id = shots.sequence_id WHERE sequences.project_id = ?`).get(projectId).value) + 1;
  const shotNoStart = Number(db.prepare(`SELECT COALESCE(MAX(shots.shot_no), 0) AS value FROM shots
    JOIN sequences ON sequences.id = shots.sequence_id WHERE sequences.project_id = ?`).get(projectId).value) + 1;
  const insertSequence = db.prepare("INSERT INTO sequences (id, project_id, name, scene, sort_order) VALUES (?, ?, ?, ?, ?)");
  const insertShot = db.prepare(`INSERT INTO shots
    (id, sequence_id, shot_no, title, prompt, duration_sec, edit_duration_sec, generation_meta_json, characters, scene, status, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`);
  let sequenceIndex = -1;
  let sequenceId = "";
  let lastScene = null;
  db.exec("BEGIN");
  try {
    parsed.shots.forEach((shot, index) => {
      const scene = String(shot.scene || "未指定场景").trim();
      if (!sequenceId || scene !== lastScene) {
        sequenceIndex += 1;
        sequenceId = id("sequence");
        insertSequence.run(sequenceId, projectId, scene === "未指定场景" ? `追加场次 ${sequenceStart + sequenceIndex + 1}` : scene, scene, sequenceStart + sequenceIndex);
        lastScene = scene;
      }
      insertShot.run(
        id("shot"), sequenceId, shotNoStart + index,
        shot.title || `镜头 ${shotNoStart + index}`, shot.prompt || "", shot.duration || 5,
        Number(shot.editDuration || shot.duration || 5), JSON.stringify(shot.generationMeta || {}),
        shot.characters || "", shot.scene || "", shotStart + index, createdAt
      );
    });
    const existingAssets = safeJson(project.assets_json, []);
    const assetKeys = new Set(existingAssets.map((asset) => `${asset.type}:${asset.name}`));
    const mergedAssets = [...existingAssets, ...parsed.assets.filter((asset) => !assetKeys.has(`${asset.type}:${asset.name}`))];
    const sourceManifest = mergeSourceManifest(safeJson(project.source_manifest_json, []), payload.sourceManifest);
    const sourceText = [project.source_text, String(payload.sourceText || "")].filter(Boolean).join("\n\n---\n\n");
    const production = mergeProduction(safeJson(project.production_json, {}), parsed.production, shotNoStart - 1);
    db.prepare("UPDATE projects SET source_text = ?, assets_json = ?, production_json = ?, source_manifest_json = ?, updated_at = ? WHERE id = ?")
      .run(sourceText, JSON.stringify(mergedAssets), JSON.stringify(production), JSON.stringify(sourceManifest), createdAt, projectId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  rebindProjectShots(projectId);
  return getProject(projectId);
}

function createProject(payload) {
  const projectId = id("project");
  const createdAt = now();
  const parsed = parseSource(payload.sourceText || "");
  db.prepare(`INSERT INTO projects
    (id, name, source_text, story_summary, visual_style, aspect_ratio, resolution, audio_strategy, assets_json, production_json, source_manifest_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      projectId,
      String(payload.name || "未命名短剧").trim(),
      String(payload.sourceText || ""),
      parsed.summary,
      String(payload.visualStyle || "电影级生活写实摄影，自然表演，统一人物与场景，稳定镜头"),
      String(payload.aspectRatio || "9:16"),
      String(payload.resolution || "720p"),
      String(payload.audioStrategy || "post_dub"),
      JSON.stringify(parsed.assets),
      JSON.stringify(parsed.production || {}),
      JSON.stringify(Array.isArray(payload.sourceManifest) ? payload.sourceManifest : []),
      createdAt,
      createdAt
    );

  let sequenceIndex = -1;
  let lastScene = null;
  let sequenceId = "";
  const insertSequence = db.prepare("INSERT INTO sequences (id, project_id, name, scene, sort_order) VALUES (?, ?, ?, ?, ?)");
  const insertShot = db.prepare(`INSERT INTO shots
    (id, sequence_id, shot_no, title, prompt, duration_sec, edit_duration_sec, generation_meta_json, characters, scene, status, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`);
  parsed.shots.forEach((shot, index) => {
    const scene = String(shot.scene || "未指定场景").trim();
    if (!sequenceId || scene !== lastScene) {
      sequenceIndex += 1;
      sequenceId = id("sequence");
      insertSequence.run(sequenceId, projectId, scene === "未指定场景" ? `场次 ${sequenceIndex + 1}` : scene, scene, sequenceIndex);
      lastScene = scene;
    }
    insertShot.run(
      id("shot"), sequenceId, shot.no || index + 1,
      shot.title || `镜头 ${index + 1}`, shot.prompt || "", shot.duration || 5,
      Number(shot.editDuration || shot.duration || 5), JSON.stringify(shot.generationMeta || {}),
      shot.characters || "", shot.scene || "", index, createdAt
    );
  });
  rebindProjectShots(projectId, true);
  return getProject(projectId);
}

function reparseProjectAssets(projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at = ''").get(projectId);
  if (!project) throw Object.assign(new Error("项目不存在"), { statusCode: 404 });
  const parsed = parseSource(project.source_text || "");
  const storedShots = db.prepare(`SELECT shots.* FROM shots
    JOIN sequences ON sequences.id = shots.sequence_id
    WHERE sequences.project_id = ? ORDER BY sequences.sort_order, shots.sort_order`).all(projectId);
  if (!parsed.shots.length || parsed.shots.length !== storedShots.length) {
    throw Object.assign(new Error("原始资料与当前镜头数不一致，为避免覆盖手动编辑，已停止重新识别。"), { statusCode: 409 });
  }
  const existing = normalizeAssets(safeJson(project.assets_json, []));
  const parsedAssets = normalizeAssets(parsed.assets);
  const parsedToFinalId = new Map();
  const reparsed = [];
  for (const asset of parsedAssets) {
    const exactPrevious = existing.find((item) => item.type === asset.type && item.role === asset.role && item.name === asset.name);
    const previous = exactPrevious || (asset.role === "identity" ? resolveAssetName(existing, asset.type, asset.name).asset : null);
    const next = previous
      ? { ...asset, ...previous, aliases: [...new Set([...(previous.aliases || []), ...(asset.aliases || []), asset.name])].filter((name) => name !== previous.name), description: asset.description || previous.description }
      : asset;
    if (asset.parentAssetId) next.parentAssetId = parsedToFinalId.get(asset.parentAssetId) || asset.parentAssetId;
    parsedToFinalId.set(asset.id, next.id);
    reparsed.push(next);
  }
  const keys = new Set(reparsed.map((asset) => `${asset.type}:${asset.name}`));
  const preservedLegacy = existing
    .filter((asset) => asset.referenceUrl && !keys.has(`${asset.type}:${asset.name}`))
    .map((asset) => ({ ...asset, status: "deprecated" }));
  const finalAssets = [...reparsed, ...preservedLegacy];
  db.exec("BEGIN");
  try {
    storedShots.forEach((shot, index) => {
      const parsedShot = parsed.shots[index];
      db.prepare("UPDATE shots SET characters = ?, scene = ?, edit_duration_sec = ?, generation_meta_json = ?, updated_at = ? WHERE id = ?")
        .run(
          parsedShot.characters || "",
          parsedShot.scene || shot.scene || "",
          Number(parsedShot.editDuration || parsedShot.duration || shot.edit_duration_sec || shot.duration_sec),
          JSON.stringify(parsedShot.generationMeta || {}),
          now(), shot.id
        );
    });
    db.prepare("UPDATE projects SET assets_json = ?, production_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(finalAssets), JSON.stringify(parsed.production || {}), now(), projectId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  storedShots.forEach((shot, index) => {
    const parsedShot = parsed.shots[index] || {};
    const bindingSource = {
      ...shot,
      characters: parsedShot.characters || shot.characters,
      scene: parsedShot.scene || shot.scene,
      prompt: [shot.prompt, parsedShot.prompt].filter(Boolean).join("\n")
    };
    saveShotBindings(shot.id, buildAutoShotBindings(finalAssets, bindingSource));
  });
  return getProject(projectId);
}

function getProject(projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at = ''").get(projectId);
  if (!project) return null;
  const assets = normalizeAssets(safeJson(project.assets_json, []));
  const unboundCount = Number(db.prepare(`SELECT COUNT(*) AS value FROM shots JOIN sequences ON sequences.id = shots.sequence_id
    WHERE sequences.project_id = ? AND (shots.asset_bindings_json = '' OR shots.asset_bindings_json = '{}')`).get(projectId).value);
  if (unboundCount) rebindProjectShots(projectId);
  const sequences = db.prepare("SELECT * FROM sequences WHERE project_id = ? ORDER BY sort_order").all(projectId);
  const shotQuery = db.prepare("SELECT * FROM shots WHERE sequence_id = ? ORDER BY sort_order");
  const takeQuery = db.prepare(`SELECT takes.*, jobs.request_json AS job_request_json
    FROM takes LEFT JOIN jobs ON jobs.take_id = takes.id
    WHERE takes.shot_id = ? ORDER BY takes.take_no DESC`);
  return {
    id: project.id,
    name: project.name,
    sourceText: project.source_text,
    storySummary: project.story_summary,
    visualStyle: project.visual_style,
    aspectRatio: project.aspect_ratio,
    resolution: project.resolution,
    audioStrategy: project.audio_strategy,
    assets,
    production: safeJson(project.production_json, {}),
    sourceManifest: safeJson(project.source_manifest_json, []),
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    sequences: sequences.map((sequence) => ({
      id: sequence.id,
      name: sequence.name,
      scene: sequence.scene,
      sortOrder: sequence.sort_order,
      shots: shotQuery.all(sequence.id).map((shot) => {
        const assetReadiness = assetReadinessForShot(assets, shot);
        return {
          id: shot.id,
          no: shot.shot_no,
          title: shot.title,
          prompt: shot.prompt,
          duration: shot.duration_sec,
          editDuration: Number(shot.edit_duration_sec || shot.duration_sec),
          generationMeta: safeJson(shot.generation_meta_json, {}),
          postOnly: Boolean(safeJson(shot.generation_meta_json, {}).postOnly),
          characters: shot.characters,
          scene: shot.scene,
          promptReview: analyzeShot({ ...shot, duration: shot.duration_sec }, promptKnowledge),
          assetReadiness,
          status: deriveShotStatus(shot),
          preferredTakeId: shot.preferred_take_id,
          sortOrder: shot.sort_order,
          updatedAt: shot.updated_at,
          takes: takeQuery.all(shot.id).map(mapTake)
        };
      })
    }))
  };
}

function auditProjectPrompts(projectId) {
  const project = db.prepare("SELECT id, name FROM projects WHERE id = ? AND deleted_at = ''").get(projectId);
  if (!project) throw Object.assign(new Error("项目不存在"), { statusCode: 404 });
  const shots = db.prepare(`SELECT shots.* FROM shots JOIN sequences ON sequences.id = shots.sequence_id
    WHERE sequences.project_id = ? ORDER BY sequences.sort_order, shots.sort_order`).all(projectId);
  const results = shots.map((shot) => {
    const review = analyzeShot({ ...shot, duration: shot.duration_sec }, promptKnowledge);
    return {
      id: shot.id,
      no: shot.shot_no,
      title: shot.title,
      score: review.score,
      status: review.status,
      primaryRecipe: review.detected.primaryRecipe,
      recipes: review.detected.recipes,
      issues: review.issues
    };
  });
  const issueCounts = {};
  const recipeCounts = {};
  results.forEach((item) => {
    item.issues.forEach((issue) => { issueCounts[issue.code] = Number(issueCounts[issue.code] || 0) + 1; });
    if (item.primaryRecipe) recipeCounts[item.primaryRecipe] = Number(recipeCounts[item.primaryRecipe] || 0) + 1;
  });
  return {
    projectId,
    projectName: project.name,
    knowledgeVersion: promptKnowledge.meta.version,
    shotCount: results.length,
    averageScore: Math.round(results.reduce((sum, item) => sum + item.score, 0) / Math.max(1, results.length)),
    readyCount: results.filter((item) => item.status === "ready").length,
    reviewCount: results.filter((item) => item.status === "review").length,
    blockedCount: results.filter((item) => item.status === "blocked").length,
    issueCounts,
    recipeCounts,
    shots: results
  };
}

function mapTake(take) {
  const request = safeJson(take.job_request_json, {}) || {};
  return {
    id: take.id,
    shotId: take.shot_id,
    no: take.take_no,
    status: take.status,
    videoUrl: take.local_url || take.video_url,
    localUrl: take.local_url,
    remoteVideoUrl: take.video_url,
    resolution: String(request.resolution || ""),
    prompt: take.prompt,
    taskId: take.task_id,
    approved: Boolean(take.approved),
    rejected: Boolean(take.rejected),
    changeRequest: take.change_request,
    error: take.error,
    createdAt: take.created_at,
    updatedAt: take.updated_at
  };
}

function deriveShotStatus(shot) {
  if (safeJson(shot.generation_meta_json || "{}", {}).postOnly) return "post_only";
  if (shot.preferred_take_id) return "preferred";
  const statuses = db.prepare("SELECT status, approved FROM takes WHERE shot_id = ?").all(shot.id);
  if (statuses.some((item) => ["queued", "submitting", "submitted", "processing"].includes(item.status))) return "generating";
  if (statuses.some((item) => item.approved)) return "usable";
  if (statuses.some((item) => item.status === "succeeded")) return "has_candidate";
  if (statuses.some((item) => item.status === "failed")) return "failed";
  return shot.prompt.trim() ? "ready" : "empty";
}

function compilePrompt(shot, changeRequest = "") {
  const audioRule = shot.audio_strategy === "native"
    ? "需要自然生成与画面同步的环境声和指定对白。"
    : shot.audio_strategy === "no_dialogue"
      ? "无对白、无旁白，人物不要说话，只保留自然环境声。"
      : "画面优先，人物如有台词只做自然说话动作，不生成可辨识对白，后期统一配音。";
  const compiledShot = changeRequest ? { ...shot, prompt: `${shot.prompt}\n${changeRequest}` } : shot;
  const knowledgeDirectives = buildKnowledgeDirectives(compiledShot, promptKnowledge);
  const generationMeta = safeJson(shot.generation_meta_json || "{}", {});
  const production = safeJson(shot.production_json || "{}", {});
  const grading = (production.grading || []).filter((item) => shotTargetIncludes(item.target, shot.shot_no));
  return [
    `${shot.aspect_ratio}画幅，${shot.duration_sec}秒单一连续镜头，无切镜。`,
    shot.characters ? `主体：${shot.characters}。` : "",
    `核心画面与动作：${shot.prompt}`,
    shot.scene ? `场景：${shot.scene}。` : "",
    changeRequest ? `本次修改优先级最高：只调整“${changeRequest}”，其他设定保持不变。` : "",
    ...knowledgeDirectives.lines,
    generationMeta.negativePrompt ? `禁止项：${generationMeta.negativePrompt}` : "",
    grading.length ? `后期调色意图（生成阶段预留可调空间）：${grading.map((item) => `${item.primary}${item.secondary ? `，${item.secondary}` : ""}`).join("；")}。` : "",
    `全片视觉基准：${shot.visual_style}。`,
    `声音策略：${audioRule}`
  ].filter(Boolean).join("\n");
}

function selectIdentityWardrobe(description) {
  const segments = String(description || "").split(/[；;。\n]/).map((item) => item.trim()).filter(Boolean);
  const wardrobe = /(?:马甲|战甲|披风|盔甲|甲胄|衣|服|裙|裤|鞋|靴|围裙|制服|战袍|战衣|雨衣|外套|头冠|发箍|帽|头巾)/;
  return segments.find((item) => /(?:战斗本体|基础造型|默认造型|标准造型)/.test(item) && wardrobe.test(item))
    || segments.find((item) => wardrobe.test(item))
    || "按人物设定选择一套明确的默认服装";
}

function buildAssetPrompt(asset, visualStyle = "", parentAsset = null) {
  const isView = asset.role === "view";
  const baseWardrobe = asset.type === "character" && !isView ? selectIdentityWardrobe(asset.description) : "";
  const base = asset.type === "character" && isView
    ? `为高标准短剧制作生成一张人物逐镜视觉参考图。人物与镜头：${asset.name}。输入参考图只用于锁定同一人物的脸型、五官、毛发或发型、体型、肤色和标志性身份细节；本镜服装必须以“服装状态”字段为最高优先级，不得因为基础参考图而沿用、叠穿或混合错误的外层服装。仅按照以下分镜要求改变摄影角度、景别、姿态、表情、服装状态与受光：${asset.description}。画面只保留该人物，构图必须能明确指导后续视频镜头，不出现其他人物、文字、Logo或水印。`
    : asset.type === "character"
    ? `为短剧制作生成一张单人物身份基准图。人物：${asset.name}。完整人物档案：${asset.description || "按角色名称建立清楚、稳定、可复用的外观"}。本张图只采用一套身份基准服装：“${baseWardrobe}”。若档案包含战斗、工作、日常等多套服装，它们是不同场合的互斥状态，严禁融合、叠穿或把其他场合的马甲、外套、制服加到本张图。单人，正面或轻微四分之三视角，自然站姿，完整呈现固定发型、五官、体型、当前服装、鞋子与标志性配饰；均匀柔光，纯净中性背景，不出现其他人物，不出现文字。`
    : asset.type === "scene" && isView
      ? `为高标准短剧制作生成一张场景逐镜视觉参考图。场景与镜头：${asset.name}。严格继承输入参考图中的空间结构、入口、门窗、材质、陈设、色彩和时代特征，仅按以下分镜要求改变机位、镜头方向、景别、时间、天气、状态和主光方向：${asset.description}。空镜，不出现人物、文字、Logo或水印，空间关系必须可直接指导后续视频镜头。`
    : asset.type === "scene"
      ? `为短剧制作生成一张空场景参考图。场景：${asset.name}。设定：${asset.description || "建立清楚、稳定、可复用的空间结构"}。全景，明确前中后景、入口、门窗、关键陈设、材质配色、时间天气与主光方向；场景中不要出现人物，不出现文字。`
      : `为短剧制作生成关键道具参考图。道具：${asset.name}。设定：${asset.description}。清楚展示形态、比例、材质与关键细节，中性背景，不出现文字。`;
  return [
    base,
    visualStyle ? `项目视觉基准：${visualStyle}。` : "",
    parentAsset?.prompt ? `身份基准补充要求（所有逐镜图继续生效）：${parentAsset.prompt}。` : "",
    asset.prompt ? `本资产补充要求：${asset.prompt}。` : "",
    "真实材质，结构清楚，便于后续视频模型保持一致。"
  ].filter(Boolean).join("\n");
}

async function saveAssetImageBuffer(projectId, assetId, buffer, extension = ".png") {
  const folder = path.join(outputsDir, projectId, "assets");
  await fsp.mkdir(folder, { recursive: true });
  const fileName = `${assetId}-${Date.now()}${extension}`;
  await fsp.writeFile(path.join(folder, fileName), buffer);
  return `/outputs/${projectId}/assets/${fileName}`;
}

async function saveAssetDataUrl(projectId, assetId, dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw Object.assign(new Error("只支持 PNG、JPG、WEBP 图片"), { statusCode: 422 });
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw Object.assign(new Error("参考图必须小于 10MB"), { statusCode: 413 });
  const extension = /png/i.test(match[1]) ? ".png" : /webp/i.test(match[1]) ? ".webp" : ".jpg";
  return saveAssetImageBuffer(projectId, assetId, buffer, extension);
}

async function generateAssetImage(record) {
  const apiKey = process.env.SEEDANCE_API_KEY || process.env.SEEDREAM_API_KEY || process.env.ARK_API_KEY;
  if (!apiKey) throw Object.assign(new Error("未配置 Seedance/方舟 API Key；可以先上传已有参考图。"), { statusCode: 503 });
  const project = db.prepare("SELECT visual_style FROM projects WHERE id = ? AND deleted_at = ''").get(record.projectId);
  if (!project) throw Object.assign(new Error("项目不存在"), { statusCode: 404 });
  const baseUrl = String(process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com").replace(/\/+$/, "");
  let parentReference = "";
  let parentAsset = null;
  if (record.asset.role === "view" && record.asset.parentAssetId) {
    parentAsset = record.assets.find((asset) => asset.id === record.asset.parentAssetId && asset.status !== "deprecated");
    if (!parentAsset?.referenceUrl) {
      throw Object.assign(new Error(`请先生成基础资产“${parentAsset?.name || "身份/空间基准"}”，再生成该镜头视觉图。`), { statusCode: 409 });
    }
    parentReference = await imageUrlForSeedanceContent(parentAsset.referenceUrl);
    if (!parentReference) throw Object.assign(new Error("基础资产参考图无法读取，请重新上传或生成。"), { statusCode: 409 });
  }
  const imageRequest = {
    model: process.env.SEEDREAM_MODEL || "doubao-seedream-5-0-260128",
    prompt: buildAssetPrompt(record.asset, project.visual_style, parentAsset),
    size: process.env.SEEDREAM_SIZE || "2k",
    response_format: "url",
    watermark: false
  };
  if (parentReference) imageRequest.image = parentReference;
  const response = await fetch(`${baseUrl}/api/v3/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(imageRequest),
    signal: AbortSignal.timeout(Number(process.env.SEEDREAM_TIMEOUT_MS || 600000))
  });
  const rawText = await response.text();
  const raw = safeJson(rawText, { message: rawText });
  if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `资产图片生成失败（${response.status}）`);
  const image = raw?.data?.[0] || {};
  let localUrl = "";
  if (image.url) {
    const imageResponse = await fetch(image.url, { signal: AbortSignal.timeout(120000) });
    if (!imageResponse.ok) throw new Error(`资产图片下载失败（${imageResponse.status}）`);
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const extension = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
    localUrl = await saveAssetImageBuffer(record.projectId, record.asset.id, Buffer.from(await imageResponse.arrayBuffer()), extension);
  } else if (image.b64_json) {
    localUrl = await saveAssetImageBuffer(record.projectId, record.asset.id, Buffer.from(image.b64_json, "base64"), ".png");
  }
  if (!localUrl) throw new Error("图片服务未返回可用图片");
  return saveAssetRecord(record, { referenceUrl: localUrl, status: "draft", version: record.asset.version + 1 });
}

async function imageUrlForSeedanceContent(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/") || raw.startsWith("asset://") || /^https?:\/\//.test(raw)) return raw;
  if (!raw.startsWith("/outputs/")) return "";
  const relative = decodeURIComponent(raw.replace(/^\//, "").split(/[?#]/)[0]);
  const filePath = path.resolve(rootDir, relative);
  if (!filePath.startsWith(path.resolve(outputsDir) + path.sep)) return "";
  try {
    const buffer = await fsp.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  }
}

function getSeedanceModel() {
  const configured = process.env.SEEDANCE_MODEL || "doubao-seedance-2-0-260128";
  // 早期开发环境使用过不存在的 `-pro-` 别名；Ark 正式模型名不带该段。
  return configured === "doubao-seedance-2-0-pro-260128"
    ? "doubao-seedance-2-0-260128"
    : configured;
}

function seedanceResolutions() {
  const model = getSeedanceModel().toLowerCase();
  return /(?:fast|mini)/.test(model) ? ["720p"] : ["720p", "1080p"];
}

function getCapabilities() {
  const ffmpeg = spawnSync(ffmpegPath, ["-version"], { stdio: "ignore" }).status === 0;
  return {
    seedance: {
      available: Boolean(process.env.SEEDANCE_API_KEY || process.env.ARK_API_KEY),
      model: getSeedanceModel(),
      resolutions: seedanceResolutions(),
      durations: [5, 10, 15],
      aspectRatios: ["9:16", "16:9", "1:1"],
      supportsAudio: true
    },
    textParser: { available: false, mode: "local-rules" },
    promptKnowledge: {
      available: true,
      version: promptKnowledgeSummary.version,
      sourceCount: promptKnowledgeSummary.sourceCount,
      lexiconCount: promptKnowledgeSummary.lexiconCount,
      patternCount: promptKnowledgeSummary.patternCount,
      recipeCount: promptKnowledgeSummary.recipeCount
    },
    imageGenerator: {
      available: Boolean(process.env.SEEDANCE_API_KEY || process.env.SEEDREAM_API_KEY || process.env.ARK_API_KEY),
      model: process.env.SEEDREAM_MODEL || "doubao-seedream-5-0-260128",
      keySource: process.env.SEEDANCE_API_KEY ? "seedance" : process.env.SEEDREAM_API_KEY ? "seedream" : process.env.ARK_API_KEY ? "ark" : ""
    },
    ffmpeg: { available: ffmpeg }
  };
}

async function submitShotGeneration(shotId, payload) {
  const shot = db.prepare(`SELECT shots.*, projects.id AS project_id, projects.visual_style, projects.aspect_ratio,
    projects.resolution, projects.audio_strategy, projects.assets_json, projects.production_json
    FROM shots JOIN sequences ON sequences.id = shots.sequence_id
    JOIN projects ON projects.id = sequences.project_id WHERE shots.id = ? AND projects.deleted_at = ''`).get(shotId);
  if (!shot) throw Object.assign(new Error("镜头不存在"), { statusCode: 404 });
  if (safeJson(shot.generation_meta_json || "{}", {}).postOnly) {
    throw Object.assign(new Error("这是后期制作镜头，不调用 Seedance。请在粗剪阶段制作字幕卡或图形层。"), { statusCode: 409 });
  }
  const assetReadiness = assetReadinessForShot(safeJson(shot.assets_json, []), shot);
  if (!assetReadiness.ready && !payload.allowTextOnly) {
    const names = assetReadiness.missing.length ? `：${assetReadiness.missing.join("、")}` : "";
    throw Object.assign(new Error(`本镜人物/场景参考资产尚未批准${names}。请先完成资产准备，或明确勾选“纯文本试片”。`), { statusCode: 409 });
  }
  const referenceAssets = assetReadiness.matched.filter((asset) => asset.status === "approved" && asset.referenceUrl);
  const apiKey = process.env.SEEDANCE_API_KEY || process.env.ARK_API_KEY;
  if (!apiKey) throw Object.assign(new Error("未配置 Seedance API Key，当前只能编辑项目。"), { statusCode: 503 });
  let upgradeSource = null;
  if (payload.upgradeFromTakeId) {
    upgradeSource = db.prepare("SELECT * FROM takes WHERE id = ? AND shot_id = ?").get(String(payload.upgradeFromTakeId), shotId);
    if (!upgradeSource) throw Object.assign(new Error("要升级的主选候选不存在。"), { statusCode: 404 });
    if (shot.preferred_take_id !== upgradeSource.id) throw Object.assign(new Error("只能升级当前主选候选。"), { statusCode: 409 });
    if (upgradeSource.status !== "succeeded") throw Object.assign(new Error("只有生成成功的主选候选才能升级 1080p。"), { statusCode: 409 });
    if (!seedanceResolutions().includes("1080p")) throw Object.assign(new Error("当前 Seedance 模型最高支持 720p，请切换完整模型后再升级。"), { statusCode: 409 });
  }
  const count = upgradeSource ? 1 : [1, 2, 4].includes(Number(payload.count)) ? Number(payload.count) : 1;
  const latest = db.prepare("SELECT COALESCE(MAX(take_no), 0) AS value FROM takes WHERE shot_id = ?").get(shotId).value;
  const created = [];
  for (let index = 0; index < count; index += 1) {
    const takeId = id("take");
    const jobId = id("job");
    const timestamp = now();
    const changeRequest = upgradeSource
      ? `基于 TAKE ${String(upgradeSource.take_no).padStart(2, "0")} 重新生成 1080p 定稿`
      : String(payload.changeRequest || "");
    const basePrompt = upgradeSource
      ? `${upgradeSource.prompt}\n本次生成1080p定稿版本：保持主选镜头的角色外观、构图、动作节奏、光线和镜头运动，不新增元素。`
      : compilePrompt(shot, changeRequest);
    const referenceBinding = referenceBindingForAssets(referenceAssets);
    const actualPrompt = `${basePrompt}\n${referenceBinding}`;
    db.prepare(`INSERT INTO takes
      (id, shot_id, take_no, status, prompt, approved, rejected, change_request, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, 0, 0, ?, ?, ?)`)
      .run(takeId, shotId, Number(latest) + index + 1, actualPrompt, changeRequest, timestamp, timestamp);
    const request = {
      model: getSeedanceModel(),
      ratio: shot.aspect_ratio,
      duration: normalizeShotDuration(shot.duration_sec),
      resolution: upgradeSource ? "1080p" : String(payload.resolution || shot.resolution || process.env.SEEDANCE_RESOLUTION || "720p"),
      generateAudio: payload.generateAudio ?? shot.audio_strategy === "native",
      prompt: actualPrompt,
      referenceImages: referenceAssets.map((asset) => ({
        id: asset.id, type: asset.type, name: asset.name, aliases: asset.aliases, description: asset.description,
        version: asset.version, updatedAt: asset.updatedAt, url: asset.referenceUrl
      })),
      assetBindingSnapshot: assetReadiness.bindings,
      textOnlyOverride: !assetReadiness.ready && Boolean(payload.allowTextOnly),
      upgradeFromTakeId: upgradeSource?.id || ""
    };
    db.prepare(`INSERT INTO jobs
      (id, project_id, shot_id, take_id, status, request_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'local_queued', ?, ?, ?)`)
      .run(jobId, shot.project_id, shotId, takeId, JSON.stringify(request), timestamp, timestamp);
    created.push({ jobId, takeId });
    setImmediate(() => submitJob(jobId).catch((error) => failJob(jobId, error)));
  }
  return created;
}

async function submitJob(jobId) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!job || !["local_queued", "failed"].includes(job.status)) return;
  const apiKey = process.env.SEEDANCE_API_KEY || process.env.ARK_API_KEY;
  const request = safeJson(job.request_json, {});
  const timestamp = now();
  db.prepare("UPDATE jobs SET status = 'submitting', error = '', updated_at = ? WHERE id = ?").run(timestamp, jobId);
  db.prepare("UPDATE takes SET status = 'submitting', error = '', updated_at = ? WHERE id = ?").run(timestamp, job.take_id);
  const baseUrl = String(process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com").replace(/\/+$/, "");
  const submitPath = ensureLeadingSlash(process.env.SEEDANCE_SUBMIT_PATH || "/api/v3/contents/generations/tasks");
  const preparedReferences = [];
  for (const asset of Array.isArray(request.referenceImages) ? request.referenceImages : []) {
    const url = await imageUrlForSeedanceContent(asset.url);
    if (!url) throw new Error(`参考资产“${asset.name}”无法读取，视频未提交。`);
    preparedReferences.push({ ...asset, url });
  }
  const content = [
    { type: "text", text: request.prompt },
    ...preparedReferences.map((asset) => ({ type: "image_url", image_url: { url: asset.url }, role: "reference_image" }))
  ];
  const response = await fetch(`${baseUrl}${submitPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      content,
      ratio: request.ratio,
      duration: request.duration,
      resolution: request.resolution,
      generate_audio: Boolean(request.generateAudio),
      watermark: false
    }),
    signal: AbortSignal.timeout(Number(process.env.SEEDANCE_TIMEOUT_MS || 600000))
  });
  const rawText = await response.text();
  const raw = safeJson(rawText, { message: rawText });
  if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `Seedance 提交失败（${response.status}）`);
  const providerTaskId = extractTaskId(raw);
  if (!providerTaskId) throw new Error("Seedance 已响应，但没有返回任务 ID。");
  db.prepare("UPDATE jobs SET provider_task_id = ?, status = 'submitted', updated_at = ? WHERE id = ?")
    .run(providerTaskId, now(), jobId);
  db.prepare("UPDATE takes SET task_id = ?, status = 'submitted', updated_at = ? WHERE id = ?")
    .run(providerTaskId, now(), job.take_id);
}

async function queryJob(jobId) {
  const job = db.prepare(`SELECT jobs.* FROM jobs
    JOIN projects ON projects.id = jobs.project_id
    WHERE jobs.id = ? AND projects.deleted_at = ''`).get(jobId);
  if (!job) throw Object.assign(new Error("任务不存在"), { statusCode: 404 });
  if (!job.provider_task_id) return job;
  const apiKey = process.env.SEEDANCE_API_KEY || process.env.ARK_API_KEY;
  const baseUrl = String(process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com").replace(/\/+$/, "");
  const statusPath = ensureLeadingSlash(process.env.SEEDANCE_STATUS_PATH || "/api/v3/contents/generations/tasks");
  try {
    const response = await fetch(`${baseUrl}${statusPath}/${encodeURIComponent(job.provider_task_id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60000)
    });
    const rawText = await response.text();
    const raw = safeJson(rawText, { message: rawText });
    if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `查询失败（${response.status}）`);
    const normalized = normalizeTaskStatus(raw);
    if (normalized.status === "completed") {
      const localUrl = await downloadVideo(normalized.videoUrl, job.project_id, job.take_id);
      db.prepare("UPDATE jobs SET status = 'succeeded', error = '', updated_at = ? WHERE id = ?").run(now(), jobId);
      db.prepare(`UPDATE takes SET status = 'succeeded', video_url = ?, local_url = ?, error = '', updated_at = ? WHERE id = ?`)
        .run(normalized.videoUrl, localUrl, now(), job.take_id);
    } else if (normalized.status === "failed") {
      failJob(jobId, new Error(normalized.error || "Seedance 任务失败"));
    } else {
      db.prepare("UPDATE jobs SET status = 'processing', updated_at = ? WHERE id = ?").run(now(), jobId);
      db.prepare("UPDATE takes SET status = 'processing', updated_at = ? WHERE id = ?").run(now(), job.take_id);
    }
  } catch (error) {
    db.prepare("UPDATE jobs SET status = 'status_unknown', error = ?, updated_at = ? WHERE id = ?")
      .run(String(error.message || error), now(), jobId);
  }
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
}

function failJob(jobId, error) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!job) return;
  const message = String(error?.message || error || "任务失败");
  db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(message, now(), jobId);
  db.prepare("UPDATE takes SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(message, now(), job.take_id);
}

async function pollActiveJobs() {
  if (polling) return;
  polling = true;
  try {
    const jobs = db.prepare(`SELECT jobs.id FROM jobs
      JOIN projects ON projects.id = jobs.project_id
      WHERE jobs.status IN ('submitted', 'processing', 'status_unknown') AND projects.deleted_at = ''
      ORDER BY jobs.updated_at LIMIT 6`).all();
    for (const job of jobs) await queryJob(job.id);
  } finally {
    polling = false;
  }
}

function extractTaskId(raw) {
  return raw?.id || raw?.task_id || raw?.taskId || raw?.data?.id || raw?.data?.task_id || raw?.result?.id || "";
}

function normalizeTaskStatus(raw) {
  const status = String(raw?.status || raw?.data?.status || raw?.task_status || raw?.data?.task_status || "").toLowerCase();
  const videoUrl = extractVideoUrl(raw);
  const failed = /fail|error|cancel|reject/.test(status);
  const completed = /complete|success|succeed|done/.test(status) || Boolean(videoUrl);
  return { status: failed ? "failed" : completed ? "completed" : "processing", videoUrl, error: extractError(raw) };
}

function extractVideoUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return /^https?:\/\//.test(value) && /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value) ? value : "";
  if (Array.isArray(value)) {
    for (const item of value) { const result = extractVideoUrl(item); if (result) return result; }
    return "";
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && /^https?:\/\//.test(child) && (/video|url/i.test(key) || /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(child)) && !/\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(child)) return child;
      const result = extractVideoUrl(child); if (result) return result;
    }
  }
  return "";
}

function extractError(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return "";
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && /error|message|reason/i.test(key) && child.trim()) return child.trim();
  }
  for (const child of Object.values(value)) { const result = extractError(child, depth + 1); if (result) return result; }
  return "";
}

async function downloadVideo(remoteUrl, projectId, takeId) {
  if (!remoteUrl) throw new Error("任务已完成但没有视频地址。");
  const folder = path.join(outputsDir, safeName(projectId), "takes");
  await fsp.mkdir(folder, { recursive: true });
  const outputPath = path.join(folder, `${safeName(takeId)}.mp4`);
  const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`视频下载失败（${response.status}）`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(outputPath, buffer);
  return `/outputs/${encodeURIComponent(safeName(projectId))}/takes/${encodeURIComponent(safeName(takeId))}.mp4`;
}

function getRoughCut(projectId) {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND deleted_at = ''").get(projectId);
  if (!project) throw Object.assign(new Error("项目不存在或已删除"), { statusCode: 404 });
  const rows = db.prepare(`SELECT shots.id, shots.shot_no, shots.title, shots.duration_sec, shots.edit_duration_sec,
      shots.generation_meta_json, shots.preferred_take_id,
      sequences.name AS sequence_name
    FROM shots JOIN sequences ON sequences.id = shots.sequence_id
    WHERE sequences.project_id = ? ORDER BY sequences.sort_order, shots.sort_order`).all(projectId);
  const preferred = db.prepare("SELECT * FROM takes WHERE id = ? AND status = 'succeeded'");
  const fallback = db.prepare("SELECT * FROM takes WHERE shot_id = ? AND status = 'succeeded' AND rejected = 0 ORDER BY approved DESC, take_no DESC LIMIT 1");
  return rows.map((shot) => {
    const take = shot.preferred_take_id ? preferred.get(shot.preferred_take_id) : null;
    const resolved = take || fallback.get(shot.id) || null;
    return {
      shotId: shot.id,
      no: shot.shot_no,
      title: shot.title,
      duration: Number(shot.edit_duration_sec || shot.duration_sec),
      generationDuration: shot.duration_sec,
      postOnly: Boolean(safeJson(shot.generation_meta_json || "{}", {}).postOnly),
      sequence: shot.sequence_name,
      take: resolved ? mapTake(resolved) : null
    };
  });
}

function wrapCardLine(value, limit = 16) {
  const text = String(value || "").trim();
  if (!text) return [];
  const lines = [];
  for (let index = 0; index < text.length; index += limit) lines.push(text.slice(index, index + limit));
  return lines;
}

async function renderPostProductionShot(shotId) {
  const shot = db.prepare(`SELECT shots.*, projects.id AS project_id, projects.aspect_ratio
    FROM shots JOIN sequences ON sequences.id = shots.sequence_id
    JOIN projects ON projects.id = sequences.project_id
    WHERE shots.id = ? AND projects.deleted_at = ''`).get(shotId);
  if (!shot) throw Object.assign(new Error("镜头不存在"), { statusCode: 404 });
  if (!safeJson(shot.generation_meta_json || "{}", {}).postOnly) {
    throw Object.assign(new Error("只有后期镜头可以在本地生成字幕卡。"), { statusCode: 409 });
  }
  if (spawnSync(ffmpegPath, ["-version"], { stdio: "ignore" }).status !== 0) {
    throw Object.assign(new Error("本机未检测到 FFmpeg，暂时不能生成后期字幕卡。"), { statusCode: 503 });
  }

  const ratio = String(shot.aspect_ratio || "9:16");
  const size = ratio === "16:9" ? "1280x720" : ratio === "1:1" ? "1080x1080" : "720x1280";
  const duration = clamp(shot.edit_duration_sec || 3, 1, 60);
  const quoted = [...String(shot.prompt || "").matchAll(/[“\"]([^”\"]{2,120})[”\"]/g)].map((match) => match[1]);
  const cardLines = (quoted.length ? quoted.slice(0, 3) : [shot.title, String(shot.prompt || "").slice(0, 140)])
    .map((line) => String(line || "").trim()).filter(Boolean);
  const folder = path.join(outputsDir, safeName(shot.project_id), "takes");
  await fsp.mkdir(folder, { recursive: true });
  const takeId = id("take");
  const outputName = `${safeName(takeId)}-post.mp4`;
  const outputPath = path.join(folder, outputName);
  const textPath = path.join(folder, `${safeName(takeId)}-post.txt`);
  await fsp.writeFile(textPath, cardLines.join("\n"), "utf8");
  const fadeOut = Math.max(0, duration - 0.35);
  const [targetWidth, targetHeight] = size.split("x");
  const filters = spawnSync(ffmpegPath, ["-hide_banner", "-filters"], { encoding: "utf8" });
  const supportsDrawtext = /\sdrawtext\s/.test(String(filters.stdout || ""));
  let videoInput = ["-f", "lavfi", "-i", `color=c=0x090b0e:s=${size}:r=30:d=${duration}`];
  let visualFilter = `scale=${targetWidth}:${targetHeight},fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut}:d=0.35`;
  if (supportsDrawtext) {
    const fontCandidates = ["/System/Library/Fonts/PingFang.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"];
    const font = fontCandidates.find((item) => fs.existsSync(item));
    const fontOption = font ? `fontfile='${font}'` : "font='Sans'";
    visualFilter = `drawtext=${fontOption}:textfile='${textPath}':fontcolor=white:fontsize=${ratio === "16:9" ? 40 : 42}:line_spacing=20:x=(w-text_w)/2:y=(h-text_h)/2:borderw=1:bordercolor=black@0.65,${visualFilter}`;
  } else if (process.platform === "darwin" && fs.existsSync("/usr/bin/swift")) {
    const cardPath = path.join(folder, `${safeName(takeId)}-post.png`);
    await runProcess("/usr/bin/swift", [path.join(rootDir, "scripts", "render-title-card.swift"), cardPath, targetWidth, targetHeight, textPath], 2 * 60 * 1000);
    videoInput = ["-loop", "1", "-framerate", "30", "-i", cardPath];
  } else {
    throw Object.assign(new Error("当前 FFmpeg 不支持 drawtext，且没有可用的系统文字渲染器。"), { statusCode: 503 });
  }
  await runProcess(ffmpegPath, [
    "-y", ...videoInput,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-vf", visualFilter, "-t", String(duration), "-shortest", "-c:v", "libx264", "-preset", "veryfast",
    "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outputPath
  ], 5 * 60 * 1000);

  const timestamp = now();
  const takeNo = Number(db.prepare("SELECT COALESCE(MAX(take_no), 0) AS value FROM takes WHERE shot_id = ?").get(shotId).value) + 1;
  const localUrl = `/outputs/${encodeURIComponent(safeName(shot.project_id))}/takes/${encodeURIComponent(outputName)}`;
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO takes
      (id, shot_id, take_no, status, local_url, prompt, approved, rejected, change_request, created_at, updated_at)
      VALUES (?, ?, ?, 'succeeded', ?, ?, 1, 0, '本地后期字幕卡', ?, ?)`).run(
        takeId, shotId, takeNo, localUrl, shot.prompt || shot.title, timestamp, timestamp
      );
    db.prepare("UPDATE shots SET preferred_take_id = ?, updated_at = ? WHERE id = ?").run(takeId, timestamp, shotId);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, shot.project_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ok: true, takeId, videoUrl: localUrl, duration };
}

async function assembleProject(projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at = ''").get(projectId);
  if (!project) throw Object.assign(new Error("项目不存在"), { statusCode: 404 });
  const items = getRoughCut(projectId);
  const pendingPost = items.filter((item) => item.postOnly && !item.take?.localUrl);
  if (pendingPost.length) throw Object.assign(new Error(`还有 ${pendingPost.length} 个后期镜头尚未制作（如字幕卡），请完成后再合片。`), { statusCode: 409 });
  const missing = items.filter((item) => !item.postOnly && !item.take?.localUrl);
  if (missing.length) throw Object.assign(new Error(`还有 ${missing.length} 个镜头没有本地视频，暂时不能合片。`), { statusCode: 409 });
  if (items.length < 2) throw Object.assign(new Error("至少需要 2 个镜头才能合片。"), { statusCode: 409 });
  const folder = path.join(outputsDir, safeName(projectId), "cuts");
  await fsp.mkdir(folder, { recursive: true });
  const outputName = `cut-${Date.now()}.mp4`;
  const outputPath = path.join(folder, outputName);
  const args = ["-y"];
  const inputs = items.map((item) => outputUrlToPath(item.take.localUrl));
  inputs.forEach((file) => args.push("-fflags", "+genpts", "-i", file));
  const filters = [];
  const concatInputs = [];
  inputs.forEach((_, index) => {
    filters.push(`[${index}:v:0]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${index}]`);
    filters.push(`[${index}:a:0?]aresample=async=1:first_pts=0[a${index}]`);
    concatInputs.push(`[v${index}][a${index}]`);
  });
  args.push("-filter_complex", `${filters.join(";")};${concatInputs.join("")}concat=n=${inputs.length}:v=1:a=1[v][a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", outputPath);
  try {
    await runProcess(ffmpegPath, args, 30 * 60 * 1000);
  } catch {
    const fallbackArgs = ["-y"];
    inputs.forEach((file) => fallbackArgs.push("-fflags", "+genpts", "-i", file));
    const videoFilters = inputs.map((_, index) => `[${index}:v:0]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${index}]`);
    const videoInputs = inputs.map((_, index) => `[v${index}]`).join("");
    fallbackArgs.push("-filter_complex", `${videoFilters.join(";")};${videoInputs}concat=n=${inputs.length}:v=1:a=0[v]`, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", outputPath);
    await runProcess(ffmpegPath, fallbackArgs, 30 * 60 * 1000);
  }
  return { ok: true, videoUrl: `/outputs/${encodeURIComponent(safeName(projectId))}/cuts/${encodeURIComponent(outputName)}`, clipCount: items.length };
}

function outputUrlToPath(url) {
  const relative = decodeURIComponent(String(url || "").replace(/^\/outputs\//, "").split(/[?#]/)[0]);
  const resolved = path.resolve(outputsDir, relative);
  if (!resolved.startsWith(path.resolve(outputsDir) + path.sep)) throw new Error("非法输出路径");
  return resolved;
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("命令执行超时")); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(stderr.slice(-2000) || `命令退出：${code}`));
    });
  });
}

function ensureLeadingSlash(value) {
  return String(value || "").startsWith("/") ? String(value) : `/${value}`;
}

function safeName(value) {
  return String(value || "item").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function normalizeSourceFilePath(value) {
  let input = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (input.startsWith("file://")) {
    try { input = decodeURIComponent(new URL(input).pathname); }
    catch { throw Object.assign(new Error("文件路径格式不正确"), { statusCode: 400 }); }
  }
  if (input === "~") input = os.homedir();
  if (input.startsWith("~/")) input = path.join(os.homedir(), input.slice(2));
  if (!path.isAbsolute(input)) throw Object.assign(new Error("请使用本机绝对路径，例如 /Users/me/storyboard.md"), { statusCode: 400 });
  return path.normalize(input);
}

const allowedSourceExtensions = new Set([".md", ".markdown", ".mdown", ".txt"]);

async function readSourceTextFile(resolved, rootPath = path.dirname(resolved)) {
  const extension = path.extname(resolved).toLowerCase();
  if (!allowedSourceExtensions.has(extension)) {
    throw Object.assign(new Error("只支持 .md、.markdown、.mdown 和 .txt 文件"), { statusCode: 415 });
  }
  const stat = await fsp.stat(resolved);
  if (!stat.isFile()) throw Object.assign(new Error("路径不是文件"), { statusCode: 400 });
  if (stat.size > 6 * 1024 * 1024) throw Object.assign(new Error("文件超过 6MB，请拆分后再导入"), { statusCode: 413 });
  const text = (await fsp.readFile(resolved, "utf8")).replace(/^\uFEFF/, "");
  if (!text.trim()) throw Object.assign(new Error("文件内容为空"), { statusCode: 422 });
  if (text.includes("\0")) throw Object.assign(new Error("文件不是可识别的文本格式"), { statusCode: 415 });
  return { name: path.basename(resolved), path: resolved, relativePath: path.relative(rootPath, resolved) || path.basename(resolved), size: stat.size, text };
}

async function collectSourceFiles(directory, depth = 0, results = []) {
  if (depth > 3 || results.length >= 80) return results;
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
    if (results.length >= 80) break;
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(entryPath, depth + 1, results);
    else if (entry.isFile() && allowedSourceExtensions.has(path.extname(entry.name).toLowerCase())) results.push(entryPath);
  }
  return results;
}

async function readSourcePath(sourcePath) {
  const normalized = normalizeSourceFilePath(sourcePath);
  let resolved;
  try { resolved = await fsp.realpath(normalized); }
  catch { throw Object.assign(new Error("找不到这个文件或文件夹，请检查路径是否完整"), { statusCode: 404 }); }
  const stat = await fsp.stat(resolved);
  const paths = stat.isDirectory() ? await collectSourceFiles(resolved) : [resolved];
  if (!paths.length) throw Object.assign(new Error("这个文件夹里没有可识别的 Markdown/TXT 文件"), { statusCode: 422 });
  const files = [];
  let totalSize = 0;
  for (const filePath of paths) {
    const file = await readSourceTextFile(filePath, stat.isDirectory() ? resolved : path.dirname(resolved));
    totalSize += file.size;
    if (totalSize > 6 * 1024 * 1024) throw Object.assign(new Error("导入文件总计超过 6MB，请减少文件后再试"), { statusCode: 413 });
    files.push(file);
  }
  const text = files.map((file) => `<!-- 来源：${file.relativePath} -->\n${file.text}`).join("\n\n---\n\n");
  return {
    name: stat.isDirectory() ? path.basename(resolved) : files[0].name,
    path: resolved,
    size: totalSize,
    text,
    files
  };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("请求 JSON 无法解析"), { statusCode: 400 }); }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, service: "novelcut-studio" });
  if (req.method === "GET" && url.pathname === "/api/capabilities") return sendJson(res, 200, getCapabilities());
  if (req.method === "GET" && url.pathname === "/api/knowledge") return sendJson(res, 200, promptKnowledgeSummary);

  if (req.method === "POST" && url.pathname === "/api/source-files/read") {
    const payload = await readJson(req);
    return sendJson(res, 200, await readSourcePath(payload.path));
  }

  if (req.method === "POST" && url.pathname === "/api/source/preview") {
    const payload = await readJson(req);
    return sendJson(res, 200, previewSource(payload.sourceText || ""));
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const rows = db.prepare(`SELECT projects.*,
      (SELECT COUNT(*) FROM sequences JOIN shots ON shots.sequence_id = sequences.id WHERE sequences.project_id = projects.id) AS shot_count
      FROM projects WHERE projects.deleted_at = '' ORDER BY updated_at DESC`).all();
    return sendJson(res, 200, rows.map((row) => ({ id: row.id, name: row.name, shotCount: row.shot_count, aspectRatio: row.aspect_ratio, resolution: row.resolution, updatedAt: row.updated_at })));
  }
  if (req.method === "POST" && url.pathname === "/api/projects") {
    const payload = await readJson(req);
    return sendJson(res, 201, createProject(payload));
  }

  let appendMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/import-shots$/);
  if (req.method === "POST" && appendMatch) {
    const payload = await readJson(req);
    return sendJson(res, 201, appendProjectShots(decodeURIComponent(appendMatch[1]), payload));
  }

  const restoreMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/restore$/);
  if (req.method === "POST" && restoreMatch) {
    const projectId = decodeURIComponent(restoreMatch[1]);
    const project = db.prepare("SELECT id, name FROM projects WHERE id = ? AND deleted_at != ''").get(projectId);
    if (!project) return sendJson(res, 404, { error: "回收站中没有这个项目" });
    db.prepare("UPDATE projects SET deleted_at = '', updated_at = ? WHERE id = ?").run(now(), projectId);
    return sendJson(res, 200, { ok: true, id: project.id, name: project.name });
  }

  const reparseMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/reparse-assets$/);
  if (req.method === "POST" && reparseMatch) {
    return sendJson(res, 200, reparseProjectAssets(decodeURIComponent(reparseMatch[1])));
  }

  const promptAuditMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/prompt-audit$/);
  if (req.method === "GET" && promptAuditMatch) {
    return sendJson(res, 200, auditProjectPrompts(decodeURIComponent(promptAuditMatch[1])));
  }

  let match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === "DELETE" && match) {
    const projectId = decodeURIComponent(match[1]);
    const payload = await readJson(req);
    const project = db.prepare("SELECT id, name, updated_at FROM projects WHERE id = ? AND deleted_at = ''").get(projectId);
    if (!project) return sendJson(res, 404, { error: "项目不存在或已删除" });
    if (!payload.expectedUpdatedAt || payload.expectedUpdatedAt !== project.updated_at) {
      return sendJson(res, 409, { error: "项目已在其他页面更新，请刷新项目列表后再删除" });
    }
    const activeJobs = Number(db.prepare("SELECT COUNT(*) AS value FROM jobs WHERE project_id = ? AND status NOT IN ('succeeded', 'failed')").get(projectId).value);
    if (activeJobs) return sendJson(res, 409, { error: `项目还有 ${activeJobs} 个生成任务进行中，请完成后再删除` });
    db.prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), projectId);
    return sendJson(res, 200, { ok: true, id: project.id, name: project.name, recoverable: true });
  }
  if (req.method === "GET" && match) {
    const project = getProject(decodeURIComponent(match[1]));
    return project ? sendJson(res, 200, project) : sendJson(res, 404, { error: "项目不存在" });
  }

  match = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (req.method === "PATCH" && match) {
    const record = findAssetRecord(decodeURIComponent(match[1]));
    if (!record) return sendJson(res, 404, { error: "资产不存在" });
    const payload = await readJson(req);
    const asset = saveAssetRecord(record, {
      name: payload.name ?? record.asset.name,
      aliases: payload.aliases == null ? record.asset.aliases : (Array.isArray(payload.aliases) ? payload.aliases : String(payload.aliases).split(/[、,，/]+/)),
      description: payload.description ?? record.asset.description,
      prompt: payload.prompt ?? record.asset.prompt,
      status: payload.status ?? record.asset.status
    });
    return sendJson(res, 200, asset);
  }

  match = url.pathname.match(/^\/api\/assets\/([^/]+)\/(reference|generate|approve)$/);
  if (req.method === "POST" && match) {
    const record = findAssetRecord(decodeURIComponent(match[1]));
    if (!record) return sendJson(res, 404, { error: "资产不存在" });
    if (match[2] === "generate") return sendJson(res, 200, await generateAssetImage(record));
    if (match[2] === "approve") {
      if (!record.asset.referenceUrl) return sendJson(res, 409, { error: "请先生成或上传参考图" });
      return sendJson(res, 200, saveAssetRecord(record, { status: "approved" }));
    }
    const payload = await readJson(req);
    const referenceUrl = await saveAssetDataUrl(record.projectId, record.asset.id, payload.dataUrl);
    return sendJson(res, 200, saveAssetRecord(record, { referenceUrl, status: "draft", version: record.asset.version + 1 }));
  }

  match = url.pathname.match(/^\/api\/shots\/([^/]+)\/assets\/(auto)$/);
  if (req.method === "POST" && match) {
    const shotId = decodeURIComponent(match[1]);
    const shot = db.prepare(`SELECT shots.*, projects.assets_json FROM shots
      JOIN sequences ON sequences.id = shots.sequence_id JOIN projects ON projects.id = sequences.project_id
      WHERE shots.id = ? AND projects.deleted_at = ''`).get(shotId);
    if (!shot) return sendJson(res, 404, { error: "镜头不存在" });
    const bindings = saveShotBindings(shotId, buildAutoShotBindings(safeJson(shot.assets_json, []), shot));
    return sendJson(res, 200, { bindings, readiness: assetReadinessForShot(safeJson(shot.assets_json, []), { ...shot, asset_bindings_json: JSON.stringify(bindings) }) });
  }

  match = url.pathname.match(/^\/api\/shots\/([^/]+)\/assets$/);
  if (req.method === "PATCH" && match) {
    const shotId = decodeURIComponent(match[1]);
    const shot = db.prepare(`SELECT shots.*, projects.assets_json FROM shots
      JOIN sequences ON sequences.id = shots.sequence_id JOIN projects ON projects.id = sequences.project_id
      WHERE shots.id = ? AND projects.deleted_at = ''`).get(shotId);
    if (!shot) return sendJson(res, 404, { error: "镜头不存在" });
    const payload = await readJson(req);
    const assets = normalizeAssets(safeJson(shot.assets_json, []));
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const characterIds = [...new Set(Array.isArray(payload.characterIds) ? payload.characterIds.map(String) : [])]
      .filter((assetId) => byId.get(assetId)?.type === "character");
    const sceneId = byId.get(String(payload.sceneId || ""))?.type === "scene" ? String(payload.sceneId) : "";
    const propIds = [...new Set(Array.isArray(payload.propIds) ? payload.propIds.map(String) : [])]
      .filter((assetId) => byId.get(assetId)?.type === "prop");
    const bindings = saveShotBindings(shotId, { mode: "manual", characterIds, sceneId, propIds, unresolved: [], ignored: [], ambiguous: [] });
    return sendJson(res, 200, { bindings, readiness: assetReadinessForShot(assets, { ...shot, asset_bindings_json: JSON.stringify(bindings) }) });
  }

  match = url.pathname.match(/^\/api\/shots\/([^/]+)$/);
  if (req.method === "PATCH" && match) {
    const shotId = decodeURIComponent(match[1]);
    const payload = await readJson(req);
    const shot = db.prepare(`SELECT shots.*, projects.id AS project_id FROM shots
      JOIN sequences ON sequences.id = shots.sequence_id
      JOIN projects ON projects.id = sequences.project_id
      WHERE shots.id = ? AND projects.deleted_at = ''`).get(shotId);
    if (!shot) return sendJson(res, 404, { error: "镜头不存在" });
    db.prepare(`UPDATE shots SET title = ?, prompt = ?, duration_sec = ?, edit_duration_sec = ?, characters = ?, scene = ?, updated_at = ? WHERE id = ?`)
      .run(
        payload.title ?? shot.title,
        payload.prompt ?? shot.prompt,
        normalizeShotDuration(payload.duration ?? shot.duration_sec),
        Number(payload.editDuration ?? shot.edit_duration_sec ?? shot.duration_sec),
        payload.characters ?? shot.characters,
        payload.scene ?? shot.scene,
        now(), shotId
      );
    const updatedShot = db.prepare("SELECT * FROM shots WHERE id = ?").get(shotId);
    const currentBindings = normalizeShotBindings(safeJson(updatedShot.asset_bindings_json || "{}", {}));
    if (currentBindings.mode !== "manual") {
      const project = db.prepare("SELECT assets_json FROM projects WHERE id = ?").get(shot.project_id);
      saveShotBindings(shotId, buildAutoShotBindings(safeJson(project.assets_json, []), updatedShot));
    }
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), shot.project_id);
    return sendJson(res, 200, { ok: true });
  }

  match = url.pathname.match(/^\/api\/shots\/([^/]+)\/prompt-preview$/);
  if (req.method === "GET" && match) {
    const shotId = decodeURIComponent(match[1]);
    const shot = db.prepare(`SELECT shots.*, projects.visual_style, projects.aspect_ratio,
      projects.resolution, projects.audio_strategy, projects.assets_json, projects.production_json FROM shots
      JOIN sequences ON sequences.id = shots.sequence_id
      JOIN projects ON projects.id = sequences.project_id
      WHERE shots.id = ? AND projects.deleted_at = ''`).get(shotId);
    if (!shot) return sendJson(res, 404, { error: "镜头不存在" });
    const changeRequest = String(url.searchParams.get("changeRequest") || "");
    const assetReadiness = assetReadinessForShot(safeJson(shot.assets_json, []), shot);
    const referenceAssets = assetReadiness.matched.filter((asset) => asset.status === "approved" && asset.referenceUrl);
    return sendJson(res, 200, {
      prompt: `${compilePrompt(shot, changeRequest)}\n${referenceBindingForAssets(referenceAssets)}`,
      review: analyzeShot({ ...shot, prompt: [shot.prompt, changeRequest].filter(Boolean).join("\n"), duration: shot.duration_sec }, promptKnowledge),
      knowledgeVersion: promptKnowledge.meta.version,
      assetReadiness,
      referenceAssets,
      submissionPlan: {
        assetBindingSnapshot: assetReadiness.bindings,
        referenceImages: referenceAssets.map((asset, index) => ({
          position: index + 1,
          assetId: asset.id,
          type: asset.type,
          name: asset.name,
          version: asset.version,
          url: asset.referenceUrl
        }))
      },
      postOnly: Boolean(safeJson(shot.generation_meta_json || "{}", {}).postOnly),
      blocked: !assetReadiness.ready || Boolean(safeJson(shot.generation_meta_json || "{}", {}).postOnly)
    });
  }

  match = url.pathname.match(/^\/api\/shots\/([^/]+)\/generate$/);
  if (req.method === "POST" && match) {
    const payload = await readJson(req);
    const created = await submitShotGeneration(decodeURIComponent(match[1]), payload);
    return sendJson(res, 202, { ok: true, created });
  }

  match = url.pathname.match(/^\/api\/shots\/([^/]+)\/render-post$/);
  if (req.method === "POST" && match) {
    return sendJson(res, 201, await renderPostProductionShot(decodeURIComponent(match[1])));
  }

  match = url.pathname.match(/^\/api\/takes\/([^/]+)\/(approve|prefer|reject)$/);
  if (req.method === "POST" && match) {
    const takeId = decodeURIComponent(match[1]);
    const action = match[2];
    const take = db.prepare(`SELECT takes.* FROM takes
      JOIN shots ON shots.id = takes.shot_id
      JOIN sequences ON sequences.id = shots.sequence_id
      JOIN projects ON projects.id = sequences.project_id
      WHERE takes.id = ? AND projects.deleted_at = ''`).get(takeId);
    if (!take) return sendJson(res, 404, { error: "候选不存在" });
    if (action === "approve") db.prepare("UPDATE takes SET approved = 1, rejected = 0, updated_at = ? WHERE id = ?").run(now(), takeId);
    if (action === "reject") db.prepare("UPDATE takes SET rejected = 1, approved = 0, updated_at = ? WHERE id = ?").run(now(), takeId);
    if (action === "prefer") {
      if (take.status !== "succeeded") return sendJson(res, 409, { error: "只有生成成功的候选才能设为主选" });
      db.prepare("UPDATE takes SET approved = 1, rejected = 0, updated_at = ? WHERE id = ?").run(now(), takeId);
      db.prepare("UPDATE shots SET preferred_take_id = ?, updated_at = ? WHERE id = ?").run(takeId, now(), take.shot_id);
    }
    return sendJson(res, 200, { ok: true });
  }

  match = url.pathname.match(/^\/api\/projects\/([^/]+)\/rough-cut$/);
  if (req.method === "GET" && match) return sendJson(res, 200, { items: getRoughCut(decodeURIComponent(match[1])) });

  match = url.pathname.match(/^\/api\/projects\/([^/]+)\/assemble$/);
  if (req.method === "POST" && match) return sendJson(res, 200, await assembleProject(decodeURIComponent(match[1])));

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    const projectId = url.searchParams.get("projectId");
    const jobs = projectId
      ? db.prepare(`SELECT jobs.* FROM jobs JOIN projects ON projects.id = jobs.project_id
          WHERE jobs.project_id = ? AND projects.deleted_at = '' ORDER BY jobs.created_at DESC LIMIT 80`).all(projectId)
      : db.prepare(`SELECT jobs.* FROM jobs JOIN projects ON projects.id = jobs.project_id
          WHERE projects.deleted_at = '' ORDER BY jobs.created_at DESC LIMIT 80`).all();
    return sendJson(res, 200, jobs.map((job) => ({ id: job.id, shotId: job.shot_id, takeId: job.take_id, providerTaskId: job.provider_task_id, status: job.status, error: job.error, createdAt: job.created_at, updatedAt: job.updated_at })));
  }

  match = url.pathname.match(/^\/api\/jobs\/([^/]+)\/query$/);
  if (req.method === "POST" && match) return sendJson(res, 200, await queryJob(decodeURIComponent(match[1])));

  return sendJson(res, 404, { error: "接口不存在" });
}

async function serveFile(res, filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("not-file");
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
      ".mp4": "video/mp4", ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (url.pathname.startsWith("/outputs/")) {
      const relative = decodeURIComponent(url.pathname.replace(/^\/outputs\//, ""));
      const filePath = path.resolve(outputsDir, relative);
      if (!filePath.startsWith(path.resolve(outputsDir) + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
      return await serveFile(res, filePath);
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
    const filePath = path.resolve(publicDir, requested);
    if (!filePath.startsWith(path.resolve(publicDir) + path.sep) && filePath !== path.join(publicDir, "index.html")) { res.writeHead(403); return res.end("Forbidden"); }
    return await serveFile(res, filePath);
  } catch (error) {
    console.error(error);
    return sendJson(res, Number(error.statusCode || 500), { error: error.message || "服务器错误" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NovelCut Studio running at http://${HOST}:${PORT}`);
  console.log(`Seedance: ${(process.env.SEEDANCE_API_KEY || process.env.ARK_API_KEY) ? "configured" : "not configured"}`);
});

setInterval(() => { pollActiveJobs().catch((error) => console.error("poll jobs", error)); }, 8000).unref();
