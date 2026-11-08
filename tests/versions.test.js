import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMajor,
  addMinor,
  listVersions,
  nextMajorVersion,
  nextMinorVersion,
  resolveVersionTarget,
} from '../src/domain/versions.js';
import { defaultMessage } from '../src/commands/submit.js';
import { makeTmpDir, cleanup } from './helpers/fixtures.js';

const tmpdir = () => makeTmpDir({}, { prefix: 'ftml-ver-' });

test('版本号递增：未部署时小版本落在 0 下，部署后归属新大版本', () => {
  const root = tmpdir();
  try {
    assert.equal(nextMajorVersion(root), '1');
    assert.equal(nextMinorVersion(root).version, '0.1');

    addMajor(root, { commit: 'a1', message: '首次部署', tag: 'v1' });
    assert.equal(nextMajorVersion(root), '2');
    assert.equal(nextMinorVersion(root).version, '1.1');

    addMinor(root, { commit: 'b1', message: '小改' });
    assert.equal(nextMinorVersion(root).version, '1.2');
  } finally {
    cleanup(root);
  }
});

test('resolveVersionTarget：小版本本地回自身，线上回到所属大版本快照', () => {
  const root = tmpdir();
  try {
    addMajor(root, { commit: 'major-hash', message: '大版本 1', tag: 'v1' });
    addMinor(root, { commit: 'minor-hash', message: '小版本 1.1' });

    const minor = resolveVersionTarget(root, '1.1');
    assert.equal(minor.commit, 'minor-hash');
    assert.equal(minor.remoteCommit, 'major-hash');
    assert.equal(minor.remoteVersion, '1');

    const major = resolveVersionTarget(root, '1');
    assert.equal(major.commit, 'major-hash');
    assert.equal(major.remoteCommit, 'major-hash');
    assert.equal(major.remoteVersion, '1');
  } finally {
    cleanup(root);
  }
});

test('listVersions：新版本在前，并带创建时间供 UI 展示', () => {
  const root = tmpdir();
  try {
    addMajor(root, { commit: 'a1', message: 'm1', tag: 'v1' });
    addMinor(root, { commit: 'b1', message: 'm1.1' });
    const rows = listVersions(root);
    assert.deepEqual(rows.map((r) => r.version), ['1.1', '1']);
    assert.ok(rows.every((r) => typeof r.createdAt === 'string' && r.createdAt.length > 0));
    assert.equal(rows[0].major, '1');
  } finally {
    cleanup(root);
  }
});

test('defaultMessage：生成带本地时间的提交 / 部署说明', () => {
  const at = new Date(2026, 10, 8, 9, 5);
  assert.equal(defaultMessage('submit', at), '提交 2026-11-08 09:05');
  assert.equal(defaultMessage('deploy', at), '部署 2026-11-08 09:05');
});
