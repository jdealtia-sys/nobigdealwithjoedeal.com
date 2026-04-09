const fs = require('fs');
const files = ['index.js', 'email-functions.js', 'sms-functions.js', 'push-functions.js'];
const secrets = new Set();
files.forEach(f => {
  try {
    const c = fs.readFileSync(f, 'utf8');
    const m = c.match(/defineSecret\(['"]([^'"]+)['"]\)/g);
    if (m) m.forEach(s => {
      const n = s.match(/defineSecret\(['"]([^'"]+)['"]\)/);
      if (n) secrets.add(n[1]);
    });
  } catch(e) {}
});
console.log([...secrets].join('\n'));