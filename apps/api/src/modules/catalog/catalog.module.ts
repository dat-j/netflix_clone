import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller.js";
import { BrowseService } from "./browse.service.js";
import { PersonalService } from "./personal.service.js";
import { TitleCardsService } from "./title-cards.service.js";
import { SeriesService } from "./series.service.js";

@Module({
  controllers: [CatalogController],
  providers: [SeriesService, TitleCardsService, BrowseService, PersonalService],
  exports: [SeriesService, TitleCardsService, BrowseService],
})
export class CatalogModule {}
