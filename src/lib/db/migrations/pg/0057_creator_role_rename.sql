ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'creator';--> statement-breakpoint
UPDATE "user" SET "role" = 'creator' WHERE "role" = 'editor';--> statement-breakpoint
