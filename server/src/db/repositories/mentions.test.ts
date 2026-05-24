import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';
import { createMentionsRepository } from './mentions.js';
import { createNotesRepository } from './notes.js';
import { createUsersRepository } from './users.js';

function seed(db: import('better-sqlite3').Database): void {
  const users = createUsersRepository(db);
  users.insert({
    id: 'u-alice',
    email: 'alice@example.com',
    display_name: 'alice',
    color: '#f00',
    created_at: '2026-05-23T00:00:00.000Z',
  });
  users.insert({
    id: 'u-bob',
    email: 'bob@example.com',
    display_name: 'bob',
    color: '#0f0',
    created_at: '2026-05-23T00:00:00.000Z',
  });
  createNotesRepository(db).insert({
    id: 'n1',
    title: 't',
    created_by: 'u-alice',
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
    trashed_at: null,
    markdown_export: '',
  });
}

const baseMention = {
  note_id: 'n1',
  mentioned_user_id: 'u-bob',
  mentioning_user_id: 'u-alice',
  source: 'note:n1',
};

describe('MentionsRepository', () => {
  test('insert + listForUser returns unread by default state (read_at NULL)', ({ db }) => {
    seed(db);
    const repo = createMentionsRepository(db);
    const m = repo.insert({ ...baseMention, id: 'm1', created_at: '2026-05-23T00:00:00.000Z' });
    expect(m.read_at).toBeNull();
    expect(m.email_sent_at).toBeNull();
    expect(repo.listForUser('u-bob').map((r) => r.id)).toEqual(['m1']);
  });

  test('listForUser({ unread: true }) hides read mentions', ({ db }) => {
    seed(db);
    const repo = createMentionsRepository(db);
    repo.insert({ ...baseMention, id: 'm1', created_at: '2026-05-23T00:00:00.000Z' });
    repo.insert({ ...baseMention, id: 'm2', created_at: '2026-05-23T00:01:00.000Z' });
    repo.markRead('m1', '2026-05-23T01:00:00.000Z');

    expect(repo.listForUser('u-bob', { unread: true }).map((r) => r.id)).toEqual(['m2']);
    expect(repo.listForUser('u-bob').map((r) => r.id)).toEqual(['m2', 'm1']);
  });

  test('listForUser orders newest-first', ({ db }) => {
    seed(db);
    const repo = createMentionsRepository(db);
    repo.insert({ ...baseMention, id: 'm1', created_at: '2026-05-23T00:00:00.000Z' });
    repo.insert({ ...baseMention, id: 'm2', created_at: '2026-05-23T00:02:00.000Z' });
    repo.insert({ ...baseMention, id: 'm3', created_at: '2026-05-23T00:01:00.000Z' });

    expect(repo.listForUser('u-bob').map((r) => r.id)).toEqual(['m2', 'm3', 'm1']);
  });

  test('listPendingEmail returns mentions with email_sent_at IS NULL', ({ db }) => {
    seed(db);
    const repo = createMentionsRepository(db);
    repo.insert({ ...baseMention, id: 'm1', created_at: '2026-05-23T00:00:00.000Z' });
    repo.insert({ ...baseMention, id: 'm2', created_at: '2026-05-23T00:01:00.000Z' });
    repo.markEmailSent(['m1'], '2026-05-23T00:05:00.000Z');

    expect(repo.listPendingEmail().map((r) => r.id)).toEqual(['m2']);
  });

  test('markEmailSent updates all listed ids', ({ db }) => {
    seed(db);
    const repo = createMentionsRepository(db);
    repo.insert({ ...baseMention, id: 'm1', created_at: '2026-05-23T00:00:00.000Z' });
    repo.insert({ ...baseMention, id: 'm2', created_at: '2026-05-23T00:01:00.000Z' });
    repo.markEmailSent(['m1', 'm2'], '2026-05-23T00:05:00.000Z');
    expect(repo.listPendingEmail()).toEqual([]);
  });

  test('markEmailSent with empty list is a no-op', ({ db }) => {
    seed(db);
    const repo = createMentionsRepository(db);
    repo.insert({ ...baseMention, id: 'm1', created_at: '2026-05-23T00:00:00.000Z' });
    expect(() => repo.markEmailSent([], '2026-05-23T00:05:00.000Z')).not.toThrow();
    expect(repo.listPendingEmail()).toHaveLength(1);
  });
});
