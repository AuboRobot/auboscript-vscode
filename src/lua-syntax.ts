export interface LuaSyntaxIssue {
  message: string;
  offset: number;
  length: number;
}

const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

export function findLuaSyntaxIssues(source: string): LuaSyntaxIssue[] {
  const issues: LuaSyntaxIssue[] = [];
  const stack: Array<{ open: string; offset: number }> = [];
  let quote = '';
  let quoteOffset = -1;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === ']' && next === ']') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      } else if (char === '\n') {
        issues.push({ message: 'Unterminated string', offset: quoteOffset, length: index - quoteOffset });
        quote = '';
      }
      continue;
    }
    if (char === '-' && next === '-') {
      if (source[index + 2] === '[' && source[index + 3] === '[') {
        blockComment = true;
        index += 3;
      } else {
        lineComment = true;
        index += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoteOffset = index;
      continue;
    }
    if (char === '[' && next === '[') {
      blockComment = false;
      index += 1;
      continue;
    }
    if (pairs[char]) {
      stack.push({ open: char, offset: index });
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      const expected = stack.pop();
      if (!expected || pairs[expected.open] !== char) {
        issues.push({ message: `Unexpected '${char}'`, offset: index, length: 1 });
      }
    }
  }
  if (quote) issues.push({ message: 'Unterminated string', offset: quoteOffset, length: source.length - quoteOffset });
  for (const entry of stack.reverse()) {
    issues.push({ message: `Unclosed '${entry.open}'`, offset: entry.offset, length: 1 });
  }
  return issues;
}
