// Copyright IBM Corp. 2019. All Rights Reserved.
// Node module: @loopback/cli
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

/*
A lightweight helper for snapshot-based testing.
- Feature inspired by https://jestjs.io/docs/en/snapshot-testing
- Implementation inspired by node-tap

This is an initial experimental version. In the (near) future, we should
move this file to a standalone package so that all Mocha users can use it.
*/

const assert = require('assert');
const path = require('path');

module.exports = {
  initializeSnapshots,
};

/**
 * Create a function to match the given value against a pre-recorder snapshot.
 *
 * Example usage:
 *
 * ```js
 * // At the top of your test file, initialize the matcher function.
 * // You can also move this code to a shared file require()d from tests.
 * const expectToMatchSnapshot = initializeSnapshots(
 *   path.resolve(__dirname, '../../__snapshots__'),
 * );
 *
 * // Inside your tests, call `expectToMatchSnapshot(actualValue)`
 * describe('my feature', () => {
 *   it('works for strings', function() {
 *     expectToMatchSnapshot('foo\nbar');
 *   });
 * });
 * ```
 */
function initializeSnapshots(snapshotDir) {
  let currentTest;

  beforeEach(function setupSnapshots() {
    // eslint-disable-next-line no-invalid-this
    currentTest = this.currentTest;
    currentTest.__snapshotCounter = 1;
  });

  if (!process.env.UPDATE_SNAPSHOTS) {
    return function expectToMatchSnapshot(actual) {
      matchSnapshot(snapshotDir, currentTest, actual);
    };
  }

  const snapshots = Object.create(null);
  after(function updateSnapshots() {
    for (const f in snapshots) {
      const snapshotFile = buildSnapshotFilePath(snapshotDir, f);
      writeSnapshotData(snapshotFile, snapshots[f]);
    }
  });

  return function expectToRecordSnapshot(actual) {
    recordSnapshot(snapshots, currentTest, actual);
  };
}

function matchSnapshot(snapshotDir, currentTest, actualValue) {
  assert(
    typeof actualValue === 'string',
    'Snapshot matcher supports string values only, but was called with ' +
      typeof actualValue,
  );

  const snapshotFile = buildSnapshotFilePath(snapshotDir, currentTest.file);
  const snapshotData = loadSnapshotData(snapshotFile);
  const key = buildSnapshotKey(currentTest);

  if (!(key in snapshotData)) {
    throw new Error(
      `No snapshot found for ${JSON.stringify(key)}.\n` +
        'Run the tests with UPDATE_SNAPSHOTS=1 in the environment ' +
        'to create and update snapshot files.',
    );
  }

  assert.deepStrictEqual(actualValue, snapshotData[key]);
}

function recordSnapshot(snapshots, currentTest, actualValue) {
  assert(
    typeof actualValue === 'string',
    'Snapshot matcher supports string values only, but was called with ' +
      typeof actualValue,
  );

  const key = buildSnapshotKey(currentTest);
  const testFile = currentTest.file;
  if (!snapshots[testFile]) snapshots[testFile] = Object.create(null);
  snapshots[testFile][key] = actualValue;
}

function buildSnapshotKey(currentTest) {
  const counter = currentTest.__snapshotCounter || 1;
  currentTest.__snapshotCounter = counter + 1;
  return `${getFullTestName(currentTest)} ${counter}`;
}

function getFullTestName(currentTest) {
  let result = currentTest.title;
  for (;;) {
    if (!currentTest.parent) break;
    currentTest = currentTest.parent;
    if (currentTest.title) {
      result = currentTest.title + ' ' + result;
    }
  }
  return result;
}

function buildSnapshotFilePath(snapshotDir, currentTestFile) {
  const parsed = path.parse(currentTestFile);
  const parts = path.normalize(parsed.dir).split(path.sep);

  const ix = parts.findIndex(p => p === 'test' || p === '__tests__');
  if (ix < 0) {
    throw new Error(
      'Snapshot checker requires test files in `test` or `__tests__`',
    );
  }

  // Remove everything from start up to (including) `test` or `__tests__`
  parts.splice(0, ix + 1);

  return path.join(snapshotDir, ...parts, parsed.name + '.snapshots.js');
}

function loadSnapshotData(snapshotFile) {
  try {
    const data = require(snapshotFile);
    for (const key in data) {
      const entry = data[key];
      if (entry.length > 2 && entry.startsWith('\n') && entry.endsWith('\n')) {
        data[key] = entry.slice(1, -1);
      }
    }
    return data;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `Snapshot file ${snapshotFile} was not found.\n` +
          'Run the tests with UPDATE_SNAPSHOTS=1 in the environment ' +
          'to create and update snapshot files.',
      );
    }
    throw err;
  }
}

function writeSnapshotData(snapshotFile, snapshots) {
  const writeFileAtomic = require('write-file-atomic');
  const naturalCompare = require('natural-compare');
  const mkdirp = require('mkdirp');

  const header = `// IMPORTANT
// This snapshot file is auto-generated, but designed for humans.
// It should be checked into source control and tracked carefully.
// Re-generate by setting UPDATE_SNAPSHOTS=1 and running tests.
// Make sure to inspect the changes in the snapshots below.
// Do not ignore changes!

'use strict';
`;

  const entries = Object.keys(snapshots)
    .sort(naturalCompare)
    .map(key => buildSnapshotCode(key, snapshots[key]));

  const content = header + entries.join('\n');
  mkdirp.sync(path.dirname(snapshotFile));
  writeFileAtomic.sync(snapshotFile, content, {encoding: 'utf-8'});
}

function buildSnapshotCode(key, value) {
  return `
exports[\`${escape(key)}\`] = \`
${escape(normalizeNewlines(value))}
\`;
`;
}

function escape(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function normalizeNewlines(value) {
  return value.replace(/\r\n|\r/g, '\n');
}