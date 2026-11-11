import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeSlackHtml, renderSlackMrkdwn } from '../src/posting/slack/mrkdwn';

test('Slack preview escapes HTML before applying mrkdwn', () => {
  const escaped = escapeSlackHtml('<script>alert("x")</script>');
  assert.equal(escaped, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');

  const rendered = renderSlackMrkdwn('<img src=x onerror=alert(1)>');
  assert.ok(!rendered.includes('<img'));
  assert.ok(rendered.includes('&lt;img'));
});

test('Slack preview supports bold, italic, strike and inline code', () => {
  const rendered = renderSlackMrkdwn('*join* _us_ ~now~ `npm test`');
  assert.ok(rendered.includes('<strong>join</strong>'));
  assert.ok(rendered.includes('<em>us</em>'));
  assert.ok(rendered.includes('<s>now</s>'));
  assert.ok(rendered.includes('<code'));
  assert.ok(rendered.includes('npm test</code>'));
});

test('inline code is not re-parsed for emphasis markers', () => {
  const rendered = renderSlackMrkdwn('`*not bold* _not italic_`');
  assert.ok(!rendered.includes('<strong>'));
  assert.ok(!rendered.includes('<em>'));
  assert.ok(rendered.includes('*not bold* _not italic_'));
});

test('Slack-style links render only for http(s) targets', () => {
  const rendered = renderSlackMrkdwn('Apply <https://crewlink.test/join/crew|here>');
  assert.ok(rendered.includes('href="https://crewlink.test/join/crew"'));
  assert.ok(rendered.includes('rel="noreferrer"'));
  assert.ok(rendered.includes('>here</a>'));

  const unsafe = renderSlackMrkdwn('<javascript:alert(1)>');
  assert.ok(!unsafe.includes('<a '));
  assert.ok(unsafe.includes('&lt;javascript:alert(1)&gt;'));
});

test('mentions and channel references render as labels', () => {
  const rendered = renderSlackMrkdwn('Ask <@U123> in <#C456|general>');
  assert.ok(rendered.includes('>@U123</span>'));
  assert.ok(rendered.includes('>general</span>'));
  assert.ok(!rendered.includes('<a '));
});

test('unknown angle-bracket text stays literal', () => {
  const rendered = renderSlackMrkdwn('<not a ref> and <broken');
  assert.ok(rendered.includes('&lt;not a ref&gt;'));
  assert.ok(rendered.includes('&lt;broken'));
});

test('fenced code blocks escape their contents and ignore styling', () => {
  const rendered = renderSlackMrkdwn('```\n*join* <b>now</b>\n```');
  assert.ok(rendered.includes('<pre'));
  assert.ok(rendered.includes('*join*'));
  assert.ok(!rendered.includes('<strong>'));
  assert.ok(!rendered.includes('<b>'));
  assert.ok(rendered.includes('&lt;b&gt;now&lt;/b&gt;'));
});

test('an unclosed fence still renders safely as code', () => {
  const rendered = renderSlackMrkdwn('```\n<b>unfinished');
  assert.ok(rendered.includes('<pre'));
  assert.ok(rendered.includes('&lt;b&gt;unfinished'));
});

test('blockquotes are grouped and lines are joined', () => {
  const rendered = renderSlackMrkdwn('> first\n> second\nnormal');
  assert.ok(rendered.includes('<blockquote'));
  assert.ok(rendered.includes('first<br />second'));
  assert.ok(rendered.includes('normal'));
});

test('Windows line endings are normalised and empty text renders nothing', () => {
  assert.equal(renderSlackMrkdwn('   '), '');
  const rendered = renderSlackMrkdwn('one\r\ntwo');
  assert.equal(rendered, 'one<br />two');
});
