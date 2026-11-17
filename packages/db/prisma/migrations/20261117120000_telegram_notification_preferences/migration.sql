ALTER TABLE "TelegramAccount"
  ADD COLUMN "notifyNewTitles" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyNewEpisodes" BOOLEAN NOT NULL DEFAULT true;
