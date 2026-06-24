const fs = require('fs');
const f = 'node_modules/ai/dist/index.mjs';
const s = fs.readFileSync(f, 'utf8');
for (const kw of ['runUpdateMessageJob', 'this.state.replaceMessage', 'state.pushMessage', 'this.state.snapshot', 'write:', 'replaceMessage(']) {
  const i = s.indexOf(kw);
  console.log('\n### ' + kw + ' @ ' + i);
  if (i >= 0) console.log(s.slice(i - 160, i + 360));
}
