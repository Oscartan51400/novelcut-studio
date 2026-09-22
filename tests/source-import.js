#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
  const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(indexHtml, /id="sourceFileButton"[\s\S]*上传完稿 \/ 分镜/);
  assert.match(indexHtml, /id="sourceFileInput"[^>]*accept="\.docx,\.md,\.markdown,\.mdown,\.txt"/);
  assert.match(indexHtml, /id="sourceFolderButton"[\s\S]*导入整个文件夹/);
  assert.match(indexHtml, /文件置灰是正常的/);
  assert.match(appJs, /data-action="generate-all-assets"/, "资产页应提供一键生成全部缺失资产按钮");
  assert.match(appJs, /data-action="toggle-asset-group"/, "资产页应支持分类折叠");
  assert.match(appJs, /data-action="expand-asset-groups"/, "资产页应支持全部展开");
  assert.match(appJs, /data-action="collapse-asset-groups"/, "资产页应支持全部收起");
  assert.match(appJs, /promptDialogContent\.addEventListener\("click"/, "提示词预览弹窗必须有独立关闭事件，不能依赖主页面事件冒泡");
  assert.match(appJs, /const assets = shot\.assetReadiness\?\.matched \|\| \[\]/, "工作台应按人物、场景、道具的模型提交顺序展示资产");
  assert.match(appJs, /return "继续准备资产"/, "没有就绪镜头时，主动作不应误导用户立即生成试片");

  const emptyPreview = await request("/api/source/preview", {
    method: "POST",
    body: JSON.stringify({ sourceText: "   \n\t" })
  });
  assert.equal(emptyPreview.status, 422, "空白分镜不应生成占位镜头");
  assert.match(emptyPreview.body.error, /分镜内容不能为空/);

  const emptyProject = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "不应创建的空项目", sourceText: "" })
  });
  assert.equal(emptyProject.status, 422, "接口层也必须拒绝空分镜项目");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novelcut-source-import-"));
  const sourcePath = path.join(tempDir, "分镜读取测试.md");
  try {
    fs.writeFileSync(sourcePath, `# 文件读取测试

## 角色表
| 角色名 | 年龄 | 外貌 | 服装 |
|---|---|---|---|
| 林夏 | 25岁 | 黑色短发、眼下小痣 | 黄色雨衣 |
| 顾沉 | 28岁 | 方脸、圆框眼镜 | 墨绿色开衫 |

## 场景表
| 场景名 | 空间描述 | 光线 | 关键道具 |
|---|---|---|---|
| 雨夜便利店 | 左侧玻璃门、右侧收银台 | 室内暖白、窗外冷青 | 一盏红色台灯、一个牛皮纸信封 |

## 分镜表
| 镜头标题 | # | 场景 | 时长 | 出场角色 | 核心动作 |
|---|---:|---|---:|---|---|
| 递出信封 | 01 | 雨夜便利店 | 5秒 | 林夏、顾沉 | 林夏在柜台前递出唯一的牛皮纸信封。 |
`, "utf8");

    const read = await request("/api/source-files/read", {
      method: "POST",
      body: JSON.stringify({ path: sourcePath })
    });
    assert.equal(read.status, 200, "Markdown 文件应能通过本机路径读取");
    assert.equal(read.body.files.length, 1);
    assert.equal(read.body.files[0].name, "分镜读取测试.md");
    assert.match(read.body.text, /递出信封/);

    const preview = await request("/api/source/preview", {
      method: "POST",
      body: JSON.stringify({ sourceText: read.body.text })
    });
    assert.equal(preview.status, 200, "读取后的 Markdown 应可继续解析");
    assert.equal(preview.body.shotCount, 1);
    assert.equal(preview.body.characterCount, 2, "预览人物数量只统计身份基准");
    assert.equal(preview.body.sceneCount, 1, "预览场景数量只统计空间基准");
    assert.equal(preview.body.characterViewCount, 2, "逐镜人物视觉应单独统计");
    assert.equal(preview.body.sceneViewCount, 1, "逐镜场景视觉应单独统计");
    assert.equal(preview.body.propCount, 2, "场景表的关键道具应建立独立资产");
    assert.match(preview.body.assets.find((asset) => asset.name === "林夏").description, /黑色短发/);
    assert.match(preview.body.assets.find((asset) => asset.name === "雨夜便利店").description, /室内暖白/);
    assert.deepEqual(new Set(preview.body.assets.filter((asset) => asset.type === "prop").map((asset) => asset.name)), new Set(["红色台灯", "牛皮纸信封"]));
    assert.equal(preview.body.assets.filter((asset) => asset.role === "view").length, 3, "每镜应为两个人物和一个场景建立独立视觉资产");

    const wardrobePreview = await request("/api/source/preview", {
      method: "POST",
      body: JSON.stringify({
        sourceText: `## 人物固定卡
### 悟空／孙悟空
- 成年雄性猕猴面部，金棕短毛
- 战斗本体：暗金鳞片甲、朱红披风、黑金战靴
- 面馆日常：战甲外套橙黑旧外卖马甲

## 场景表
| 场景名 | 空间描述 |
|---|---|
| 云端 | 金色云海 |

## 分镜表
|镜头标题|#|场景|时长|出场角色|人物状态|核心动作|
|---|---:|---|---:|---|---|---|
|立于云端|01|云端|5秒|悟空、悟空分身|悟空本体金甲红披风|悟空看向远方。|
|回到面馆|02|云端|5秒|悟空|悟空外套橙黑旧外卖马甲|悟空提起餐袋。|`
      })
    });
    assert.equal(wardrobePreview.status, 200);
    const wardrobeViews = wardrobePreview.body.assets.filter((asset) => asset.type === "character" && asset.role === "view");
    assert.equal(wardrobeViews.length, 2, "同镜的本体与分身共用同一身份时不应重复建立付费资产");
    assert.match(wardrobeViews.find((asset) => asset.name.includes("镜头01")).description, /暗金|金甲红披风/);
    assert.match(wardrobeViews.find((asset) => asset.name.includes("镜头02")).description, /#E85D04/);
    assert.match(wardrobeViews.find((asset) => asset.name.includes("镜头02")).description, /禁止黄色/);

    console.log(JSON.stringify({
      ok: true,
      checks: 31,
      covered: ["单文件入口", "扩展名过滤", "文件夹入口提示", "本机路径读取", "空白分镜拒绝", "角色表", "场景表", "关键道具", "逐镜人物视觉", "逐镜场景机位", "服装状态继承", "本体分身去重", "橙黑配色防黄漂移", "资产分类折叠", "参考图顺序", "资产未就绪引导", "提示词弹窗关闭", "Markdown 解析预览"]
    }, null, 2));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
