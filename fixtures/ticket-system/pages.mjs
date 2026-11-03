const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function renderPage(sessionId, route, origin) {
  const sid = escapeHtml(sessionId);
  const base = `/ticket-system/s/${sid}`;
  const body = route === 'home'
    ? `<main><h1>工单系统</h1><nav><a href="${base}/create">创建工单</a> <a href="${base}/list">工单列表</a></nav></main>`
    : `<div id="root" data-session-id="${sid}" data-route="${escapeHtml(route)}" data-origin="${escapeHtml(origin)}"></div>`;
  const scripts = route === 'home' ? '' : `
<script src="/assets/vendor/react.production.min.js"></script>
<script src="/assets/vendor/react-dom.production.min.js"></script>
<script src="/assets/app.js"></script>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工单系统</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
${body}${scripts}
</body>
</html>`;
}
