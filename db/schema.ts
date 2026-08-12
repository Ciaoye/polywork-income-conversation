import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const eventState = sqliteTable("event_state", {
  id: integer("id").primaryKey(),
  activeQuestion: integer("active_question").notNull().default(0),
  revealAnswers: integer("reveal_answers", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const responses = sqliteTable("responses", {
  id: text("id").primaryKey(),
  questionId: text("question_id").notNull(),
  participantId: text("participant_id").notNull(),
  data: text("data").notNull(),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  highlighted: integer("highlighted", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_responses_question_participant").on(table.questionId, table.participantId),
  index("idx_responses_question").on(table.questionId, table.hidden),
]);

export const reactions = sqliteTable("reactions", {
  responseId: text("response_id").notNull().references(() => responses.id, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.responseId, table.participantId] })]);
