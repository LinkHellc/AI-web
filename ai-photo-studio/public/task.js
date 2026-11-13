// 生成任务的提交与轮询（首页工作台 / 3D 镜头共用）
// 发布平台网关会在 60 秒掐断长请求，而生图常需 55～150 秒。
// 因此 POST 只拿 taskId，之后用短请求轮询结果，任何一次请求都不会挂起太久。
'use strict';
async function generateAsync(body, timeoutMs = 6 * 60 * 1000) {
  const sub = await api('/api/generate', { method: 'POST', body });
  if (!sub || !sub.taskId) throw new Error('提交生成任务失败');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const t = await api('/api/task/' + encodeURIComponent(sub.taskId));
    if (t.status === 'done') return t.result;
    if (t.status === 'error') {
      const e = new Error((t.error && t.error.message) || '生成失败');
      e.status = (t.error && t.error.status) || 500;
      throw e;
    }
  }
  throw new Error('生成超时，请到画廊看看是否已经生成');
}
