// Barrel: gives callers a single import surface and a factory that builds
// all repos against one db connection.

import type { Database } from 'better-sqlite3';
import { createBacklinksRepository, type BacklinksRepository } from './backlinks.js';
import { createCommentsRepository, type CommentsRepository } from './comments.js';
import { createMentionsRepository, type MentionsRepository } from './mentions.js';
import {
  createNoteTitlesHistoryRepository,
  type NoteTitlesHistoryRepository,
} from './note-titles-history.js';
import { createNotesRepository, type NotesRepository } from './notes.js';
import { createSearchRepository, type SearchRepository } from './search.js';
import { createSnapshotsRepository, type SnapshotsRepository } from './snapshots.js';
import { createTagsRepository, type TagsRepository } from './tags.js';
import { createUsersRepository, type UsersRepository } from './users.js';

export interface Repositories {
  users: UsersRepository;
  notes: NotesRepository;
  noteTitlesHistory: NoteTitlesHistoryRepository;
  tags: TagsRepository;
  backlinks: BacklinksRepository;
  comments: CommentsRepository;
  snapshots: SnapshotsRepository;
  mentions: MentionsRepository;
  search: SearchRepository;
}

export function createRepositories(db: Database): Repositories {
  return {
    users: createUsersRepository(db),
    notes: createNotesRepository(db),
    noteTitlesHistory: createNoteTitlesHistoryRepository(db),
    tags: createTagsRepository(db),
    backlinks: createBacklinksRepository(db),
    comments: createCommentsRepository(db),
    snapshots: createSnapshotsRepository(db),
    mentions: createMentionsRepository(db),
    search: createSearchRepository(db),
  };
}

export type { UsersRepository } from './users.js';
export type { NotesRepository } from './notes.js';
export type { NoteTitlesHistoryRepository, TitleResolution } from './note-titles-history.js';
export type { TagsRepository } from './tags.js';
export type { BacklinksRepository, BacklinkInput } from './backlinks.js';
export type { CommentsRepository, CommentInsert } from './comments.js';
export type { SnapshotsRepository, SnapshotInsert } from './snapshots.js';
export type { MentionsRepository, MentionInsert } from './mentions.js';
export type { SearchRepository } from './search.js';
export type {
  UserRow,
  NoteRow,
  NoteTitleHistoryRow,
  BacklinkRow,
  CommentRow,
  SnapshotRow,
  MentionRow,
  SearchHit,
} from './types.js';
