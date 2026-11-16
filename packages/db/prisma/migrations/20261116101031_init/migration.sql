-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmailTokenType" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TitleType" AS ENUM ('MOVIE', 'SERIES');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CreditRole" AS ENUM ('CAST', 'DIRECTOR', 'WRITER', 'CREATOR');

-- CreateEnum
CREATE TYPE "ImageKind" AS ENUM ('POSTER', 'BACKDROP', 'LOGO', 'STILL');

-- CreateEnum
CREATE TYPE "ProbeStatus" AS ENUM ('PENDING', 'OK', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('MAIN', 'PREVIEW');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RatingValue" AS ENUM ('DISLIKE', 'LIKE', 'LOVE');

-- CreateEnum
CREATE TYPE "HomeRowKind" AS ENUM ('COLLECTION', 'GENRE', 'TRENDING', 'TOP10', 'CONTINUE_WATCHING', 'MY_LIST', 'NEW_RELEASES');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "emailVerifiedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "EmailTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "avatarKey" TEXT NOT NULL,
    "isKids" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'vi',
    "pinHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "maxHeight" INTEGER NOT NULL DEFAULT 1080,
    "maxConcurrentStreams" INTEGER NOT NULL DEFAULT 1,
    "maxProfiles" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerRef" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "subscriptionId" UUID,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "rawPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Title" (
    "id" UUID NOT NULL,
    "type" "TitleType" NOT NULL,
    "slug" TEXT NOT NULL,
    "tmdbId" INTEGER,
    "imdbId" TEXT,
    "name" TEXT NOT NULL,
    "originalName" TEXT,
    "tagline" TEXT,
    "overview" TEXT,
    "releaseDate" DATE,
    "runtimeMinutes" INTEGER,
    "maturityRating" TEXT,
    "originalLang" TEXT,
    "countries" TEXT[],
    "tmdbRating" DOUBLE PRECISION,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "overriddenFields" TEXT[],
    "tmdbSyncedAt" TIMESTAMP(3),
    "previewAssetId" UUID,
    "mainAssetId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Genre" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "tmdbId" INTEGER,

    CONSTRAINT "Genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TitleGenre" (
    "titleId" UUID NOT NULL,
    "genreId" UUID NOT NULL,

    CONSTRAINT "TitleGenre_pkey" PRIMARY KEY ("titleId","genreId")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "tmdbId" INTEGER,
    "name" TEXT NOT NULL,
    "profileKey" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credit" (
    "id" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "role" "CreditRole" NOT NULL,
    "character" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Image" (
    "id" UUID NOT NULL,
    "titleId" UUID,
    "episodeId" UUID,
    "kind" "ImageKind" NOT NULL,
    "key" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "blurData" TEXT,
    "language" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "name" TEXT,
    "overview" TEXT,
    "airDate" DATE,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "name" TEXT,
    "overview" TEXT,
    "runtimeMinutes" INTEGER,
    "airDate" DATE,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "introStartSec" INTEGER,
    "introEndSec" INTEGER,
    "creditsStartSec" INTEGER,
    "mainAssetId" UUID,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFile" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "etag" TEXT,
    "lastModified" TIMESTAMP(3),
    "probeStatus" "ProbeStatus" NOT NULL DEFAULT 'PENDING',
    "probeError" TEXT,
    "container" TEXT,
    "durationSec" DOUBLE PRECISION,
    "videoCodec" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "frameRate" DOUBLE PRECISION,
    "bitrateKbps" INTEGER,
    "isHdr" BOOLEAN,
    "audioTracks" JSONB,
    "subtitleTracks" JSONB,
    "probeData" JSONB,
    "probedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "sourceFileId" UUID,
    "kind" "AssetKind" NOT NULL DEFAULT 'MAIN',
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "durationSec" DOUBLE PRECISION,
    "outputPrefix" TEXT,
    "encKeyCipher" BYTEA,
    "encKeyIv" BYTEA,
    "encKeyTag" BYTEA,
    "hlsIv" TEXT,
    "thumbsVttKey" TEXT,
    "posterFrameKey" TEXT,
    "errorMessage" TEXT,
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rendition" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "videoKbps" INTEGER NOT NULL,
    "audioKbps" INTEGER NOT NULL,
    "codecs" TEXT NOT NULL,
    "playlistKey" TEXT NOT NULL,

    CONSTRAINT "Rendition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtitleTrack" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isForced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SubtitleTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioTrack" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channels" INTEGER NOT NULL DEFAULT 2,
    "playlistKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AudioTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscodeJob" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "queueJobId" TEXT,
    "error" TEXT,
    "log" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscodeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchProgress" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "episodeId" UUID,
    "positionSec" DOUBLE PRECISION NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyListItem" (
    "profileId" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MyListItem_pkey" PRIMARY KEY ("profileId","titleId")
);

-- CreateTable
CREATE TABLE "Rating" (
    "profileId" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "value" "RatingValue" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("profileId","titleId")
);

-- CreateTable
CREATE TABLE "ViewEvent" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "collectionId" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("collectionId","titleId")
);

-- CreateTable
CREATE TABLE "HomeRow" (
    "id" UUID NOT NULL,
    "kind" "HomeRowKind" NOT NULL,
    "title" TEXT NOT NULL,
    "collectionId" UUID,
    "genreId" UUID,
    "titleType" "TitleType",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Billboard" (
    "id" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Billboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailToken_userId_type_idx" ON "EmailToken"("userId", "type");

-- CreateIndex
CREATE INDEX "Profile_userId_idx" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerRef_key" ON "Payment"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Title_slug_key" ON "Title"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Title_previewAssetId_key" ON "Title"("previewAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "Title_mainAssetId_key" ON "Title"("mainAssetId");

-- CreateIndex
CREATE INDEX "Title_status_publishedAt_idx" ON "Title"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Title_type_status_idx" ON "Title"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Title_type_tmdbId_key" ON "Title"("type", "tmdbId");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_slug_key" ON "Genre"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_tmdbId_key" ON "Genre"("tmdbId");

-- CreateIndex
CREATE INDEX "TitleGenre_genreId_idx" ON "TitleGenre"("genreId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_tmdbId_key" ON "Person"("tmdbId");

-- CreateIndex
CREATE INDEX "Credit_personId_idx" ON "Credit"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Credit_titleId_personId_role_key" ON "Credit"("titleId", "personId", "role");

-- CreateIndex
CREATE INDEX "Image_titleId_kind_idx" ON "Image"("titleId", "kind");

-- CreateIndex
CREATE INDEX "Image_episodeId_idx" ON "Image"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_titleId_seasonNumber_key" ON "Season"("titleId", "seasonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_mainAssetId_key" ON "Episode"("mainAssetId");

-- CreateIndex
CREATE INDEX "Episode_titleId_idx" ON "Episode"("titleId");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_seasonId_episodeNumber_key" ON "Episode"("seasonId", "episodeNumber");

-- CreateIndex
CREATE INDEX "SourceFile_probeStatus_idx" ON "SourceFile"("probeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SourceFile_bucket_key_key" ON "SourceFile"("bucket", "key");

-- CreateIndex
CREATE INDEX "MediaAsset_status_idx" ON "MediaAsset"("status");

-- CreateIndex
CREATE INDEX "MediaAsset_sourceFileId_idx" ON "MediaAsset"("sourceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Rendition_assetId_name_key" ON "Rendition"("assetId", "name");

-- CreateIndex
CREATE INDEX "SubtitleTrack_assetId_idx" ON "SubtitleTrack"("assetId");

-- CreateIndex
CREATE INDEX "AudioTrack_assetId_idx" ON "AudioTrack"("assetId");

-- CreateIndex
CREATE INDEX "TranscodeJob_assetId_idx" ON "TranscodeJob"("assetId");

-- CreateIndex
CREATE INDEX "TranscodeJob_status_idx" ON "TranscodeJob"("status");

-- CreateIndex
CREATE INDEX "WatchProgress_profileId_updatedAt_idx" ON "WatchProgress"("profileId", "updatedAt");

-- CreateIndex
CREATE INDEX "WatchProgress_profileId_titleId_idx" ON "WatchProgress"("profileId", "titleId");

-- CreateIndex
CREATE INDEX "MyListItem_profileId_createdAt_idx" ON "MyListItem"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "ViewEvent_createdAt_idx" ON "ViewEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ViewEvent_titleId_createdAt_idx" ON "ViewEvent"("titleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateIndex
CREATE INDEX "CollectionItem_collectionId_sortOrder_idx" ON "CollectionItem"("collectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "HomeRow_isActive_sortOrder_idx" ON "HomeRow"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Billboard_isActive_sortOrder_idx" ON "Billboard"("isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_previewAssetId_fkey" FOREIGN KEY ("previewAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_mainAssetId_fkey" FOREIGN KEY ("mainAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleGenre" ADD CONSTRAINT "TitleGenre_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleGenre" ADD CONSTRAINT "TitleGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_mainAssetId_fkey" FOREIGN KEY ("mainAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "SourceFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendition" ADD CONSTRAINT "Rendition_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleTrack" ADD CONSTRAINT "SubtitleTrack_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscodeJob" ADD CONSTRAINT "TranscodeJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyListItem" ADD CONSTRAINT "MyListItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyListItem" ADD CONSTRAINT "MyListItem_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewEvent" ADD CONSTRAINT "ViewEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewEvent" ADD CONSTRAINT "ViewEvent_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeRow" ADD CONSTRAINT "HomeRow_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeRow" ADD CONSTRAINT "HomeRow_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billboard" ADD CONSTRAINT "Billboard_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
