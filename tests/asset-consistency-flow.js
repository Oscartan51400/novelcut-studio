#!/usr/bin/env node
const assert = require("node:assert/strict");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const baseUrl = process.env.NOVELCUT_TEST_URL || "http://127.0.0.1:5188";
const db = new DatabaseSync(path.join(__dirname, "..", "data", "novelcut.db"));
db.exec("PRAGMA foreign_keys=ON");

async function request(urlPath, options = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main() {
  let projectId = "";
  try {
    const created = await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `资产一致性临时测试-${Date.now()}`,
        sourceText: `## 2. 人物固定卡\n### 林澈／侦探\n- 28岁，黑色短发，深灰风衣\n- 左眉尾有浅疤\n\n### 周默／灯塔管理员\n- 32岁，旧蓝色工装，寡言\n\n## 3. 固定场景卡\n- 雨夜小巷：青石路，蓝绿霓虹主光\n\n## 固定道具\n- 黑色雨伞：木质弯柄，伞面有一道浅色补丁\n\n## 4. 分镜表\n|镜头标题|#|主角色|场景|时长|出场角色|画面|\n|---|---:|---|---|---:|---|---|\n|回头|01|地铁列车|雨夜小巷|5秒|林澈|中景平视，林澈在雨中停下并回头。|\n|巷口|02|林澈|小巷入口|5秒|林澈|林澈撑着黑色雨伞走到同一条小巷入口，霓虹方向保持不变。|`,
        aspectRatio: "9:16",
        resolution: "720p"
      })
    });
    assert.equal(created.status, 201, "项目应创建成功");
    projectId = created.body.id;
    const promptAudit = await request(`/api/projects/${projectId}/prompt-audit`);
    assert.equal(promptAudit.status, 200, "项目应提供逐镜提示词知识库审计");
    assert.equal(promptAudit.body.shotCount, 2);
    assert.match(promptAudit.body.knowledgeVersion, /^2026\.09\./);
    const shot = created.body.sequences[0].shots[0];
    assert.equal(created.body.assets.length, 8, "应建立基础资产及每镜人物/场景视觉资产，且不以数量上限合并");
    assert.equal(created.body.assets.some((asset) => asset.name === "地铁列车"), false, "不应把表格的主体错当为出场人物");
    assert.match(created.body.assets.find((asset) => asset.name === "林澈").description, /左眉尾/, "应保留人物固定卡设定");
    assert.equal(shot.assetReadiness.ready, false, "未准备参考图时不应就绪");
    assert.deepEqual(new Set(shot.assetReadiness.missing), new Set(["林澈 · 镜头01造型", "雨夜小巷 · 镜头01视角"]));
    const linAsset = created.body.assets.find((asset) => asset.name === "林澈");
    const zhouAsset = created.body.assets.find((asset) => asset.name === "周默");
    const sceneAsset = created.body.assets.find((asset) => asset.name === "雨夜小巷");
    const propAsset = created.body.assets.find((asset) => asset.name === "黑色雨伞");
    const secondShot = created.body.sequences.flatMap((sequence) => sequence.shots)[1];
    const firstCharacterView = created.body.assets.find((asset) => asset.role === "view" && asset.type === "character" && asset.shotNos.includes(1));
    const firstSceneView = created.body.assets.find((asset) => asset.role === "view" && asset.type === "scene" && asset.shotNos.includes(1));
    const secondCharacterView = created.body.assets.find((asset) => asset.role === "view" && asset.type === "character" && asset.shotNos.includes(2));
    const secondSceneView = created.body.assets.find((asset) => asset.role === "view" && asset.type === "scene" && asset.shotNos.includes(2));
    assert.ok(sceneAsset.aliases.includes("小巷入口"), "场景变体应作为基准场景的别名");
    assert.equal(firstCharacterView.parentAssetId, linAsset.id, "逐镜人物视觉资产应继承稳定身份资产");
    assert.equal(firstSceneView.parentAssetId, sceneAsset.id, "逐镜场景视觉资产应继承稳定空间资产");
    assert.notEqual(firstSceneView.id, secondSceneView.id, "同一空间的不同镜头必须保留独立机位资产");
    assert.notEqual(firstCharacterView.id, secondCharacterView.id, "同一人物的不同镜头必须保留独立造型视角资产");
    assert.equal(secondShot.assetReadiness.bindings.sceneId, secondSceneView.id, "后续分镜应绑定本镜场景视角资产");
    assert.equal(secondShot.assetReadiness.bindings.characterIds[0], secondCharacterView.id, "后续分镜应绑定本镜人物视觉资产");
    assert.ok(secondShot.assetReadiness.bindings.propIds.includes(propAsset.id), "镜头内容提到固定道具时应自动绑定道具资产 ID");
    assert.deepEqual(shot.assetReadiness.bindings.characterIds, [firstCharacterView.id], "镜头应保存逐镜人物资产 ID");
    assert.equal(shot.assetReadiness.bindings.sceneId, firstSceneView.id, "镜头应保存逐镜场景资产 ID");

    const renamed = await request(`/api/assets/${linAsset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "林澈导演" })
    });
    assert.equal(renamed.status, 200);
    assert.ok(renamed.body.aliases.includes("林澈"), "改名时旧名应自动保留为别名");
    const afterRename = await request(`/api/projects/${projectId}`);
    assert.equal(afterRename.body.sequences[0].shots[0].assetReadiness.bindings.characterIds[0], firstCharacterView.id, "基础身份改名不应改变逐镜视觉关联");

    const manual = await request(`/api/shots/${shot.id}/assets`, {
      method: "PATCH",
      body: JSON.stringify({ characterIds: [zhouAsset.id], sceneId: sceneAsset.id, propIds: [] })
    });
    assert.equal(manual.status, 200);
    assert.equal(manual.body.bindings.mode, "manual");
    assert.deepEqual(manual.body.bindings.characterIds, [zhouAsset.id]);
    const auto = await request(`/api/shots/${shot.id}/assets/auto`, { method: "POST", body: "{}" });
    assert.equal(auto.status, 200);
    assert.equal(auto.body.bindings.mode, "auto");
    assert.deepEqual(auto.body.bindings.characterIds, [firstCharacterView.id], "自动识别应恢复该镜头专属人物视觉资产");

    const previewBefore = await request(`/api/shots/${shot.id}/prompt-preview`);
    assert.equal(previewBefore.status, 200);
    assert.equal(previewBefore.body.blocked, true, "提示词预览应告知资产阻塞");
    assert.match(previewBefore.body.prompt, /纯文本试片/);

    const blocked = await request(`/api/shots/${shot.id}/generate`, {
      method: "POST",
      body: JSON.stringify({ count: 1, resolution: "720p" })
    });
    assert.equal(blocked.status, 409, "不能绕过前端直接生成未锁定资产的镜头");

    const reparsed = await request(`/api/projects/${projectId}/reparse-assets`, { method: "POST", body: "{}" });
    assert.equal(reparsed.status, 200, "旧项目应可重新识别资产");
    assert.equal(reparsed.body.assets.some((asset) => asset.name === "地铁列车"), false);

    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    for (const asset of created.body.assets) {
      const uploaded = await request(`/api/assets/${asset.id}/reference`, {
        method: "POST",
        body: JSON.stringify({ dataUrl: pixel, name: `${asset.name}.png` })
      });
      assert.equal(uploaded.status, 200, `应上传${asset.name}参考图`);
      assert.equal(uploaded.body.status, "draft", "上传后仍需要人工确认");
      const approved = await request(`/api/assets/${asset.id}/approve`, { method: "POST", body: "{}" });
      assert.equal(approved.status, 200, `应批准${asset.name}参考图`);
    }

    const readyProject = await request(`/api/projects/${projectId}`);
    const readyShot = readyProject.body.sequences[0].shots[0];
    assert.equal(readyShot.assetReadiness.ready, true, "人物和场景均批准后镜头应就绪");
    assert.equal(readyShot.assetReadiness.matched.length, 2);

    const previewAfter = await request(`/api/shots/${shot.id}/prompt-preview`);
    assert.equal(previewAfter.body.blocked, false);
    assert.equal(previewAfter.body.referenceAssets.length, 2);
    assert.deepEqual(previewAfter.body.submissionPlan.referenceImages.map((item) => item.type), ["character", "scene"], "参考图应按人物、场景稳定排序");
    assert.deepEqual(previewAfter.body.submissionPlan.referenceImages.map((item) => item.assetId), [firstCharacterView.id, firstSceneView.id]);
    assert.equal(previewAfter.body.submissionPlan.assetBindingSnapshot.characterIds[0], firstCharacterView.id, "提交计划应冻结逐镜视觉关联快照");
    assert.ok(previewAfter.body.submissionPlan.referenceImages.every((item) => item.version >= 1 && item.url), "提交计划应包含资产版本和参考图");
    assert.match(previewAfter.body.prompt, /图片1为/);
    assert.match(previewAfter.body.prompt, /图片2为/);

    console.log(JSON.stringify({
      ok: true,
      checks: 50,
      covered: ["分镜解析", "人物卡设定", "表格字段优先级", "稳定资产 ID", "逐镜人物视觉", "逐镜场景机位", "关键道具识别", "道具逐镜绑定", "改名与别名", "手动关联", "自动重新识别", "旧项目重新识别", "资产前置阻断", "参考图上传", "人工批准", "镜头就绪", "参考图排序", "版本快照", "提示词绑定", "逐镜提示词审计"]
    }, null, 2));
  } finally {
    if (projectId) db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
