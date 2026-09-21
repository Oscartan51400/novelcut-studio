#!/usr/bin/env node
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
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
    const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
    assert.match(appJs, /\["workspace", "assets"\]\.includes\(state\.view\)/, "资产页也必须轮询项目是否被其他页面删除或更新");
    const created = await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: `删除一致性临时测试-${Date.now()}`,
        sourceText: "镜头 01｜状态测试\n- 时长：5秒\n- 场景：测试场景\n- 画面：静止测试画面。",
        aspectRatio: "9:16",
        resolution: "720p"
      })
    });
    assert.equal(created.status, 201, "项目应创建成功");
    projectId = created.body.id;
    const shotId = created.body.sequences[0].shots[0].id;
    const takeId = `take_delete_matrix_${crypto.randomUUID()}`;
    const jobId = `job_delete_matrix_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();

    db.prepare(`INSERT INTO takes
      (id, shot_id, take_no, status, prompt, created_at, updated_at)
      VALUES (?, ?, 1, 'processing', '临时一致性测试', ?, ?)`)
      .run(takeId, shotId, timestamp, timestamp);
    db.prepare(`INSERT INTO jobs
      (id, project_id, shot_id, take_id, status, request_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'processing', '{}', ?, ?)`)
      .run(jobId, projectId, shotId, takeId, timestamp, timestamp);

    const staleDelete = await request(`/api/projects/${projectId}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedUpdatedAt: "stale-version" })
    });
    assert.equal(staleDelete.status, 409, "过期标签页不得删除已更新的项目");

    const blockedDelete = await request(`/api/projects/${projectId}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedUpdatedAt: created.body.updatedAt })
    });
    assert.equal(blockedDelete.status, 409, "有生成任务时必须阻止删除");

    db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(jobId);
    db.prepare("UPDATE takes SET status = 'failed' WHERE id = ?").run(takeId);
    const deleted = await request(`/api/projects/${projectId}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedUpdatedAt: created.body.updatedAt })
    });
    assert.equal(deleted.status, 200, "项目应能删除");

    const matrix = await Promise.all([
      request(`/api/projects/${projectId}`),
      request(`/api/projects/${projectId}/import-shots`, { method: "POST", body: JSON.stringify({ sourceText: "镜头 01｜不应追加\n- 画面：测试" }) }),
      request(`/api/projects/${projectId}/rough-cut`),
      request(`/api/projects/${projectId}/assemble`, { method: "POST", body: "{}" }),
      request(`/api/shots/${shotId}`, { method: "PATCH", body: JSON.stringify({ title: "不应修改" }) }),
      request(`/api/shots/${shotId}/generate`, { method: "POST", body: JSON.stringify({ count: 1 }) }),
      request(`/api/takes/${takeId}/approve`, { method: "POST", body: "{}" }),
      request(`/api/jobs?projectId=${encodeURIComponent(projectId)}`),
      request(`/api/jobs/${jobId}/query`, { method: "POST", body: "{}" })
    ]);
    assert.deepEqual(matrix.map((result) => result.status), [404, 404, 404, 404, 404, 404, 404, 200, 404]);
    assert.deepEqual(matrix[7].body, [], "已删除项目的任务列表必须为空");

    const listAfterDelete = await request("/api/projects");
    assert.equal(listAfterDelete.body.some((project) => project.id === projectId), false, "列表不应出现已删除项目");

    const restored = await request(`/api/projects/${projectId}/restore`, { method: "POST", body: "{}" });
    assert.equal(restored.status, 200, "项目应能恢复");
    const restoredProject = await request(`/api/projects/${projectId}`);
    assert.equal(restoredProject.status, 200, "恢复后工作台数据应可访问");

    const deletedAgain = await request(`/api/projects/${projectId}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedUpdatedAt: restoredProject.body.updatedAt })
    });
    assert.equal(deletedAgain.status, 200, "恢复后应能再次删除");

    console.log(JSON.stringify({
      ok: true,
      checks: 18,
      covered: ["列表", "工作台", "资产页冷启动缓存", "追加", "分镜编辑", "生成", "候选", "任务", "粗剪", "合片", "恢复", "活跃任务保护", "过期标签删除保护"]
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
