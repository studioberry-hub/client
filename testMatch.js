// escapeHtml as in the app
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const body = '\uD83D\uDCC1 \u0420\u0435\u043F\u043E\u0441\u0442 \u00B7 Undefined Studio\n## \u0420\u0430\u0431\u043E\u0442\u0430 \u0441\u0435\u0440\u0432\u0438\u0441\u043E\u0432\n\n#post:e94e4a78-c4a4-4a47-803c-f71a655ab795';
const html = escapeHtml(body);
console.log('escaped html:', JSON.stringify(html));

// Test the match that we use in formatMessageBodyHtml
const repostMatch = html.match(/\uD83D\uDCC1 \u0420\u0435\u043F\u043E\u0441\u0442 \u00B7 (.*?)\n([\s\S]*?)#post:([\w-]+)/);
console.log('repostMatch:', repostMatch ? 'MATCH' : 'NO MATCH');

// The text in escaped HTML uses the raw emoji
const m2 = html.match(/📁/);
console.log('raw emoji in escaped:', m2 ? 'FOUND' : 'NOT FOUND');

// The regex we currently use references \u0440\u0435\u043f\u043e\u0441\u0442
const m3 = html.match(/Репост · (.*?)\n([\s\S]*?)#post:([\w-]+)/);
console.log('Репост match:', m3 ? 'MATCH' : 'NO MATCH');
if (m3) {
  console.log('author:', m3[1]);
  console.log('snippet:', m3[2].slice(0, 40));
  console.log('postId:', m3[3]);
}
