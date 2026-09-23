const assert = require('assert').strict;
const { findLuaSyntaxIssues } = require('../out/lua-syntax.js');

assert.equal(findLuaSyntaxIssues("print('ok')").length, 0);
assert.match(findLuaSyntaxIssues("print('oops)")[0].message, /Unterminated/);
assert.match(findLuaSyntaxIssues('moveJoint({1, 2)').map((issue) => issue.message).join(','), /Unclosed/);
assert.match(findLuaSyntaxIssues(')')[0].message, /Unexpected/);
assert.equal(findLuaSyntaxIssues('-- print(\nprint("ok")').length, 0);
console.log('Lua syntax checks passed');
