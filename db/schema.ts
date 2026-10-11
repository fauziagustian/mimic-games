import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const config = sqliteTable('config', {id: text('id').primaryKey(), value: text('value').notNull()});
export const rules = sqliteTable('rules', {version: integer('version').primaryKey(), data: text('data').notNull(), createdAt: integer('created_at').notNull()});
export const categories = sqliteTable('categories', {id: text('id').primaryKey(), data: text('data').notNull(), active: integer('active').notNull().default(1)});
export const languages = sqliteTable('languages', {id: text('id').primaryKey(), data: text('data').notNull(), active: integer('active').notNull().default(1)});
export const sounds = sqliteTable('sounds', {
  id: text('id').primaryKey(), categoryId: text('category_id').notNull().references(()=>categories.id),
  language: text('language').notNull().references(()=>languages.id), data: text('data').notNull(),
  active: integer('active').notNull().default(1), revision: integer('revision').notNull().default(1),
}, t=>[index('sounds_filter').on(t.active,t.categoryId,t.language)]);
export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(), hostId: text('host_id').notNull(), code: text('code').notNull(),
  status: text('status').notNull(), data: text('data').notNull(), createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(),
},t=>[index('matches_host_created').on(t.hostId,t.createdAt)]);
export const members = sqliteTable('members', {
  id: text('id').primaryKey(), matchId: text('match_id').notNull().references(()=>matches.id),
  userId: text('user_id').notNull(), name: text('name').notNull(), peerId: text('peer_id').notNull(),
},t=>[uniqueIndex('members_match_user').on(t.matchId,t.userId),uniqueIndex('members_match_peer').on(t.matchId,t.peerId)]);
export const attempts = sqliteTable('attempts', {
  id: text('id').primaryKey(), matchId: text('match_id').notNull().references(()=>matches.id),
  round: integer('round').notNull(), userId: text('user_id').notNull(), name: text('name').notNull(),
  categoryId: text('category_id').notNull(), soundId: text('sound_id').notNull(), language: text('language').notNull(),
  version: integer('version').notNull(), status: text('status').notNull(), score: integer('score'),
  data: text('data').notNull(), audioKey: text('audio_key').notNull(), audioHash: text('audio_hash').notNull(),
  createdAt: integer('created_at').notNull(), reviewedAt: integer('reviewed_at'), reviewer: text('reviewer'),
},t=>[uniqueIndex('attempt_once').on(t.matchId,t.round,t.userId),index('attempt_review').on(t.status,t.createdAt),index('attempt_leaderboard').on(t.version,t.status,t.categoryId,t.userId),index('attempt_user_created').on(t.userId,t.createdAt)]);
export const audit = sqliteTable('audit', {id:text('id').primaryKey(), actor:text('actor').notNull(),action:text('action').notNull(),target:text('target').notNull(),createdAt:integer('created_at').notNull()});
export const rooms = sqliteTable('rooms',{code:text('code').primaryKey(),matchId:text('match_id').notNull(),revision:integer('revision').notNull().default(0),data:text('data').notNull(),expiresAt:integer('expires_at').notNull()});
export const takes = sqliteTable('takes',{id:text('id').primaryKey(),matchId:text('match_id').notNull(),round:integer('round').notNull(),userId:text('user_id').notNull(),data:text('data').notNull(),audioKey:text('audio_key').notNull()},t=>[uniqueIndex('take_once').on(t.matchId,t.round,t.userId)]);
export const communitySubmissions = sqliteTable('community_submissions', {
  id:text('id').primaryKey(), ownerId:text('owner_id').notNull(), requestId:text('request_id').notNull(),
  categoryId:text('category_id').notNull().references(()=>categories.id), language:text('language').notNull().references(()=>languages.id),
  status:text('status').notNull().default('pending'), data:text('data').notNull(), audioKey:text('audio_key').notNull(),
  soundId:text('sound_id').references(()=>sounds.id), createdAt:integer('created_at').notNull(),
  reviewedAt:integer('reviewed_at'), reviewer:text('reviewer'), reviewNote:text('review_note').notNull().default(''),
  actionToken:text('action_token'),
},t=>[uniqueIndex('community_request').on(t.ownerId,t.requestId),uniqueIndex('community_sound').on(t.soundId),index('community_owner_created').on(t.ownerId,t.createdAt),index('community_status_created').on(t.status,t.createdAt)]);
